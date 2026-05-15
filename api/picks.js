// api/picks.js
// POST /api/picks — Guardar picks del usuario autenticado (usa SERVICE_KEY, bypasses RLS)
// GET  /api/picks — Cargar picks del usuario autenticado

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function getUsuarioId(access_token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${access_token}` }
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.id || null;
}

async function sbGet(table, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${SUPABASE_URL}/rest/v1/${table}${qs ? '?' + qs : ''}`;
  const r = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return null; }
}

async function sbPatch(table, params, body) {
  const qs = new URLSearchParams(params).toString();
  const url = `${SUPABASE_URL}/rest/v1/${table}${qs ? '?' + qs : ''}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(body)
  });
  return r.ok;
}

async function sbDelete(table, params) {
  const qs = new URLSearchParams(params).toString();
  const url = `${SUPABASE_URL}/rest/v1/${table}${qs ? '?' + qs : ''}`;
  const r = await fetch(url, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  return r.ok;
}

async function sbInsert(table, body) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(body)
  });
  return r.ok;
}

// Sincroniza picks_killer, picks_equipos y predicciones a partir del picks_data completo.
// Si un jugador/equipo/partido no existe aún en la tabla (e.g. equipo no cargado), se omite sin error.
async function sincronizarRelacional(userId, nuevo) {
  const [jugadores, equipos, partidos] = await Promise.all([
    sbGet('jugadores', { select: 'id,nombre_corto' }),
    sbGet('equipos',   { select: 'id,codigo_fifa' }),
    sbGet('partidos',  { select: 'id,numero_partido' }),
  ]);

  const jugMap = {}; // datos.js ID (nombre_corto) → UUID
  if (Array.isArray(jugadores)) jugadores.forEach(j => { if (j.nombre_corto) jugMap[j.nombre_corto] = j.id; });

  const eqMap = {}; // codigo_fifa → UUID
  if (Array.isArray(equipos)) equipos.forEach(e => { if (e.codigo_fifa) eqMap[e.codigo_fifa] = e.id; });

  const parMap = {}; // numero_partido → UUID
  if (Array.isArray(partidos)) partidos.forEach(p => { if (p.numero_partido) parMap[p.numero_partido] = p.id; });

  // Borrar registros actuales del usuario en las tres tablas
  await Promise.all([
    sbDelete('picks_killer',  { 'usuario_id': `eq.${userId}` }),
    sbDelete('picks_equipos', { 'usuario_id': `eq.${userId}` }),
    sbDelete('predicciones',  { 'usuario_id': `eq.${userId}` }),
  ]);

  // picks_killer: datos.js ID → jugador UUID (omite IDs de equipos no cargados aún)
  const killerRows = (nuevo.killer || [])
    .filter(id => jugMap[id])
    .map(id => ({ usuario_id: userId, jugador_id: jugMap[id] }));

  // picks_equipos: código de equipo → equipo UUID + categoría correcta para CHECK constraint
  const CATS = [
    { key: 'carnicero', cat: 'carnicero'  },
    { key: 'banderin',  cat: 'banderin'   },
    { key: 'virgen',    cat: 'virgen'     },
    { key: 'pied',      cat: 'pie_de_nina' },
    { key: 'mecha',     cat: 'mechacorta' },
  ];
  const equiposRows = [];
  for (const { key, cat } of CATS) {
    for (const code of (nuevo[key] || [])) {
      if (eqMap[code]) equiposRows.push({ usuario_id: userId, equipo_id: eqMap[code], categoria: cat });
    }
  }

  // predicciones: p0→numero_partido 1, p1→2, ...
  const predRows = [];
  for (const [pKey, pred] of Object.entries(nuevo.lev || {})) {
    const idx = parseInt(pKey.replace('p', ''), 10);
    const partUUID = parMap[idx + 1];
    if (partUUID && pred) predRows.push({ usuario_id: userId, partido_id: partUUID, prediccion: pred });
  }

  const inserts = [];
  if (killerRows.length)  inserts.push(sbInsert('picks_killer',  killerRows));
  if (equiposRows.length) inserts.push(sbInsert('picks_equipos', equiposRows));
  if (predRows.length)    inserts.push(sbInsert('predicciones',  predRows));
  if (inserts.length) await Promise.all(inserts);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Autenticación ──────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization || '';
  const access_token = authHeader.replace('Bearer ', '').trim();
  if (!access_token) return res.status(401).json({ error: 'Token requerido' });

  const userId = await getUsuarioId(access_token);
  if (!userId) return res.status(401).json({ error: 'Token inválido o expirado' });

  // ── GET: cargar picks ──────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const rows = await sbGet('usuarios', { 'id': `eq.${userId}`, select: 'picks_data,picks_completos' });
    const row = Array.isArray(rows) ? rows[0] : null;
    return res.json({ picks_data: row?.picks_data || {}, picks_completos: row?.picks_completos || false });
  }

  // ── POST: guardar picks ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { cat, state } = req.body || {};
    if (!state) return res.status(400).json({ error: 'Falta state' });

    // Leer picks actuales del usuario
    const rows = await sbGet('usuarios', { 'id': `eq.${userId}`, select: 'picks_data,picks_completos' });
    const row = Array.isArray(rows) ? rows[0] : null;
    const base = row?.picks_data || {};

    // Mezclar: solo la categoría enviada (o todas si cat = '__todos__')
    const nuevo = { ...base };
    if (cat === '__todos__' || cat === 'lev')       nuevo.lev       = state.lev       ?? base.lev       ?? {};
    if (cat === '__todos__' || cat === 'killer')     nuevo.killer    = state.killer    ?? base.killer    ?? [];
    if (cat === '__todos__' || cat === 'carnicero')  nuevo.carnicero = state.carnicero ?? base.carnicero ?? [];
    if (cat === '__todos__' || cat === 'banderin')   nuevo.banderin  = state.banderin  ?? base.banderin  ?? [];
    if (cat === '__todos__' || cat === 'virgen')     nuevo.virgen    = state.virgen    ?? base.virgen    ?? [];
    if (cat === '__todos__' || cat === 'pied')       nuevo.pied      = state.pied      ?? base.pied      ?? [];
    if (cat === '__todos__' || cat === 'mecha')      nuevo.mecha     = state.mecha     ?? base.mecha     ?? [];

    // Evaluar si están completos
    const picks_completos =
      Object.keys(nuevo.lev || {}).length >= 72 &&
      (nuevo.killer || []).length >= 15 &&
      (nuevo.carnicero || []).length >= 10;

    // Guardar en usuarios (fuente de verdad principal)
    const ok = await sbPatch('usuarios', { 'id': `eq.${userId}` }, { picks_data: nuevo, picks_completos });
    if (!ok) return res.status(500).json({ error: 'Error guardando en base de datos' });

    // Intentar guardar también en cupo activo (si existe la tabla)
    try {
      const cupos = await sbGet('cupos', { 'usuario_id': `eq.${userId}`, 'numero': 'eq.1', select: 'id' });
      const cupo = Array.isArray(cupos) && cupos[0];
      if (cupo?.id) {
        await sbPatch('cupos', { 'id': `eq.${cupo.id}` }, { picks_data: nuevo, picks_completos });
      }
    } catch (_) { /* tabla cupos puede no existir aún */ }

    // Sincronizar tablas relacionales (best-effort: no falla el request si hay error)
    try { await sincronizarRelacional(userId, nuevo); } catch (_) {}

    return res.json({ ok: true, picks_completos });
  }

  return res.status(405).json({ error: 'Método no permitido' });
}
