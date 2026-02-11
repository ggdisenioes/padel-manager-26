# 📧 Integración Resend - Notificaciones por Email

## Configuración

Tu API key de Resend ya está lista:
```
re_MsktRc25_Nyp9v615Nu3ZkkGAjhdKXfzP
```

## Paso 1: Agregar variables de ambiente en Supabase

Ve a **Supabase Dashboard → Settings → Edge Functions → Environment Variables**

Agrega estas variables:
```
RESEND_API_KEY = re_MsktRc25_Nyp9v615Nu3ZkkGAjhdKXfzP
```

## Paso 2: Desplegar Edge Function

```bash
cd /path/to/padel-manager-26

# Deploy la Edge Function
supabase functions deploy process-email-queue
```

## Paso 3: Probar la Edge Function

```bash
# Invocar la función (cron manual)
curl -X POST https://<your-project-ref>.supabase.co/functions/v1/process-email-queue \
  -H "Authorization: Bearer <your-service-role-key>" \
  -H "Content-Type: application/json"
```

## Paso 4: Configurar Cron Job (Opcional)

Si quieres que se procesen emails automáticamente cada 5 minutos:

### Opción A: Usar pg_cron en Supabase

```sql
-- Ejecutar la Edge Function cada 5 minutos
SELECT cron.schedule('process-emails', '*/5 * * * *', 'SELECT http_post(''https://<your-project-ref>.supabase.co/functions/v1/process-email-queue'', '''', jsonb_object(''headers'', jsonb_object(''Authorization'', ''Bearer <your-service-role-key>''))))');
```

### Opción B: Usar un servicio externo

- **IFTTT**: Crea un webhook que ejecute la función cada 5 minutos
- **Zapier**: Configura un flujo que ejecute la función periódicamente
- **EasyCron**: https://www.easycron.com/ (gratuito)

## Notificaciones Automáticas Configuradas

### 1. **Challenges (Desafíos)**
Cuando alguien recibe un desafío:
- **Evento**: INSERT en tabla `challenges`
- **Trigger**: `notify_on_challenge_created()`
- **Acción**: Enqueue email a `email_queue`
- **Template**: `challenge_received`

**Ejemplo de email:**
```
¡Nuevo Desafío Recibido!

¡Hola [jugador]!
[retador] te ha retado a un desafío.
Mensaje: [mensaje personalizado]

[Link a ver desafío]
```

### 2. **Bookings (Reservas de Pistas)**
Cuando alguien reserva una pista:
- **Evento**: INSERT en tabla `bookings`
- **Trigger**: `notify_on_booking_created()`
- **Acción**: Enqueue email a `email_queue`
- **Template**: `booking_confirmed`

**Ejemplo de email:**
```
¡Reserva Confirmada!

¡Reserva Confirmada!
Pista: [nombre pista]
Fecha: [fecha]
Hora: [hora inicio] - [hora fin]

[Link a ver reserva]
```

## SQL para verificar estado de emails

```sql
-- Ver emails pendientes
SELECT id, recipient_email, subject, status, attempts
FROM email_queue
WHERE status = 'pending'
ORDER BY created_at DESC;

-- Ver emails enviados hoy
SELECT COUNT(*) as sent_today, status
FROM email_queue
WHERE DATE(created_at) = CURRENT_DATE
GROUP BY status;

-- Ver emails con error
SELECT id, recipient_email, error_message, attempts
FROM email_queue
WHERE status = 'failed'
ORDER BY created_at DESC;
```

## Flujo Completo

```
┌─────────────────────────────────────────┐
│ User crea Challenge/Booking             │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│ Database Trigger se ejecuta             │
│ - notify_on_challenge_created()         │
│ - notify_on_booking_created()           │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│ INSERT en email_queue table             │
│ - recipient_email                       │
│ - subject                               │
│ - body_html                             │
│ - template_type                         │
│ - status: 'pending'                     │
└──────────────────┬──────────────────────┘
                   │
      (cada 5 minutos vía Cron)
                   ▼
┌─────────────────────────────────────────┐
│ Edge Function process-email-queue       │
│ - Lee emails pending                    │
│ - Envía con Resend API                  │
│ - Actualiza status a 'sent'             │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│ Email llega a inbox del usuario         │
└─────────────────────────────────────────┘
```

## Troubleshooting

### Email no se envía
1. Verifica `email_queue` tabla:
   ```sql
   SELECT * FROM email_queue WHERE status = 'pending';
   ```
2. Verifica Edge Function logs en Supabase

### Error: "RESEND_API_KEY is undefined"
- Asegúrate de agregar la variable en Supabase Environment Variables
- Re-deploy la Edge Function

### Email llega pero sin formato
- Verifica que `body_html` en email_queue tenga HTML válido
- Comprueba que los templates están siendo generados correctamente

## Emails de Ejemplo que ya existen

✅ **Partidos nuevos** - Recordatorio 24hs antes
✅ **Desafíos** - Nuevo desafío recibido (NUEVO)
✅ **Reservas** - Confirmación de reserva (NUEVO)

## Costos

- **Resend**: 100 emails/día gratis, luego $0.20 por email
- **Supabase Edge Functions**: Gratuito hasta 125,000 invocaciones/mes
- **Database email_queue**: ~1 MB por 10,000 emails

---

## Status: ✅ LISTO PARA USAR

1. **Agrega RESEND_API_KEY a Supabase**
2. **Deploy la Edge Function**
3. **Configura Cron Job** (opcional pero recomendado)
4. **Prueba creando un Challenge o Booking**
