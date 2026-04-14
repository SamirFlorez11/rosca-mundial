// api/wompi-webhook.js
// Webhook que Wompi llama cuando confirma un pago
// Activa al usuario y dispara correo de confirmación

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@roscamundial.com';

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

async function enviarCorreoBienvenida(correo, nombre) {
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

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: correo,
      subject: '✅ ¡Registro confirmado! Ya estás en la Rosca Mundial 2026',
      html,
    }),
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const evento = req.body;

    // Wompi envía el evento dentro de "data.transaction"
    const transaccion = evento?.data?.transaction;
    if (!transaccion) return res.status(400).json({ error: 'Payload inválido' });

    const { id: wompi_id, status, amount_in_cents, reference, customer_email } = transaccion;

    // Solo procesamos transacciones APPROVED
    if (status !== 'APPROVED') {
      return res.status(200).json({ ok: true, mensaje: `Estado ${status} ignorado` });
    }

    // Verificar monto: debe ser exactamente $60.000 COP = 6000000 centavos
    if (amount_in_cents !== 6000000) {
      console.warn(`Monto inesperado: ${amount_in_cents}`);
    }

    // Buscar usuario por correo
    const usuarioResult = await supabase(
      `usuarios?correo=eq.${encodeURIComponent(customer_email)}&select=id,nombre_completo,activo`
    );

    if (!usuarioResult.ok || !usuarioResult.data?.length) {
      console.error('Usuario no encontrado para correo:', customer_email);
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const usuario = usuarioResult.data[0];

    // Verificar que no esté ya activo (idempotencia)
    if (usuario.activo) {
      return res.status(200).json({ ok: true, mensaje: 'Usuario ya estaba activo' });
    }

    // Verificar que el wompi_id no esté ya registrado
    const pagoExiste = await supabase(
      `pagos?wompi_transaction_id=eq.${wompi_id}&select=id`
    );
    if (pagoExiste.ok && pagoExiste.data?.length > 0) {
      return res.status(200).json({ ok: true, mensaje: 'Pago ya procesado' });
    }

    // Registrar el pago
    await supabase('pagos', 'POST', {
      usuario_id: usuario.id,
      wompi_transaction_id: wompi_id,
      monto: Math.round(amount_in_cents / 100),
      moneda: 'COP',
      estado: 'APPROVED',
      metodo_pago: transaccion.payment_method_type || 'WOMPI',
    });

    // Activar usuario
    await supabase(`usuarios?id=eq.${usuario.id}`, 'PATCH', {
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

    // Enviar correo de bienvenida
    await enviarCorreoBienvenida(customer_email, usuario.nombre_completo);

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