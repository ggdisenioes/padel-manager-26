import { z } from "zod";
import { PASSWORD_POLICY } from "./password-policy";

/**
 * Dominios de email temporales / desechables.
 *
 * La comparación incluye subdominios, así que "algo.mailinator.com" también
 * queda bloqueado sin necesidad de listarlo aparte.
 *
 * Para agregar o quitar un proveedor, editá solo esta lista.
 */
const DISPOSABLE_DOMAINS = new Set([
  "0-mail.com",
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "33mail.com",
  "anonbox.net",
  "armyspy.com",
  "burnermail.io",
  "cuvox.de",
  "dayrep.com",
  "dispostable.com",
  "disposablemail.com",
  "dropmail.me",
  "einrot.com",
  "emailondeck.com",
  "emailtemporario.com.br",
  "fakeinbox.com",
  "fakemail.net",
  "fleckens.hu",
  "getairmail.com",
  "getnada.com",
  "grr.la",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "gustr.com",
  "harakirimail.com",
  "inboxbear.com",
  "inboxkitten.com",
  "jetable.org",
  "korotkovpetr.ru",
  "mail-temporaire.fr",
  "mail7.io",
  "mailcatch.com",
  "maildrop.cc",
  "mailinator.com",
  "mailinator.net",
  "mailnesia.com",
  "mailsac.com",
  "mailtemp.net",
  "mintemail.com",
  "moakt.com",
  "mohmal.com",
  "mytemp.email",
  "nowmymail.com",
  "correotemporal.org",
  "pokemail.net",
  "rhyta.com",
  "sharklasers.com",
  "spam4.me",
  "spambog.com",
  "spamgourmet.com",
  "superrito.com",
  "temp-mail.io",
  "temp-mail.org",
  "temp-mail.com",
  "tempail.com",
  "tempinbox.com",
  "tempmail.com",
  "tempmail.net",
  "tempmail.org",
  "tempmail.plus",
  "tempmailo.com",
  "tempr.email",
  "throwawaymail.com",
  "throwaway.email",
  "tmail.ws",
  "tmpmail.net",
  "trashmail.com",
  "trashmail.de",
  "trashmail.me",
  "trbvm.com",
  "vomoto.com",
  "wegwerfmail.de",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "zetmail.com",
]);

/**
 * Dominios de relleno: los que aparecen casi siempre en registros de prueba
 * o falsos, y prácticamente nunca en uno real.
 *
 * Nota sobre "email.com": es un servicio real de mail.com, pero se usa sobre
 * todo como placeholder — fue el dominio del registro falso que originó esta
 * revisión. Si algún socio legítimo lo usa, sacalo de esta lista y listo.
 */
const PLACEHOLDER_DOMAINS = new Set([
  "domain.com",
  "email.com",
  "ejemplo.com",
  "example.com",
  "example.net",
  "example.org",
  "midominio.com",
  "mydomain.com",
  "noemail.com",
  "prueba.com",
  "sample.com",
  "test.com",
  "test.net",
  "test.org",
  "yourdomain.com",
]);

function getEmailDomain(email: string): string {
  const [, domain] = email.toLowerCase().trim().split("@");
  return domain || "";
}

/**
 * Coincide con el dominio exacto y con cualquier subdominio suyo.
 * Ej.: "correo.mailinator.com" coincide con "mailinator.com".
 */
function domainMatches(domain: string, list: Set<string>): boolean {
  if (!domain) return false;
  if (list.has(domain)) return true;

  const parts = domain.split(".");
  for (let i = 1; i < parts.length - 1; i += 1) {
    if (list.has(parts.slice(i).join("."))) return true;
  }

  return false;
}

/** Email temporal de un servicio de usar y tirar. */
export function isDisposableEmail(email: string): boolean {
  return domainMatches(getEmailDomain(email), DISPOSABLE_DOMAINS);
}

/** Email con dominio de relleno (example.com, test.com, etc.). */
export function isPlaceholderEmail(email: string): boolean {
  return domainMatches(getEmailDomain(email), PLACEHOLDER_DOMAINS);
}

export const emailSchema = z
  .string()
  .min(1, "Email es requerido")
  .max(254, "El email es demasiado largo")
  .trim()
  .toLowerCase()
  .email("Email inválido")
  .refine(
    (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email),
    "Formato de email inválido"
  )
  .refine(
    (email) => !isDisposableEmail(email),
    "No se admiten emails temporales. Usá tu email habitual."
  )
  .refine(
    (email) => !isPlaceholderEmail(email),
    "Ese dominio de email no es válido. Usá tu email real."
  );

export const passwordSchema = z.string()
  .min(PASSWORD_POLICY.minLength, `Mínimo ${PASSWORD_POLICY.minLength} caracteres`)
  .max(200, "La contraseña es demasiado larga")
  .regex(PASSWORD_POLICY.uppercaseRegex, "Debe contener una mayúscula (A-Z)")
  .regex(PASSWORD_POLICY.lowercaseRegex, "Debe contener una minúscula (a-z)")
  .regex(PASSWORD_POLICY.numberRegex, "Debe contener un número (0-9)")
  .regex(PASSWORD_POLICY.specialRegex, "Debe contener un carácter especial");

export const tenantIdSchema = z.string()
  .uuid("Tenant ID inválido");

export const roleSchema = z.enum(["user", "manager"])
  .default("user");

/**
 * Nombre y apellido son opcionales en el registro libre.
 * Se normaliza "" y espacios en blanco a null para no guardar basura.
 */
const optionalNameSchema = z
  .string()
  .trim()
  .max(100, "Máximo 100 caracteres")
  .nullish()
  .transform((value) => (value && value.length > 0 ? value : null));

/**
 * Validación del registro libre. La usa la ruta de servidor
 * `POST /api/auth/register`, que es el único punto donde se crean cuentas
 * desde el formulario público.
 */
export const registrationSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    password_confirmation: z.string(),
    tenant_id: tenantIdSchema,
    first_name: optionalNameSchema,
    last_name: optionalNameSchema,
    // Token de CAPTCHA. Queda opcional para que activar la protección en
    // Supabase Auth no requiera tocar el backend: si viene, se reenvía.
    captcha_token: z.string().trim().min(1).max(5000).nullish(),
  })
  .refine(
    (data) => data.password === data.password_confirmation,
    {
      message: "Las contraseñas no coinciden",
      path: ["password_confirmation"],
    }
  );

export type RegistrationInput = z.infer<typeof registrationSchema>;

// Validación para login
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Contraseña requerida"),
});

// Validación para crear usuario (admin)
export const createUserSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  role: roleSchema,
});
