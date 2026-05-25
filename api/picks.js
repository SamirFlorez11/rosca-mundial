// api/picks.js
// POST /api/picks — Guardar picks del usuario autenticado (usa SERVICE_KEY, bypasses RLS)
// GET  /api/picks — Cargar picks del usuario autenticado

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

const EQUIPO_CATS = ['carnicero', 'banderin', 'virgen', 'pied', 'mecha'];
const CAT_DB_MAP  = { carnicero: 'carnicero', banderin: 'banderin', virgen: 'virgen', pied: 'pie_de_nina', mecha: 'mechacorta' };

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

// Sincroniza SOLO la tabla relacional correspondiente a la categoría guardada.
// cat='lev'      → predicciones
// cat='killer'   → picks_killer
// cat=equipo     → picks_equipos (solo esa categoría)
// cat='__todos__'→ las tres tablas completas
async function sincronizarRelacional(userId, nuevo, cat) {
  const sincLEV    = cat === '__todos__' || cat === 'lev';
  const sincKiller = cat === '__todos__' || cat === 'killer';
  const sincEquipo = cat === '__todos__' || EQUIPO_CATS.includes(cat);

  // Traer solo los datos de referencia que necesitamos
  const [jugadores, equipos, partidos] = await Promise.all([
    sincKiller ? sbGet('jugadores', { select: 'id,nombre_corto' }) : Promise.resolve([]),
    sincEquipo ? sbGet('equipos',   { select: 'id,codigo_fifa' })  : Promise.resolve([]),
    sincLEV    ? sbGet('partidos',  { select: 'id,numero_partido' }): Promise.resolve([]),
  ]);

  const jugMap = {};
  if (Array.isArray(jugadores)) jugadores.forEach(j => { if (j.nombre_corto) jugMap[j.nombre_corto] = j.id; });

  const eqMap = {};
  if (Array.isArray(equipos)) equipos.forEach(e => { if (e.codigo_fifa) eqMap[e.codigo_fifa] = e.id; });

  const parMap = {};
  if (Array.isArray(partidos)) partidos.forEach(p => { if (p.numero_partido) parMap[p.numero_partido] = p.id; });

  // Borrar solo lo que vamos a reemplazar
  const deletes = [];
  if (sincKiller) deletes.push(sbDelete('picks_killer', { 'usuario_id': `eq.${userId}` }));
  if (sincLEV)    deletes.push(sbDelete('predicciones', { 'usuario_id': `eq.${userId}` }));
  if (sincEquipo) {
    if (cat === '__todos__') {
      // Borrar todas las categorías de equipos
      deletes.push(sbDelete('picks_equipos', { 'usuario_id': `eq.${userId}` }));
    } else {
      // Borrar solo la categoría específica guardada
      deletes.push(sbDelete('picks_equipos', { 'usuario_id': `eq.${userId}`, 'categoria': `eq.${CAT_DB_MAP[cat]}` }));
    }
  }
  await Promise.all(deletes);

  // Insertar
  const inserts = [];

  if (sincKiller) {
    const rows = (nuevo.killer || [])
      .filter(id => jugMap[id])
      .map(id => ({ usuario_id: userId, jugador_id: jugMap[id] }));
    if (rows.length) inserts.push(sbInsert('picks_killer', rows));
  }

  if (sincEquipo) {
    const catsToSync = cat === '__todos__'
      ? EQUIPO_CATS.map(k => ({ key: k, dbCat: CAT_DB_MAP[k] }))
      : [{ key: cat, dbCat: CAT_DB_MAP[cat] }];

    const rows = [];
    for (const { key, dbCat } of catsToSync) {
      for (const code of (nuevo[key] || [])) {
        if (eqMap[code]) rows.push({ usuario_id: userId, equipo_id: eqMap[code], categoria: dbCat });
      }
    }
    if (rows.length) inserts.push(sbInsert('picks_equipos', rows));
  }

  if (sincLEV) {
    const rows = [];
    for (const [pKey, pred] of Object.entries(nuevo.lev || {})) {
      const idx = parseInt(pKey.replace('p', ''), 10);
      const partUUID = parMap[idx + 1]; // p0 → numero_partido=1
      if (partUUID && pred) rows.push({ usuario_id: userId, partido_id: partUUID, prediccion: pred });
    }
    if (rows.length) inserts.push(sbInsert('predicciones', rows));
  }

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
    const cupo_id = req.query.cupo_id;

    if (cupo_id) {
      // Cargar desde cupo específico (verificando que pertenece al usuario)
      try {
        const cupos = await sbGet('cupos', { 'id': `eq.${cupo_id}`, 'usuario_id': `eq.${userId}`, select: 'id,numero,alias,picks_data,picks_completos' });
        const cupo = Array.isArray(cupos) ? cupos[0] : null;
        if (!cupo) return res.status(404).json({ error: 'Cupo no encontrado' });
        return res.json({ picks_data: cupo.picks_data || {}, picks_completos: cupo.picks_completos || false, cupo_numero: cupo.numero, cupo_alias: cupo.alias });
      } catch (_) { /* tabla cupos puede no existir, fallback a usuarios */ }
    }

    // Sin cupo_id: cargar desde usuarios (cupo principal / backward compat)
    const rows = await sbGet('usuarios', { 'id': `eq.${userId}`, select: 'picks_data,picks_completos' });
    const row = Array.isArray(rows) ? rows[0] : null;
    return res.json({ picks_data: row?.picks_data || {}, picks_completos: row?.picks_completos || false });
  }

  // ── POST: guardar picks ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { cat, state, cupo_id } = req.body || {};
    if (!state) return res.status(400).json({ error: 'Falta state' });

    if (cupo_id) {
      // ── Guardar en cupo específico ─────────────────────────────────────────
      // Verificar que el cupo pertenece al usuario
      let cupoActual = null;
      try {
        const cupos = await sbGet('cupos', { 'id': `eq.${cupo_id}`, 'usuario_id': `eq.${userId}`, select: 'id,numero,picks_data' });
        cupoActual = Array.isArray(cupos) ? cupos[0] : null;
      } catch (_) {}
      if (!cupoActual) return res.status(404).json({ error: 'Cupo no encontrado' });

      const base = cupoActual.picks_data || {};
      const nuevo = { ...base };
      if (cat === '__todos__' || cat === 'lev')       nuevo.lev       = state.lev       ?? base.lev       ?? {};
      if (cat === '__todos__' || cat === 'killer')     nuevo.killer    = state.killer    ?? base.killer    ?? [];
      if (cat === '__todos__' || cat === 'carnicero')  nuevo.carnicero = state.carnicero ?? base.carnicero ?? [];
      if (cat === '__todos__' || cat === 'banderin')   nuevo.banderin  = state.banderin  ?? base.banderin  ?? [];
      if (cat === '__todos__' || cat === 'virgen')     nuevo.virgen    = state.virgen    ?? base.virgen    ?? [];
      if (cat === '__todos__' || cat === 'pied')       nuevo.pied      = state.pied      ?? base.pied      ?? [];
      if (cat === '__todos__' || cat === 'mecha')      nuevo.mecha     = state.mecha     ?? base.mecha     ?? [];

      const picks_completos =
        Object.keys(nuevo.lev || {}).length >= 72 &&
        (nuevo.killer || []).length >= 15 &&
        (nuevo.carnicero || []).length >= 10;

      const ok = await sbPatch('cupos', { 'id': `eq.${cupo_id}`, 'usuario_id': `eq.${userId}` }, { picks_data: nuevo, picks_completos });
      if (!ok) return res.status(500).json({ error: 'Error guardando cupo en base de datos' });

      // Si es cupo #1, también actualizar usuarios.picks_data (backward compat para rankings/PDF)
      if (cupoActual.numero === 1) {
        await sbPatch('usuarios', { 'id': `eq.${userId}` }, { picks_data: nuevo, picks_completos }).catch(() => {});
        try { await sincronizarRelacional(userId, nuevo, cat); } catch (_) {}
      }

      return res.json({ ok: true, picks_completos });
    }

    // ── Sin cupo_id: guardar en usuarios (flujo original / backward compat) ──
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

    // Espejo en cupo #1 (si existe la tabla)
    try {
      const cupos = await sbGet('cupos', { 'usuario_id': `eq.${userId}`, 'numero': 'eq.1', select: 'id' });
      const cupo = Array.isArray(cupos) && cupos[0];
      if (cupo?.id) {
        await sbPatch('cupos', { 'id': `eq.${cupo.id}` }, { picks_data: nuevo, picks_completos });
      }
    } catch (_) { /* tabla cupos puede no existir aún */ }

    // Sincronizar tablas relacionales solo para la categoría guardada (best-effort)
    try { await sincronizarRelacional(userId, nuevo, cat); } catch (_) {}

    return res.json({ ok: true, picks_completos });
  }

  return res.status(405).json({ error: 'Método no permitido' });
}
