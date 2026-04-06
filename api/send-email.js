// api/send-email.js
// Endpoint para envío de correos — Rosca Mundial 2026
// Vercel Serverless Function

export default async function handler(req, res) {

  // Solo acepta POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { tipo, destinatario, nombre, datos } = req.body;

  if (!tipo || !destinatario || !nombre) {
    return res.status(400).json({ error: 'Faltan campos requeridos: tipo, destinatario, nombre' });
  }

  // Construir el correo según el tipo
  let asunto = '';
  let html = '';

  switch (tipo) {

    // =============================================
    // 1. CONFIRMACIÓN DE REGISTRO Y PAGO
    // =============================================
    case 'confirmacion_registro':
      asunto = '✅ ¡Bienvenido a Rosca Mundial 2026!';
      html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
          <div style="background: linear-gradient(135deg, #F5C400 0%, #F5C400 40%, #003087 40%, #003087 65%, #CE1126 65%); padding: 40px 32px; text-align: center;">
            <h1 style="font-size: 36px; letter-spacing: 4px; color: white; margin: 0; text-shadow: 0 2px 8px rgba(0,0,0,0.3);">ROSCA MUNDIAL</h1>
            <p style="color: rgba(255,255,255,0.8); font-size: 14px; letter-spacing: 6px; margin: 4px 0 0;">COPA 2026</p>
          </div>
          <div style="padding: 32px;">
            <h2 style="color: #0D1B3E; font-size: 22px;">¡Hola ${nombre}! 👋</h2>
            <p style="color: #4B5563; font-size: 15px; line-height: 1.7;">Tu inscripción en <strong>Rosca Mundial 2026</strong> fue registrada exitosamente y tu pago ha sido confirmado.</p>
            <div style="background: #F0FDF4; border-left: 4px solid #10B981; padding: 16px 20px; border-radius: 0 8px 8px 0; margin: 20px 0;">
              <p style="margin: 0; color: #065F46; font-weight: bold; font-size: 14px;">✅ Pago confirmado por $60.000 COP</p>
              <p style="margin: 6px 0 0; color: #065F46; font-size: 13px;">Tu cupo está asegurado. Ya puedes ingresar y realizar tus picks.</p>
            </div>
            <h3 style="color: #0D1B3E; font-size: 16px; margin-top: 24px;">¿Qué sigue?</h3>
            <ol style="color: #4B5563; font-size: 14px; line-height: 2;">
              <li>Ingresa a <a href="https://roscamundial.com/login.html" style="color: #003087; font-weight: bold;">roscamundial.com</a></li>
              <li>Realiza tus <strong>picks de equipos</strong> para las 5 categorías especiales (10 equipos cada una)</li>
              <li>Realiza tus <strong>picks del Killer</strong> — 15 jugadores, máx. 3 del mismo equipo</li>
              <li>Predice los resultados de la <strong>fase de grupos</strong> (L / E / V)</li>
            </ol>
            <div style="background: #FEF2F2; border-left: 4px solid #CE1126; padding: 14px 18px; border-radius: 0 8px 8px 0; margin: 20px 0;">
              <p style="margin: 0; color: #991B1B; font-size: 13px; font-weight: bold;">⏰ Todos los picks deben realizarse antes del 11 de junio de 2026 a las 5:30 PM (hora Colombia)</p>
            </div>
            <div style="text-align: center; margin: 28px 0;">
              <a href="https://roscamundial.com/login.html" style="background: #003087; color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-size: 16px; font-weight: bold; letter-spacing: 2px;">IR A MIS PICKS →</a>
            </div>
            <p style="color: #9CA3AF; font-size: 12px; text-align: center; margin-top: 24px;">Los datos del torneo son tomados de <strong>Sportmonks</strong> — fuente oficial de estadísticas deportivas.</p>
          </div>
          <div style="background: #0D1B3E; padding: 20px; text-align: center;">
            <p style="color: rgba(255,255,255,0.5); font-size: 12px; margin: 0;">Rosca Mundial 2026 · roscamundial.com · Montería, Colombia</p>
          </div>
        </div>
      `;
      break;

    // =============================================
    // 2. CONFIRMACIÓN DE PICKS (con PDF adjunto)
    // =============================================
    case 'confirmacion_picks':
      asunto = '📋 Tus picks de Rosca Mundial 2026 — Copia oficial';
      html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
          <div style="background: linear-gradient(135deg, #F5C400 0%, #F5C400 40%, #003087 40%, #003087 65%, #CE1126 65%); padding: 40px 32px; text-align: center;">
            <h1 style="font-size: 36px; letter-spacing: 4px; color: white; margin: 0; text-shadow: 0 2px 8px rgba(0,0,0,0.3);">ROSCA MUNDIAL</h1>
            <p style="color: rgba(255,255,255,0.8); font-size: 14px; letter-spacing: 6px; margin: 4px 0 0;">COPA 2026</p>
          </div>
          <div style="padding: 32px;">
            <h2 style="color: #0D1B3E; font-size: 22px;">¡Picks confirmados, ${nombre}! 🎉</h2>
            <p style="color: #4B5563; font-size: 15px; line-height: 1.7;">Los picks han sido <strong>cerrados oficialmente</strong>. Adjunto encontrarás el PDF con el registro completo de tus selecciones.</p>
            <div style="background: #FFF8E8; border-left: 4px solid #F5C400; padding: 16px 20px; border-radius: 0 8px 8px 0; margin: 20px 0;">
              <p style="margin: 0; color: #92400E; font-weight: bold; font-size: 14px;">📎 El PDF adjunto es tu comprobante oficial</p>
              <p style="margin: 6px 0 0; color: #92400E; font-size: 13px;">Guárdalo — es la evidencia de tus picks antes del inicio del mundial.</p>
            </div>
            <div style="background: #F9FAFB; border-radius: 10px; padding: 20px; margin: 20px 0;">
              <h3 style="color: #0D1B3E; font-size: 15px; margin: 0 0 12px;">Resumen de tus picks:</h3>
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <tr style="border-bottom: 1px solid #E5E7EB;">
                  <td style="padding: 8px 0; color: #6B7280;">El Killer (15 jugadores)</td>
                  <td style="padding: 8px 0; color: #0D1B3E; font-weight: bold; text-align: right;">${datos?.killer_count || 15} seleccionados</td>
                </tr>
                <tr style="border-bottom: 1px solid #E5E7EB;">
                  <td style="padding: 8px 0; color: #6B7280;">El Virgen (10 equipos)</td>
                  <td style="padding: 8px 0; color: #0D1B3E; font-weight: bold; text-align: right;">${datos?.virgen_count || 10} seleccionados</td>
                </tr>
                <tr style="border-bottom: 1px solid #E5E7EB;">
                  <td style="padding: 8px 0; color: #6B7280;">El Carnicero (10 equipos)</td>
                  <td style="padding: 8px 0; color: #0D1B3E; font-weight: bold; text-align: right;">${datos?.carnicero_count || 10} seleccionados</td>
                </tr>
                <tr style="border-bottom: 1px solid #E5E7EB;">
                  <td style="padding: 8px 0; color: #6B7280;">El Pie de Niña (10 equipos)</td>
                  <td style="padding: 8px 0; color: #0D1B3E; font-weight: bold; text-align: right;">${datos?.pie_nina_count || 10} seleccionados</td>
                </tr>
                <tr style="border-bottom: 1px solid #E5E7EB;">
                  <td style="padding: 8px 0; color: #6B7280;">El Banderín (10 equipos)</td>
                  <td style="padding: 8px 0; color: #0D1B3E; font-weight: bold; text-align: right;">${datos?.banderin_count || 10} seleccionados</td>
                </tr>
                <tr style="border-bottom: 1px solid #E5E7EB;">
                  <td style="padding: 8px 0; color: #6B7280;">El Mechacorta (10 equipos)</td>
                  <td style="padding: 8px 0; color: #0D1B3E; font-weight: bold; text-align: right;">${datos?.mechacorta_count || 10} seleccionados</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6B7280;">Predicciones fase de grupos</td>
                  <td style="padding: 8px 0; color: #0D1B3E; font-weight: bold; text-align: right;">${datos?.predicciones_count || 48} partidos</td>
                </tr>
              </table>
            </div>
            <p style="color: #9CA3AF; font-size: 12px; text-align: center;">¡Mucha suerte! El mundial comienza el <strong>11 de junio de 2026</strong>.</p>
          </div>
          <div style="background: #0D1B3E; padding: 20px; text-align: center;">
            <p style="color: rgba(255,255,255,0.5); font-size: 12px; margin: 0;">Rosca Mundial 2026 · roscamundial.com · Montería, Colombia</p>
          </div>
        </div>
      `;
      break;

    // =============================================
    // 3. RECORDATORIO DE PICKS PENDIENTES
    // =============================================
    case 'recordatorio_picks':
      asunto = '⚠️ Tienes picks pendientes — Rosca Mundial 2026';
      html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
          <div style="background: #CE1126; padding: 32px; text-align: center;">
            <h1 style="font-size: 32px; letter-spacing: 4px; color: white; margin: 0;">⚠️ PICKS PENDIENTES</h1>
            <p style="color: rgba(255,255,255,0.8); font-size: 13px; margin: 6px 0 0;">Rosca Mundial 2026</p>
          </div>
          <div style="padding: 32px;">
            <h2 style="color: #0D1B3E; font-size: 20px;">Hola ${nombre}, ¡se acaba el tiempo!</h2>
            <p style="color: #4B5563; font-size: 15px; line-height: 1.7;">Faltan menos de <strong>48 horas</strong> para el cierre de picks. El mundial comienza el <strong>11 de junio de 2026 a las 6:00 PM</strong> (hora Colombia) y los picks se cierran 30 minutos antes.</p>
            <p style="color: #4B5563; font-size: 14px;">Aún tienes <strong style="color: #CE1126;">${datos?.faltantes || 'algunos'} picks pendientes</strong>. Si no los completas, tu puntuación se verá afectada.</p>
            <div style="text-align: center; margin: 28px 0;">
              <a href="https://roscamundial.com/picks.html" style="background: #CE1126; color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-size: 16px; font-weight: bold; letter-spacing: 2px;">COMPLETAR PICKS AHORA →</a>
            </div>
          </div>
          <div style="background: #0D1B3E; padding: 20px; text-align: center;">
            <p style="color: rgba(255,255,255,0.5); font-size: 12px; margin: 0;">Rosca Mundial 2026 · roscamundial.com</p>
          </div>
        </div>
      `;
      break;

    // =============================================
    // 4. FASE DESBLOQUEADA
    // =============================================
    case 'fase_desbloqueada':
      asunto = `🔓 Nueva fase disponible: ${datos?.fase || 'siguiente fase'} — Rosca Mundial`;
      html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
          <div style="background: #003087; padding: 32px; text-align: center;">
            <h1 style="font-size: 32px; letter-spacing: 4px; color: #F5C400; margin: 0;">🔓 NUEVA FASE</h1>
            <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 6px 0 0;">Rosca Mundial 2026</p>
          </div>
          <div style="padding: 32px;">
            <h2 style="color: #0D1B3E; font-size: 20px;">¡Hola ${nombre}!</h2>
            <p style="color: #4B5563; font-size: 15px; line-height: 1.7;">La fase de <strong>${datos?.fase || 'siguiente fase'}</strong> ya está disponible. Tienes hasta <strong>${datos?.deadline || 'antes del siguiente partido'}</strong> para realizar tus predicciones.</p>
            <div style="text-align: center; margin: 28px 0;">
              <a href="https://roscamundial.com/picks.html" style="background: #003087; color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-size: 16px; font-weight: bold; letter-spacing: 2px;">HACER PICKS AHORA →</a>
            </div>
          </div>
          <div style="background: #0D1B3E; padding: 20px; text-align: center;">
            <p style="color: rgba(255,255,255,0.5); font-size: 12px; margin: 0;">Rosca Mundial 2026 · roscamundial.com</p>
          </div>
        </div>
      `;
      break;

    // =============================================
    // 5. RESTABLECIMIENTO DE CONTRASEÑA
    // =============================================
    case 'reset_password':
      asunto = '🔐 Restablecer contraseña — Rosca Mundial 2026';
      html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
          <div style="background: #0D1B3E; padding: 32px; text-align: center;">
            <h1 style="font-size: 32px; letter-spacing: 4px; color: white; margin: 0;">🔐 RESTABLECER</h1>
            <p style="color: rgba(255,255,255,0.6); font-size: 13px; margin: 6px 0 0;">Contraseña · Rosca Mundial 2026</p>
          </div>
          <div style="padding: 32px;">
            <h2 style="color: #0D1B3E; font-size: 20px;">Hola ${nombre}</h2>
            <p style="color: #4B5563; font-size: 15px; line-height: 1.7;">Recibimos una solicitud para restablecer tu contraseña. Click en el botón para crear una nueva:</p>
            <div style="text-align: center; margin: 28px 0;">
              <a href="${datos?.reset_url || 'https://roscamundial.com'}" style="background: #0D1B3E; color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-size: 16px; font-weight: bold;">CREAR NUEVA CONTRASEÑA</a>
            </div>
            <p style="color: #9CA3AF; font-size: 12px; text-align: center;">Este enlace expira en 1 hora. Si no solicitaste este cambio, ignora este correo.</p>
          </div>
          <div style="background: #0D1B3E; padding: 20px; text-align: center;">
            <p style="color: rgba(255,255,255,0.5); font-size: 12px; margin: 0;">Rosca Mundial 2026 · roscamundial.com</p>
          </div>
        </div>
      `;
      break;

    default:
      return res.status(400).json({ error: `Tipo de correo no reconocido: ${tipo}` });
  }

  // Enviar con Resend
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: `Rosca Mundial <${process.env.RESEND_FROM_EMAIL}>`,
        to: [destinatario],
        subject: asunto,
        html: html,
        ...(datos?.pdf_base64 && {
          attachments: [{
            filename: `rosca-mundial-picks-${nombre.replace(/\s+/g, '-').toLowerCase()}.pdf`,
            content: datos.pdf_base64
          }]
        })
      })
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Error Resend:', result);
      return res.status(500).json({ error: 'Error enviando correo', detalle: result });
    }

    return res.status(200).json({ exito: true, id: result.id });

  } catch (error) {
    console.error('Error enviando correo:', error);
    return res.status(500).json({ error: 'Error interno enviando correo' });
  }
}
