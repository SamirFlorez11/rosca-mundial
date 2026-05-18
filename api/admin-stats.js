// api/admin-stats.js
// Stats del panel admin con service key (bypassa RLS)
// Auth: JWT de sesión Supabase en header Authorization

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

const HEADERS = {
  'apikey':        SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
};

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

// Cuenta filas usando GET + Range:0-0 + Prefer:count=exact
// PostgREST devuelve el total en Content-Range: 0-0/TOTAL
async function sbCount(table, params = {}) {
  const qs = new URLSearchParams({ select: 'id', ...params }).toString();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    headers: { ...HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' },
  });
  const raw = r.headers.get('content-range') || '';
  const m = raw.match(/\/(\d+)$/);
  return m ? parseInt(m[1]) : 0;
}

// Fetch simple GET → devuelve array JSON
async function sbGet(table, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs ? '?' + qs : ''}`, { headers: HEADERS });
  const txt = await r.text();
  try { return JSON.parse(txt); } catch { return []; }
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Auth: verificar JWT de sesión ──────────────────────────────────────────
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  const authR = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${token}` },
  });
  if (!authR.ok) return res.status(401).json({ error: 'Token inválido' });
  const { id: userId } = await authR.json();

  const perfil = await sbGet('usuarios', { id: `eq.${userId}`, select: 'es_admin' });
  if (!perfil?.[0]?.es_admin) return res.status(403).json({ error: 'No autorizado' });

  const tipo = req.query.tipo || 'stats';

  try {

    // ── STATS GENERALES ──────────────────────────────────────────────────────
    if (tipo === 'stats') {
      const [inscritos, picksOk] = await Promise.all([
        sbCount('usuarios', { activo: 'eq.true', es_admin: 'eq.false' }),
        sbCount('usuarios', { activo: 'eq.true', es_admin: 'eq.false', picks_completos: 'eq.true' }),
      ]);
      return res.status(200).json({
        ok: true,
        inscritos,
        picksOk,
        sinPicks: Math.max(0, inscritos - picksOk),
      });
    }

    // ── VISITAS ──────────────────────────────────────────────────────────────
    if (tipo === 'visitas') {
      // Comprobar si la tabla visitas existe con una query GET simple
      const testR = await fetch(`${SUPABASE_URL}/rest/v1/visitas?select=id&limit=1`, {
        headers: HEADERS,
      });
      if (!testR.ok) {
        return res.status(200).json({ ok: true, tablaExiste: false });
      }

      const ahora  = new Date();
      const hoy    = ahora.toISOString().slice(0, 10) + 'T00:00:00Z';
      const semana = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const mes    = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString();

      const [cHoy, cSemana, cMes, cTotal] = await Promise.all([
        sbCount('visitas', { created_at: `gte.${hoy}` }),
        sbCount('visitas', { created_at: `gte.${semana}` }),
        sbCount('visitas', { created_at: `gte.${mes}` }),
        sbCount('visitas', {}),
      ]);

      return res.status(200).json({
        ok: true,
        tablaExiste: true,
        hoy:    cHoy,
        semana: cSemana,
        mes:    cMes,
        total:  cTotal,
      });
    }

    return res.status(400).json({ error: 'tipo desconocido' });

  } catch (e) {
    console.error('[admin-stats]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
