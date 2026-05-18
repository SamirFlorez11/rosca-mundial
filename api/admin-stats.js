// api/admin-stats.js
// Devuelve stats del panel admin usando service key (bypassa RLS)
// Autenticado mediante el JWT de sesión de Supabase (verifica es_admin)

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SERVICE_KEY      = process.env.SUPABASE_SERVICE_KEY;

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

async function sbCount(table, filters = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&${filters}`;
  const res = await fetch(url, {
    method: 'HEAD',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'count=exact',
    },
  });
  const raw = res.headers.get('content-range') || '';
  const match = raw.match(/\/(\d+)$/);
  return match ? parseInt(match[1]) : 0;
}

async function sbGet(table, params = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
  const res = await fetch(url, {
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return []; }
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Verificar JWT de sesión
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${token}` },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Token inválido' });
  const { id: userId } = await userRes.json();

  // Verificar que sea admin
  const perfil = await sbGet('usuarios', `id=eq.${userId}&select=es_admin`);
  if (!perfil?.[0]?.es_admin) return res.status(403).json({ error: 'No autorizado' });

  try {
    const tipo = req.query.tipo || 'stats';

    // ── STATS GENERALES ────────────────────────────────────────────────────────
    if (tipo === 'stats') {
      const [inscritos, picksOk] = await Promise.all([
        sbCount('usuarios', 'activo=eq.true&es_admin=eq.false'),
        sbCount('usuarios', 'activo=eq.true&es_admin=eq.false&picks_completos=eq.true'),
      ]);
      return res.status(200).json({
        ok: true,
        inscritos,
        picksOk,
        sinPicks: Math.max(0, inscritos - picksOk),
      });
    }

    // ── VISITAS ────────────────────────────────────────────────────────────────
    if (tipo === 'visitas') {
      const ahora = new Date();
      const hoy   = ahora.toISOString().slice(0, 10);
      const semana = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const mes   = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString();

      // Verificar que la tabla visitas existe antes de consultarla
      const testRes = await fetch(`${SUPABASE_URL}/rest/v1/visitas?select=id&limit=1`, {
        method: 'HEAD',
        headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Prefer': 'count=exact' },
      });

      if (!testRes.ok) {
        return res.status(200).json({ ok: true, tablaExiste: false, hoy: null, semana: null, mes: null, total: null });
      }

      const [cHoy, cSemana, cMes, cTotal] = await Promise.all([
        sbCount('visitas', `created_at=gte.${hoy}T00%3A00%3A00Z`),
        sbCount('visitas', `created_at=gte.${encodeURIComponent(semana)}`),
        sbCount('visitas', `created_at=gte.${encodeURIComponent(mes)}`),
        sbCount('visitas', ''),
      ]);

      return res.status(200).json({ ok: true, tablaExiste: true, hoy: cHoy, semana: cSemana, mes: cMes, total: cTotal });
    }

    return res.status(400).json({ error: 'tipo inválido' });

  } catch (e) {
    console.error('admin-stats error:', e);
    return res.status(500).json({ error: e.message });
  }
}
