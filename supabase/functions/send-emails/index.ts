// supabase/functions/send-emails/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FUNCTION_VERSION = "2026-02-05-01";
const DEBUG_LOGS = (Deno.env.get("DEBUG_SEND_EMAILS") || "").toLowerCase() === "true";

type OutboxRow = {
  id: number;
  tenant_id: string;
  match_id: number;
  to_email: string;
  template: "match_created" | "match_reminder_24h";
  payload: any;
};

function env(name: string) {
  const v = Deno.env.get(name);
  if (v) return v;

  // Diagnóstico: a veces se pasa el valor del secret como "name" (ej: re_xxx o JWT)
  const looksLikeResendKey = /^re_[A-Za-z0-9_-]{10,}$/.test(name);
  const looksLikeJwt = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(name);

  if (looksLikeResendKey) {
    throw new Error(
      `Falta secret/env: RESEND_API_KEY (parece que se está usando el valor del API key como nombre del secret). Version: ${FUNCTION_VERSION}`
    );
  }

  if (looksLikeJwt) {
    throw new Error(
      `Falta secret/env: SUPABASE_SERVICE_ROLE_KEY (parece que se está usando un JWT como nombre del secret). Version: ${FUNCTION_VERSION}`
    );
  }

  throw new Error(`Falta secret/env: ${name}. Version: ${FUNCTION_VERSION}`);
}

function formatDateTimeES(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function baseEmailLayout(opts: {
  title: string;
  preheader: string;
  bodyHtml: string;
}) {
  const { title, preheader, bodyHtml } = opts;

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin:0; padding:0; background:#f6f7fb; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; }
    .wrap { width:100%; padding:24px 12px; }
    .card { max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e6e8ef; border-radius:16px; overflow:hidden; box-shadow:0 10px 30px rgba(15,23,42,.08); }
    .header { background:#05070b; padding:18px 20px; }
    .brand { color:#fff; font-weight:900; letter-spacing:.26em; font-size:12px; }
    .sub { color:#ccff00; font-weight:700; letter-spacing:.32em; font-size:10px; margin-top:6px; text-transform:uppercase; }
    .content { padding:20px; color:#0f172a; }
    .h1 { font-size:18px; font-weight:900; margin:0 0 8px; }
    .p { font-size:14px; line-height:1.55; margin:0 0 14px; color:#334155; }
    .pill { display:inline-block; padding:6px 10px; border-radius:999px; background:#f1f5f9; color:#0f172a; font-weight:700; font-size:12px; }
    .grid { margin-top:14px; border:1px solid #e6e8ef; border-radius:14px; overflow:hidden; }
    .row { padding:12px 14px; border-top:1px solid #eef2ff; }
    .row:first-child{ border-top:none; }
    .k { color:#64748b; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; }
    .v { color:#0f172a; font-size:14px; font-weight:800; margin-top:4px; }
    .cta { display:inline-block; background:#16a34a; color:#ffffff !important; text-decoration:none; font-weight:900; padding:12px 16px; border-radius:12px; }
    .muted { color:#64748b; font-size:12px; }
    .footer { padding:16px 20px; background:#0b1220; color:#94a3b8; font-size:12px; }
    .preheader { display:none!important; visibility:hidden; opacity:0; height:0; width:0; overflow:hidden; }
  </style>
</head>
<body>
  <span class="preheader">${escapeHtml(preheader)}</span>
  <div class="wrap">
    <div class="card">
      <div class="header">
        <div class="brand">PADELX</div>
        <div class="sub">PÁDEL MANAGER</div>
      </div>
      <div class="content">
        ${bodyHtml}
      </div>
      <div class="footer">
        Este email fue enviado automáticamente por <a href="https://padelx.es" style="color:#ccff00; font-weight:800; text-decoration:none;">PadelX</a>. Si creés que es un error, contactá con el administrador del club.
      </div>
    </div>
  </div>
</body>
</html>`;
}

function emailMatchCreated(opts: {
  tenantName: string;
  matchTypeLabel: string;
  matchWhen: string;
  whereText: string;
  teamsText: string;
  moreInfo?: string;
}) {
  const when = formatDateTimeES(opts.matchWhen);
  const title = "Partido creado ✅";
  const preheader = `Tenés un partido programado: ${when}`;

  const bodyHtml = `
    <div class="h1">Partido creado ✅</div>
    <div class="p">Ya quedó agendado tu partido. Te dejamos toda la info:</div>

    <div style="margin: 10px 0 14px;">
      <span class="pill">${escapeHtml(opts.tenantName)}</span>
    </div>

    <div class="grid">
      <div class="row">
        <div class="k">Tipo</div>
        <div class="v">${escapeHtml(opts.matchTypeLabel)}</div>
      </div>
      <div class="row">
        <div class="k">Cuándo</div>
        <div class="v">${escapeHtml(when)}</div>
      </div>
      <div class="row">
        <div class="k">Con quién</div>
        <div class="v">${escapeHtml(opts.teamsText)}</div>
      </div>
      <div class="row">
        <div class="k">Dónde</div>
        <div class="v">${escapeHtml(opts.whereText || "Por confirmar")}</div>
      </div>
      ${
        opts.moreInfo
          ? `<div class="row">
               <div class="k">Detalles</div>
               <div class="v">${escapeHtml(opts.moreInfo)}</div>
             </div>`
          : ""
      }
    </div>

    <div class="p muted" style="margin-top:14px;">
      Tip: si algo cambió (pista/horario), vas a recibir una actualización.
    </div>
  `;

  return {
    subject: `Partido creado · ${when}`,
    html: baseEmailLayout({ title, preheader, bodyHtml }),
  };
}

function emailReminder24h(opts: {
  tenantName: string;
  matchTypeLabel: string;
  matchWhen: string;
  whereText: string;
  teamsText: string;
}) {
  const when = formatDateTimeES(opts.matchWhen);
  const title = "Recordatorio: tu partido es mañana 🎾";
  const preheader = `Mañana jugás: ${when}`;

  const bodyHtml = `
    <div class="h1">Recordatorio 🎾</div>
    <div class="p">Tu partido es <span class="pill">mañana</span>. No te lo pierdas:</div>

    <div style="margin: 10px 0 14px;">
      <span class="pill">${escapeHtml(opts.tenantName)}</span>
    </div>

    <div class="grid">
      <div class="row">
        <div class="k">Tipo</div>
        <div class="v">${escapeHtml(opts.matchTypeLabel)}</div>
      </div>
      <div class="row">
        <div class="k">Cuándo</div>
        <div class="v">${escapeHtml(when)}</div>
      </div>
      <div class="row">
        <div class="k">Con quién</div>
        <div class="v">${escapeHtml(opts.teamsText)}</div>
      </div>
      <div class="row">
        <div class="k">Dónde</div>
        <div class="v">${escapeHtml(opts.whereText || "Por confirmar")}</div>
      </div>
    </div>

    <div class="p muted" style="margin-top:14px;">
      Recomendación: llegá 10 minutos antes para calentar.
    </div>
  `;

  return {
    subject: `Recordatorio · ${when}`,
    html: baseEmailLayout({ title, preheader, bodyHtml }),
  };
}

async function sendWithResend(to: string, subject: string, html: string) {
  const apiKey = env("RESEND_API_KEY");
  const from = env("EMAIL_FROM");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Resend error ${res.status}: ${txt}`);
  }
}

serve(async (req) => {
  if (DEBUG_LOGS) {
    console.log(
      `[send-emails] HIT version=${FUNCTION_VERSION} method=${req.method} ts=${new Date().toISOString()} ua=${req.headers.get("user-agent") || ""}`
    );
  }

  // Seguridad: por defecto SOLO permite llamadas internas desde la DB (cron) con header x-internal-secret.
  // Para pruebas manuales, seteá ALLOW_MANUAL_INVOKE=true en Secrets.
  const expected = Deno.env.get("INTERNAL_WEBHOOK_SECRET") || "";
  const provided = req.headers.get("x-internal-secret") || "";
  const allowManual = (Deno.env.get("ALLOW_MANUAL_INVOKE") || "").toLowerCase() === "true";

  if (DEBUG_LOGS) {
    console.log(
      `[send-emails] AUTH expected_set=${Boolean(expected)} allowManual=${allowManual} provided_len=${provided.length}`
    );
  }

  if (expected && !allowManual && provided !== expected) {
    if (DEBUG_LOGS) {
      console.warn(
        `[send-emails] UNAUTHORIZED version=${FUNCTION_VERSION} provided_len=${provided.length}`
      );
    }
    return new Response(JSON.stringify({ ok: false, version: FUNCTION_VERSION, error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // Aceptamos solo POST para evitar crawlers
  if (req.method !== "POST") {
    if (DEBUG_LOGS) {
      console.warn(`[send-emails] METHOD_NOT_ALLOWED version=${FUNCTION_VERSION} method=${req.method}`);
    }
    return new Response(JSON.stringify({ ok: false, version: FUNCTION_VERSION, error: "method_not_allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  try {

    const supabaseUrl = env("SUPABASE_URL");
    const serviceRole = env("SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceRole);

    // 1) Traer pendientes
    const { data, error } = await supabase
      .from("email_outbox")
      .select("id, tenant_id, match_id, to_email, template, payload")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .order("id", { ascending: true })
      .limit(50);

    if (error) throw error;

    const rows = (data ?? []) as OutboxRow[];
    if (DEBUG_LOGS) {
      console.log(`[send-emails] FETCH pending_rows=${rows.length}`);
    }
    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const payload = row.payload ?? {};
        const start_time: string | undefined = payload.start_time;

        // Texto “dónde”
        const whereText =
          [payload.location, payload.court].filter(Boolean).join(" · ") ||
          payload.where ||
          "";

        // Texto “con quién”
        // Si no viene armado, igual lo mostramos con IDs (mejorable luego).
        const teamsText =
          payload.teamsText ||
          payload.teams ||
          "Partido programado";

        const tenantName =
          payload.tenant_name ||
          payload.tenantName ||
          payload.club_name ||
          payload.clubName ||
          "PadelX";

        const tournamentName = payload.tournament_name || payload.tournamentName || payload.tournament || payload.tournamentTitle;
        const isTournament =
          payload.match_type === "tournament" ||
          payload.matchType === "tournament" ||
          payload.is_tournament === true ||
          payload.isTournament === true ||
          Boolean(tournamentName);

        const matchTypeLabel = isTournament
          ? `Torneo: ${tournamentName ? String(tournamentName) : "(sin nombre)"}`
          : "Partido amistoso";

        let subject = "";
        let html = "";

        if (row.template === "match_created") {
          if (!start_time) throw new Error("payload.start_time faltante");
          const out = emailMatchCreated({
            tenantName,
            matchTypeLabel,
            matchWhen: start_time,
            whereText,
            teamsText,
            moreInfo: payload.moreInfo,
          });
          subject = out.subject;
          html = out.html;
        } else if (row.template === "match_reminder_24h") {
          if (!start_time) throw new Error("payload.start_time faltante");
          const out = emailReminder24h({
            tenantName,
            matchTypeLabel,
            matchWhen: start_time,
            whereText,
            teamsText,
          });
          subject = out.subject;
          html = out.html;
        } else {
          throw new Error(`template no soportado: ${row.template}`);
        }

        await sendWithResend(row.to_email, subject, html);

        // marcar sent
        const { error: upErr } = await supabase
          .from("email_outbox")
          .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
          .eq("id", row.id);

        if (upErr) throw upErr;

        sent++;
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        await supabase
          .from("email_outbox")
          .update({ status: "failed", error: msg })
          .eq("id", row.id);
      }
    }

    if (DEBUG_LOGS) {
      console.log(
        `[send-emails] DONE processed=${rows.length} sent=${sent} failed=${failed}`
      );
    }

    return new Response(
      JSON.stringify({ ok: true, version: FUNCTION_VERSION, processed: rows.length, sent, failed }),
      {
        headers: { "content-type": "application/json" },
        status: 200,
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (DEBUG_LOGS) {
      console.error(`[send-emails] ERROR version=${FUNCTION_VERSION} msg=${msg}`);
    }
    return new Response(
      JSON.stringify({ ok: false, version: FUNCTION_VERSION, error: msg }),
      {
        headers: { "content-type": "application/json" },
        status: 500,
      }
    );
  }
});