// api/crear-usuario-admin.js
// POST — Admin crea un usuario manualmente (activo=true, correo de bienvenida incluido)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM    = process.env.RESEND_FROM_EMAIL || 'noreply@roscamundial.com';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function verificarAdmin(token) {
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: perfil } = await supabase.from('usuarios').select('es_admin').eq('id', user.id).single();
  return perfil?.es_admin ? user : null;
}

function buildWelcomeHtml(nombre) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
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
          Tu inscripción en la <strong>Rosca Mundial 2026</strong> ha sido confirmada.<br>
          Ya puedes ingresar a la plataforma y comenzar a hacer tus picks.
        </div>
        <div style="background:#1a2235;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
          <div style="font-size:12px;color:#6b7a99;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Fechas clave</div>
          <div style="font-size:13px;color:#e8eaf0;line-height:2;">
            🔒 <strong>Cierre de picks:</strong> 11 de junio 2026, 5:30 PM<br>
            ⚽ <strong>Inicio del Mundial:</strong> 11 de junio 2026, 6:00 PM<br>
            🏆 <strong>Final del Mundial:</strong> 19 de julio 2026
          </div>
        </div>
        <a href="https://roscamundial.com/login.html"
           style="display:block;text-align:center;background:linear-gradient(135deg,#FCD116,#e5a800);color:#000;font-weight:700;font-size:15px;padding:14px;border-radius:10px;text-decoration:none;letter-spacing:1px;">
          ⚡ IR A MIS PICKS
        </a>
      </div>
      <div style="text-align:center;margin-top:20px;font-size:11px;color:#6b7a99;">
        roscamundial.com · Montería, Colombia · 2026
      </div>
    </div>
  </body></html>`;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  const adminUser = await verificarAdmin(token);
  if (!adminUser) return res.status(403).json({ error: 'Solo admins pueden usar este endpoint' });

  const {
    nombre_completo,
    correo,
    celular,
    documento,
    password,
    ciudad = '',
    enviar_correo = true,
  } = req.body || {};

  if (!nombre_completo || !correo || !celular || !documento || !password) {
    return res.status(400).json({ error: 'Faltan campos: nombre_completo, correo, celular, documento, password' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener mínimo 8 caracteres' });
  }

  const { data: correoExiste } = await supabase.from('usuarios').select('id').eq('correo', correo.toLowerCase()).maybeSingle();
  if (correoExiste) return res.status(409).json({ error: 'Este correo ya está registrado' });

  const { data: docExiste } = await supabase.from('usuarios').select('id').eq('documento', documento).maybeSingle();
  if (docExiste) return res.status(409).json({ error: 'Este documento ya está registrado' });

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: correo.toLowerCase(),
    password,
    email_confirm: true,
  });
  if (authError) {
    if (authError.message.includes('already registered')) return res.status(409).json({ error: 'Correo ya registrado en Auth' });
    return res.status(500).json({ error: 'Error creando cuenta: ' + authError.message });
  }

  const userId = authData.user.id;

  const partes = nombre_completo.trim().split(/\s+/);
  const baseAlias = partes.length >= 2 ? `${partes[0]} ${partes[1]}` : partes[0];
  let alias = baseAlias;
  let intento = 1;
  while (true) {
    const { data: existe } = await supabase.from('usuarios').select('id').eq('nombre_usuario', alias).maybeSingle();
    if (!existe) break;
    intento++;
    alias = `${baseAlias}${intento}`;
  }

  const { error: dbError } = await supabase.from('usuarios').insert({
    id: userId,
    nombre_completo: nombre_completo.trim(),
    nombre_usuario: alias,
    correo: correo.toLowerCase(),
    celular: celular.trim(),
    documento: documento.trim(),
    ciudad: ciudad.trim(),
    pais: 'Colombia',
    activo: true,
    picks_completos: false,
    password_hash: 'auth_managed_by_supabase',
  });

  if (dbError) {
    await supabase.auth.admin.deleteUser(userId);
    return res.status(500).json({ error: 'Error guardando datos: ' + dbError.message });
  }

  await supabase.from('cupos').insert({
    usuario_id: userId,
    numero: 1,
    alias,
    activo: true,
    picks_data: {},
    picks_completos: false,
  }).catch(() => {});

  await supabase.from('logs').insert({
    usuario_id: userId,
    accion: 'registro_por_admin',
    detalle: { correo, nombre_completo, ciudad, admin_id: adminUser.id },
  }).catch(() => {});

  if (enviar_correo) {
    try {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `Rosca Mundial <${RESEND_FROM}>`,
          to: correo.toLowerCase(),
          subject: '✅ ¡Registro confirmado! Ya estás en la Rosca Mundial 2026',
          html: buildWelcomeHtml(nombre_completo.trim()),
        }),
      });
      if (!emailRes.ok) {
        const eData = await emailRes.json().catch(() => ({}));
        console.error('Error Resend:', eData);
      }
    } catch (e) {
      console.error('Error enviando correo bienvenida:', e);
    }
  }

  return res.status(200).json({
    ok: true,
    usuario_id: userId,
    alias,
    mensaje: `Usuario "${nombre_completo.trim()}" creado y activado correctamente`,
  });
}
