/**
 * /api/admin/notificaciones.js
 *
 * GET   → Historial de notificaciones enviadas
 *
 * POST  body: {
 *   destinatarios: "todos" | "pendientes" | "sin-picks" | "uno",
 *   correo_especifico?: "user@email.com",  (solo cuando destinatarios="uno")
 *   asunto: "...",
 *   mensaje: "...",
 * }
 * → Envía email masivo o individual vía Resend
 */
const { sb, requireAdmin, setCORS, ok, err } = require("./_lib");

const RESEND_KEY   = process.env.RESEND_API_KEY;
const FROM_EMAIL   = process.env.RESEND_FROM_EMAIL || "noreply@roscamundial.com";

async function enviarEmail(to, asunto, htmlBody) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Rosca Mundial <${FROM_EMAIL}>`,
      to: Array.isArray(to) ? to : [to],
      subject: asunto,
      html: htmlBody,
    }),
  });
  return r.ok;
}

function buildHTML(asunto, mensaje) {
  return `
  <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 20px;background:#0D1B3E;color:#fff;border-radius:16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:32px;font-weight:900;letter-spacing:4px;color:#E8A020;">ROSCA MUNDIAL</div>
      <div style="font-size:12px;letter-spacing:3px;color:rgba(255,255,255,0.4);">COPA MUNDIAL 2026</div>
    </div>
    <div style="background:rgba(255,255,255,0.05);border-radius:12px;padding:24px;">
      <h2 style="color:#E8A020;margin-top:0;">${asunto}</h2>
      <div style="color:rgba(255,255,255,0.8);line-height:1.7;white-space:pre-line;">${mensaje}</div>
    </div>
    <div style="text-align:center;margin-top:20px;font-size:11px;color:rgba(255,255,255,0.3);">
      roscamundial.com · Montería, Colombia
    </div>
  </div>`;
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireAdmin(req)) return err(res, "No autorizado", 401);

  // ── GET: historial ────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const rNoti = await sb("notificaciones", {
      params: {
        select: "id,asunto,destinatarios,total_enviados,total_abiertos,estado,created_at",
        order: "created_at.desc",
        limit: "50",
      },
    });
    return ok(res, { notificaciones: rNoti.data || [] });
  }

  // ── POST: enviar ──────────────────────────────────────────────────────────
  if (req.method === "POST") {
    const { destinatarios, correo_especifico, asunto, mensaje } = req.body || {};
    if (!asunto || !mensaje) return err(res, "Faltan asunto o mensaje");

    // Obtener lista de correos según destinatarios
    let correos = [];

    if (destinatarios === "uno") {
      if (!correo_especifico) return err(res, "Falta correo_especifico");
      correos = [correo_especifico];

    } else if (destinatarios === "todos") {
      const r = await sb("usuarios", { params: { estado: "eq.activo", select: "correo" } });
      correos = (r.data || []).map(u => u.correo).filter(Boolean);

    } else if (destinatarios === "pendientes") {
      const r = await sb("usuarios", { params: { estado: "eq.pendiente", select: "correo" } });
      correos = (r.data || []).map(u => u.correo).filter(Boolean);

    } else if (destinatarios === "sin-picks") {
      const r = await sb("usuarios", {
        params: { estado: "eq.activo", picks_completos: "eq.false", select: "correo" },
      });
      correos = (r.data || []).map(u => u.correo).filter(Boolean);

    } else {
      return err(res, "destinatarios inválido");
    }

    if (!correos.length) return err(res, "No se encontraron destinatarios");

    // Enviar en batches de 50 (límite Resend)
    const htmlBody = buildHTML(asunto, mensaje);
    let enviados = 0;
    const BATCH = 50;
    for (let i = 0; i < correos.length; i += BATCH) {
      const batch = correos.slice(i, i + BATCH);
      const exito = await enviarEmail(batch, asunto, htmlBody);
      if (exito) enviados += batch.length;
    }

    // Registrar en tabla notificaciones
    await sb("notificaciones", {
      method: "POST",
      body: {
        asunto,
        mensaje,
        destinatarios,
        total_enviados: enviados,
        total_abiertos: 0,
        estado: enviados > 0 ? "enviado" : "error",
      },
    });

    // Log
    await sb("logs", {
      method: "POST",
      body: {
        tipo: "admin",
        mensaje: `Notificación enviada: "${asunto}" → ${enviados} correos`,
        meta: { destinatarios, enviados, asunto },
      },
    });

    return ok(res, {
      mensaje: `Notificación enviada a ${enviados} de ${correos.length} destinatarios`,
      enviados,
      total: correos.length,
    });
  }

  return err(res, "Método no permitido", 405);
}
