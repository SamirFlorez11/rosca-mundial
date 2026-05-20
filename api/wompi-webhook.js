// api/wompi-webhook.js
// Webhook que Wompi llama cuando confirma un pago
// Activa al usuario y dispara correo de confirmación

import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@roscamundial.com';
const ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || 'samirleo1195@gmail.com';
const WOMPI_EVENTS_KEY = process.env.WOMPI_EVENTS_KEY; // Llave de eventos de Wompi (distinta a la de integridad)

// ── Verifica la firma del evento Wompi ──────────────────────────────────────
// Wompi envía evento.signature.checksum = SHA256(prop1+prop2+...+events_key)
// donde las propiedades a concatenar vienen en evento.signature.properties
function verificarFirmaWompi(evento) {
  if (!WOMPI_EVENTS_KEY) {
    console.warn('⚠️  WOMPI_EVENTS_KEY no configurada — saltando verificación de firma');
    return true; // en desarrollo sin key configurada, dejar pasar con warning
  }
  const checksum  = evento?.signature?.checksum;
  const propNames = evento?.signature?.properties;
  if (!checksum || !Array.isArray(propNames)) {
    console.error('❌ Evento sin campo signature válido');
    return false;
  }
  // Construir cadena: valores de cada propiedad concatenados + events_key
  const cadena = propNames.map(prop => {
    // prop es tipo "transaction.id" → navegar evento.data.transaction.id
    const partes = prop.split('.');
    let val = evento.data;
    for (const p of partes) val = val?.[p];
    return val ?? '';
  }).join('') + WOMPI_EVENTS_KEY;

  const esperado = crypto.createHash('sha256').update(cadena).digest('hex');
  return checksum === esperado;
}

async function supabase(endpoint, method = 'GET', body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    method,
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : null,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

async function enviarCorreoBienvenida(correo, nombre, usuarioId = null) {
  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;background:#0a0e1a;font-family:'Arial',sans-serif;">
      <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
        <div style="text-align:center;margin-bottom:28px;">
          <div style="font-size:32px;font-weight:900;letter-spacing:4px;color:#FCD116;">ROSCA MUNDIAL</div>
          <div style="font-size:13px;color:#6b7a99;letter-spacing:1px;margin-top:4px;">MUNDIAL USA · MÉXICO · CANADÁ 2026</div>
        </div>
        <div style="background:#111827;border:1px solid #1e2d45;border-radius:16px;padding:32px;">
          <div style="font-size:22px;font-weight:700;color:#FCD116;margin-bottom:8px;">¡Registro confirmado! ✅</div>
          <div style="font-size:15px;color:#e8eaf0;line-height:1.7;margin-bottom:20px;">
            Hola <strong>${nombre}</strong>,<br><br>
            Tu pago fue confirmado y tu cuenta está <strong style="color:#22c55e;">activa</strong>.<br>
            Ya puedes ingresar a la plataforma y comenzar a hacer tus picks.
          </div>
          <div style="background:#1a2235;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
            <div style="font-size:12px;color:#6b7a99;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Fechas clave</div>
            <div style="font-size:13px;color:#e8eaf0;line-height:2;">
              📅 <strong>Apertura inscripciones:</strong> 12 de mayo 2026<br>
              🔒 <strong>Cierre de picks:</strong> 11 de junio 2026, 5:30 PM<br>
              ⚽ <strong>Inicio del Mundial:</strong> 11 de junio 2026, 6:00 PM<br>
              🏆 <strong>Final del Mundial:</strong> 19 de julio 2026
            </div>
          </div>
          <a href="https://roscamundial.com/login"
             style="display:block;text-align:center;background:linear-gradient(135deg,#FCD116,#e5a800);color:#000;font-weight:700;font-size:15px;padding:14px;border-radius:10px;text-decoration:none;letter-spacing:1px;">
            ⚡ IR A MIS PICKS
          </a>
        </div>
        <div style="text-align:center;margin-top:20px;font-size:11px;color:#6b7a99;">
          roscamundial.com · Montería, Colombia · 2026
        </div>
      </div>
    </body>
    </html>
  `;

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Rosca Mundial <${RESEND_FROM_EMAIL}>`,
      to: correo,
      subject: '✅ ¡Registro confirmado! Ya estás en la Rosca Mundial 2026',
      html,
    }),
  });

  const resendData = await resendRes.json().catch(() => ({}));

  if (!resendRes.ok) {
    console.error('❌ Resend error al enviar bienvenida:', resendRes.status, JSON.stringify(resendData));
    // Registrar fallo en logs para auditoria
    if (usuarioId) {
      await supabase('logs', 'POST', {
        usuario_id: usuarioId,
        accion: 'error_correo_bienvenida',
        detalle: { status: resendRes.status, error: resendData, correo },
      }).catch(() => {});
    }
  } else {
    console.log('✅ Correo bienvenida enviado. Resend ID:', resendData.id);
  }
}

async function notificarAdmin({ nombre, correo, monto, wompi_id, reference }) {
  const ahora = new Date().toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  const montoCOP = Number(monto).toLocaleString('es-CO');

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;background:#0a0e1a;font-family:'Arial',sans-serif;">
      <div style="max-width:520px;margin:0 auto;padding:28px 20px;">
        <div style="text-align:center;margin-bottom:20px;">
          <div style="font-size:26px;font-weight:900;letter-spacing:3px;color:#FCD116;">ROSCA MUNDIAL</div>
          <div style="font-size:11px;color:#6b7a99;letter-spacing:1px;margin-top:2px;">NOTIFICACIÓN DE PAGO</div>
        </div>
        <div style="background:#111827;border:1px solid #22c55e;border-radius:16px;padding:24px;">
          <div style="font-size:32px;text-align:center;margin-bottom:8px;">💰</div>
          <div style="font-size:20px;font-weight:800;color:#22c55e;text-align:center;margin-bottom:18px;">
            ¡Nuevo pago confirmado!
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:8px 0;font-size:12px;color:#6b7a99;text-transform:uppercase;letter-spacing:1px;width:38%;">Participante</td>
              <td style="padding:8px 0;font-size:14px;font-weight:700;color:#e8eaf0;">${nombre}</td>
            </tr>
            <tr style="border-top:1px solid #1e2d45;">
              <td style="padding:8px 0;font-size:12px;color:#6b7a99;text-transform:uppercase;letter-spacing:1px;">Correo</td>
              <td style="padding:8px 0;font-size:13px;color:#e8eaf0;">${correo}</td>
            </tr>
            <tr style="border-top:1px solid #1e2d45;">
              <td style="padding:8px 0;font-size:12px;color:#6b7a99;text-transform:uppercase;letter-spacing:1px;">Monto</td>
              <td style="padding:8px 0;font-size:18px;font-weight:900;color:#FCD116;">$${montoCOP} COP</td>
            </tr>
            <tr style="border-top:1px solid #1e2d45;">
              <td style="padding:8px 0;font-size:12px;color:#6b7a99;text-transform:uppercase;letter-spacing:1px;">Hora COL</td>
              <td style="padding:8px 0;font-size:13px;color:#e8eaf0;">${ahora}</td>
            </tr>
            <tr style="border-top:1px solid #1e2d45;">
              <td style="padding:8px 0;font-size:12px;color:#6b7a99;text-transform:uppercase;letter-spacing:1px;">Wompi ID</td>
              <td style="padding:8px 0;font-size:11px;color:#6b7a99;font-family:monospace;">${wompi_id}</td>
            </tr>
            <tr style="border-top:1px solid #1e2d45;">
              <td style="padding:8px 0;font-size:12px;color:#6b7a99;text-transform:uppercase;letter-spacing:1px;">Referencia</td>
              <td style="padding:8px 0;font-size:11px;color:#6b7a99;font-family:monospace;">${reference || '—'}</td>
            </tr>
          </table>
          <div style="margin-top:18px;text-align:center;">
            <a href="https://roscamundial.com/admin"
               style="display:inline-block;background:linear-gradient(135deg,#FCD116,#e5a800);color:#000;font-weight:800;font-size:13px;padding:11px 28px;border-radius:10px;text-decoration:none;letter-spacing:1px;">
              Ver en Admin →
            </a>
          </div>
        </div>
        <div style="text-align:center;margin-top:14px;font-size:10px;color:#6b7a99;">
          roscamundial.com · Notificación automática
        </div>
      </div>
    </body>
    </html>
  `;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Rosca Mundial <${RESEND_FROM_EMAIL}>`,
      to:   ADMIN_EMAIL,
      subject: `💰 Nuevo pago — ${nombre} ($${montoCOP} COP)`,
      html,
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (r.ok) {
    console.log('✅ Admin notificado. Resend ID:', data.id);
  } else {
    console.error('❌ Error notificando admin:', r.status, JSON.stringify(data));
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const evento = req.body;

    // ── 1. Verificar firma Wompi (seguridad) ──────────────────────────────────
    if (!verificarFirmaWompi(evento)) {
      console.error('❌ Firma Wompi inválida — rechazando evento');
      return res.status(401).json({ error: 'Firma inválida' });
    }

    // Wompi envía el evento dentro de "data.transaction"
    const transaccion = evento?.data?.transaction;
    if (!transaccion) return res.status(400).json({ error: 'Payload inválido' });

    const { id: wompi_id, status, amount_in_cents, reference, customer_email } = transaccion;

    // ── 2. Solo procesamos transacciones APPROVED ─────────────────────────────
    if (status !== 'APPROVED') {
      return res.status(200).json({ ok: true, mensaje: `Estado ${status} ignorado` });
    }

    // ── 3. Verificar monto exacto: $60.000 COP = 6.000.000 centavos ──────────
    if (amount_in_cents !== 6000000) {
      console.error(`❌ Monto incorrecto: ${amount_in_cents} centavos. Se esperaban 6000000.`);
      await supabase('logs', 'POST', {
        usuario_id: null,
        accion: 'webhook_monto_incorrecto',
        detalle: { wompi_id, amount_in_cents, customer_email, reference },
      }).catch(() => {});
      return res.status(200).json({ ok: false, mensaje: 'Monto incorrecto — pago no procesado' });
    }

    // ── 4. Buscar usuario por correo ──────────────────────────────────────────
    const usuarioResult = await supabase(
      `usuarios?correo=eq.${encodeURIComponent(customer_email)}&select=id,nombre_completo,activo`
    );

    if (!usuarioResult.ok || !usuarioResult.data?.length) {
      console.error('Usuario no encontrado para correo:', customer_email);
      // Retornar 200 para que Wompi no reintente — registrar en logs
      await supabase('logs', 'POST', {
        usuario_id: null,
        accion: 'webhook_usuario_no_encontrado',
        detalle: { wompi_id, customer_email, reference },
      }).catch(() => {});
      return res.status(200).json({ ok: false, mensaje: 'Usuario no encontrado' });
    }

    const usuario = usuarioResult.data[0];

    // ── 5. Idempotencia: ya activo o pago ya procesado ────────────────────────
    if (usuario.activo) {
      return res.status(200).json({ ok: true, mensaje: 'Usuario ya estaba activo' });
    }

    const pagoExiste = await supabase(
      `pagos?wompi_transaction_id=eq.${wompi_id}&select=id`
    );
    if (pagoExiste.ok && pagoExiste.data?.length > 0) {
      return res.status(200).json({ ok: true, mensaje: 'Pago ya procesado' });
    }

    // ── 6. Registrar el pago ──────────────────────────────────────────────────
    await supabase('pagos', 'POST', {
      usuario_id: usuario.id,
      wompi_transaction_id: wompi_id,
      monto: Math.round(amount_in_cents / 100),
      moneda: 'COP',
      estado: 'APPROVED',
      metodo_pago: transaccion.payment_method_type || 'WOMPI',
    });

    // ── 7. Activar usuario Y cupo #1 ──────────────────────────────────────────
    await supabase(`usuarios?id=eq.${usuario.id}`, 'PATCH', {
      activo: true,
      updated_at: new Date().toISOString(),
    });

    // Activar cupo #1 (creado con activo:false en el registro)
    await supabase(`cupos?usuario_id=eq.${usuario.id}&numero=eq.1`, 'PATCH', {
      activo: true,
      updated_at: new Date().toISOString(),
    });

    // Registrar notificación
    await supabase('notificaciones', 'POST', {
      usuario_id: usuario.id,
      tipo: 'confirmacion_registro',
      asunto: '✅ Registro confirmado - Rosca Mundial 2026',
      estado: 'pendiente',
    });

    // Enviar correo de bienvenida al usuario
    await enviarCorreoBienvenida(customer_email, usuario.nombre_completo, usuario.id);

    // Notificar al admin
    await notificarAdmin({
      nombre:   usuario.nombre_completo,
      correo:   customer_email,
      monto:    amount_in_cents / 100,
      wompi_id,
      reference,
    }).catch(e => console.error('❌ Error notificando admin:', e.message));

    // Actualizar notificación a enviada
    await supabase(
      `notificaciones?usuario_id=eq.${usuario.id}&tipo=eq.confirmacion_registro&estado=eq.pendiente`,
      'PATCH',
      { estado: 'enviado', enviado_at: new Date().toISOString() }
    );

    // Log
    await supabase('logs', 'POST', {
      usuario_id: usuario.id,
      accion: 'pago_confirmado_wompi',
      detalle: {
        wompi_transaction_id: wompi_id,
        monto: amount_in_cents / 100,
        referencia: reference,
        correo: customer_email,
      },
    });

    return res.status(200).json({ ok: true, mensaje: 'Usuario activado correctamente' });

  } catch (err) {
    console.error('Error webhook Wompi:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}