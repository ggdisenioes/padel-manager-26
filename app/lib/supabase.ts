import { createClient } from '@supabase/supabase-js';

// 1. Intentamos leer las variables de entorno
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// 2. Verificación de seguridad para el Build
// Si no existen (porque estamos construyendo), usamos valores falsos para que no explote.
const url = supabaseUrl || "https://placeholder.supabase.co";
const key = supabaseKey || "placeholder-key";

// 3. Creamos el cliente
// Nota: Si usamos los valores falsos, la app no cargará datos, pero el Build terminará con éxito.
export const supabase = createClient(url, key);

// Opcional: Avisar en consola si falta algo (solo para depurar)
if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️ Aviso: Las variables de Supabase no están definidas. Usando valores placeholder para evitar error de build.');
}