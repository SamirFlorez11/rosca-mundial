// Migración completa picks_data → tablas relacionales
// Pobla: partidos, predicciones, picks_killer, picks_equipos
// Idempotente: usa on_conflict o limpia antes de insertar
// Ejecutar: node scripts/migrar-picks-relacional.js

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_KEY"); process.exit(1);
}

async function api(path, method = "GET", body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : "return=minimal",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

// ── PARTIDOS DE GRUPOS (p0..p71 de picks.html) ──────────────────────────────
const PARTIDOS_RAW = [
  {id:'p0',  grupo:'A', local:'mex', visit:'rsa', fecha:'2026-06-11T14:00:00'},
  {id:'p1',  grupo:'A', local:'kor', visit:'cze', fecha:'2026-06-11T21:00:00'},
  {id:'p2',  grupo:'B', local:'can', visit:'bih', fecha:'2026-06-12T14:00:00'},
  {id:'p3',  grupo:'D', local:'usa', visit:'par', fecha:'2026-06-12T20:00:00'},
  {id:'p4',  grupo:'B', local:'qat', visit:'sui', fecha:'2026-06-13T14:00:00'},
  {id:'p5',  grupo:'C', local:'bra', visit:'mar', fecha:'2026-06-13T17:00:00'},
  {id:'p6',  grupo:'C', local:'hai', visit:'sco', fecha:'2026-06-13T20:00:00'},
  {id:'p7',  grupo:'D', local:'aus', visit:'tur', fecha:'2026-06-13T23:00:00'},
  {id:'p8',  grupo:'E', local:'ger', visit:'cur', fecha:'2026-06-14T12:00:00'},
  {id:'p9',  grupo:'F', local:'ned', visit:'jpn', fecha:'2026-06-14T15:00:00'},
  {id:'p10', grupo:'E', local:'civ', visit:'ecu', fecha:'2026-06-14T18:00:00'},
  {id:'p11', grupo:'F', local:'swe', visit:'tun', fecha:'2026-06-14T21:00:00'},
  {id:'p12', grupo:'H', local:'esp', visit:'cpv', fecha:'2026-06-15T11:00:00'},
  {id:'p13', grupo:'G', local:'bel', visit:'egy', fecha:'2026-06-15T14:00:00'},
  {id:'p14', grupo:'H', local:'ksa', visit:'uru', fecha:'2026-06-15T17:00:00'},
  {id:'p15', grupo:'G', local:'irn', visit:'nzl', fecha:'2026-06-15T20:00:00'},
  {id:'p16', grupo:'I', local:'fra', visit:'sen', fecha:'2026-06-16T14:00:00'},
  {id:'p17', grupo:'I', local:'irq', visit:'nor', fecha:'2026-06-16T17:00:00'},
  {id:'p18', grupo:'J', local:'arg', visit:'alg', fecha:'2026-06-16T20:00:00'},
  {id:'p19', grupo:'J', local:'aut', visit:'jor', fecha:'2026-06-16T23:00:00'},
  {id:'p20', grupo:'K', local:'por', visit:'cod', fecha:'2026-06-17T12:00:00'},
  {id:'p21', grupo:'L', local:'eng', visit:'cro', fecha:'2026-06-17T15:00:00'},
  {id:'p22', grupo:'L', local:'gha', visit:'pan', fecha:'2026-06-17T18:00:00'},
  {id:'p23', grupo:'K', local:'uzb', visit:'col', fecha:'2026-06-17T21:00:00'},
  {id:'p24', grupo:'A', local:'cze', visit:'rsa', fecha:'2026-06-18T11:00:00'},
  {id:'p25', grupo:'B', local:'sui', visit:'bih', fecha:'2026-06-18T14:00:00'},
  {id:'p26', grupo:'B', local:'can', visit:'qat', fecha:'2026-06-18T17:00:00'},
  {id:'p27', grupo:'A', local:'mex', visit:'kor', fecha:'2026-06-18T20:00:00'},
  {id:'p28', grupo:'D', local:'usa', visit:'aus', fecha:'2026-06-19T14:00:00'},
  {id:'p29', grupo:'C', local:'sco', visit:'mar', fecha:'2026-06-19T17:00:00'},
  {id:'p30', grupo:'C', local:'bra', visit:'hai', fecha:'2026-06-19T19:30:00'},
  {id:'p31', grupo:'D', local:'tur', visit:'par', fecha:'2026-06-19T22:00:00'},
  {id:'p32', grupo:'F', local:'ned', visit:'swe', fecha:'2026-06-20T12:00:00'},
  {id:'p33', grupo:'E', local:'ger', visit:'civ', fecha:'2026-06-20T15:00:00'},
  {id:'p34', grupo:'E', local:'ecu', visit:'cur', fecha:'2026-06-20T19:00:00'},
  {id:'p35', grupo:'F', local:'tun', visit:'jpn', fecha:'2026-06-20T23:00:00'},
  {id:'p36', grupo:'H', local:'esp', visit:'ksa', fecha:'2026-06-21T11:00:00'},
  {id:'p37', grupo:'G', local:'bel', visit:'irn', fecha:'2026-06-21T14:00:00'},
  {id:'p38', grupo:'H', local:'uru', visit:'cpv', fecha:'2026-06-21T17:00:00'},
  {id:'p39', grupo:'G', local:'nzl', visit:'egy', fecha:'2026-06-21T20:00:00'},
  {id:'p40', grupo:'I', local:'fra', visit:'irq', fecha:'2026-06-22T14:00:00'},
  {id:'p41', grupo:'I', local:'nor', visit:'sen', fecha:'2026-06-22T17:00:00'},
  {id:'p42', grupo:'J', local:'arg', visit:'aut', fecha:'2026-06-22T20:00:00'},
  {id:'p43', grupo:'J', local:'jor', visit:'alg', fecha:'2026-06-22T23:00:00'},
  {id:'p44', grupo:'K', local:'por', visit:'uzb', fecha:'2026-06-23T12:00:00'},
  {id:'p45', grupo:'L', local:'eng', visit:'gha', fecha:'2026-06-23T15:00:00'},
  {id:'p46', grupo:'L', local:'pan', visit:'cro', fecha:'2026-06-23T18:00:00'},
  {id:'p47', grupo:'K', local:'col', visit:'cod', fecha:'2026-06-23T21:00:00'},
  {id:'p48', grupo:'B', local:'bih', visit:'qat', fecha:'2026-06-24T14:00:00'},
  {id:'p49', grupo:'B', local:'sui', visit:'can', fecha:'2026-06-24T14:00:00'},
  {id:'p50', grupo:'C', local:'sco', visit:'bra', fecha:'2026-06-24T17:00:00'},
  {id:'p51', grupo:'C', local:'mar', visit:'hai', fecha:'2026-06-24T17:00:00'},
  {id:'p52', grupo:'A', local:'rsa', visit:'kor', fecha:'2026-06-24T20:00:00'},
  {id:'p53', grupo:'A', local:'cze', visit:'mex', fecha:'2026-06-24T20:00:00'},
  {id:'p54', grupo:'E', local:'ecu', visit:'ger', fecha:'2026-06-25T15:00:00'},
  {id:'p55', grupo:'E', local:'cur', visit:'civ', fecha:'2026-06-25T15:00:00'},
  {id:'p56', grupo:'F', local:'jpn', visit:'swe', fecha:'2026-06-25T18:00:00'},
  {id:'p57', grupo:'F', local:'tun', visit:'ned', fecha:'2026-06-25T18:00:00'},
  {id:'p58', grupo:'D', local:'tur', visit:'usa', fecha:'2026-06-25T21:00:00'},
  {id:'p59', grupo:'D', local:'par', visit:'aus', fecha:'2026-06-25T21:00:00'},
  {id:'p60', grupo:'I', local:'sen', visit:'irq', fecha:'2026-06-26T14:00:00'},
  {id:'p61', grupo:'I', local:'nor', visit:'fra', fecha:'2026-06-26T14:00:00'},
  {id:'p62', grupo:'H', local:'uru', visit:'esp', fecha:'2026-06-26T19:00:00'},
  {id:'p63', grupo:'H', local:'cpv', visit:'ksa', fecha:'2026-06-26T19:00:00'},
  {id:'p64', grupo:'G', local:'nzl', visit:'bel', fecha:'2026-06-26T22:00:00'},
  {id:'p65', grupo:'G', local:'egy', visit:'irn', fecha:'2026-06-26T22:00:00'},
  {id:'p66', grupo:'L', local:'cro', visit:'gha', fecha:'2026-06-27T16:00:00'},
  {id:'p67', grupo:'L', local:'pan', visit:'eng', fecha:'2026-06-27T16:00:00'},
  {id:'p68', grupo:'K', local:'col', visit:'por', fecha:'2026-06-27T18:30:00'},
  {id:'p69', grupo:'K', local:'cod', visit:'uzb', fecha:'2026-06-27T18:30:00'},
  {id:'p70', grupo:'J', local:'jor', visit:'arg', fecha:'2026-06-27T21:00:00'},
  {id:'p71', grupo:'J', local:'alg', visit:'aut', fecha:'2026-06-27T21:00:00'},
];

async function main() {
  // ── 1. Obtener mapas de IDs ───────────────────────────────────────────────
  console.log("Cargando mapas de IDs...");

  const equiposDB = await api("/equipos?select=id,codigo_fifa");
  const eqMap = {};
  equiposDB.forEach(e => eqMap[e.codigo_fifa] = e.id);

  const jugadoresDB = await api("/jugadores?select=id,nombre_corto");
  const jugMap = {};
  jugadoresDB.forEach(j => { if (j.nombre_corto) jugMap[j.nombre_corto] = j.id; });

  const usuariosDB = await api("/usuarios?select=id,correo,picks_data&picks_data=not.is.null");
  console.log(`  ${Object.keys(eqMap).length} equipos, ${Object.keys(jugMap).length} jugadores, ${usuariosDB.length} usuarios con picks`);

  // ── 2. Insertar partidos (72 de grupo) ────────────────────────────────────
  console.log("\n1. Insertando partidos de grupo...");
  const partidosPayload = PARTIDOS_RAW.map((p, i) => ({
    numero_partido: i + 1,
    fase: `GRUPO_${p.grupo}`,
    equipo_local_id: eqMap[p.local],
    equipo_visitante_id: eqMap[p.visit],
    fecha_hora: p.fecha,
    estado: 'pendiente',
    fase_bloqueada: false,
  }));

  // Limpiar partidos de grupo existentes (numero_partido 1..72) e insertar
  await api("/partidos?numero_partido=gte.1&numero_partido=lte.72", "DELETE");
  const partidosRes = await api("/partidos?Prefer=return=representation", "POST", partidosPayload);
  if (!Array.isArray(partidosRes)) {
    // Reintentar con Prefer correcto
    const res2 = await fetch(`${SUPABASE_URL}/rest/v1/partidos`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(partidosPayload),
    });
    const data2 = await res2.json();
    if (!Array.isArray(data2)) { console.error("Error partidos:", data2); process.exit(1); }
    console.log(`  ${data2.length} partidos insertados`);
    var partidosInsertados = data2;
  } else {
    console.log(`  ${partidosRes.length} partidos insertados`);
    var partidosInsertados = partidosRes;
  }

  // Mapa picks id (p0..p71) → UUID de partido
  const partidoMap = {};
  PARTIDOS_RAW.forEach((p, i) => {
    const inserted = partidosInsertados[i];
    if (inserted) partidoMap[p.id] = inserted.id;
  });

  // ── 3. Migrar por usuario ─────────────────────────────────────────────────
  for (const usuario of usuariosDB) {
    const pd = usuario.picks_data;
    if (!pd) continue;
    console.log(`\nMigrando: ${usuario.correo}`);

    // Limpiar picks relacionales previos de este usuario
    await api(`/predicciones?usuario_id=eq.${usuario.id}`, "DELETE");
    await api(`/picks_killer?usuario_id=eq.${usuario.id}`, "DELETE");
    await api(`/picks_equipos?usuario_id=eq.${usuario.id}`, "DELETE");

    // 3a. predicciones (L/E/V)
    const levPicks = pd.lev || {};
    const predRows = Object.entries(levPicks)
      .filter(([k]) => partidoMap[k])
      .map(([k, v]) => ({
        usuario_id: usuario.id,
        partido_id: partidoMap[k],
        prediccion: v,
      }));
    if (predRows.length) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/predicciones`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(predRows),
      });
      console.log(`  predicciones: ${predRows.length} filas (HTTP ${r.status})`);
    }

    // 3b. picks_killer
    const killerIds = pd.killer || [];
    const killerRows = killerIds
      .filter(id => jugMap[id])
      .map(id => ({ usuario_id: usuario.id, jugador_id: jugMap[id] }));
    const sinMapeoK = killerIds.filter(id => !jugMap[id]);
    if (sinMapeoK.length) console.log(`  killer sin mapeo (se omiten): ${sinMapeoK.join(', ')}`);
    if (killerRows.length) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/picks_killer`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(killerRows),
      });
      console.log(`  picks_killer: ${killerRows.length} filas (HTTP ${r.status})`);
    }

    // 3c. picks_equipos (carnicero, banderin, virgen, pied, mecha)
    // Mapeo de clave en picks_data → nombre de categoría en Supabase
    const CATS_EQUIPOS = [
      { key: 'carnicero', cat: 'carnicero'   },
      { key: 'banderin',  cat: 'banderin'    },
      { key: 'virgen',    cat: 'virgen'      },
      { key: 'pied',      cat: 'pie_de_nina' },
      { key: 'mecha',     cat: 'mechacorta'  },
    ];
    const eqRows = [];
    for (const { key, cat } of CATS_EQUIPOS) {
      const ids = pd[key] || [];
      const sinMapeo = ids.filter(id => !eqMap[id]);
      if (sinMapeo.length) console.log(`  ${key} sin mapeo: ${sinMapeo.join(', ')}`);
      ids.filter(id => eqMap[id]).forEach(id => {
        eqRows.push({ usuario_id: usuario.id, equipo_id: eqMap[id], categoria: cat });
      });
    }
    if (eqRows.length) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/picks_equipos`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(eqRows),
      });
      console.log(`  picks_equipos: ${eqRows.length} filas (HTTP ${r.status})`);
    }
  }

  // ── 4. Verificar conteos finales ──────────────────────────────────────────
  console.log("\n── Verificación final ──");
  const [cp, ck, ce, cr] = await Promise.all([
    api("/partidos?select=id&order=numero_partido").then(d => d.length),
    api("/picks_killer?select=id").then(d => d.length),
    api("/picks_equipos?select=id").then(d => d.length),
    api("/predicciones?select=id").then(d => d.length),
  ]);
  console.log(`  partidos:     ${cp}`);
  console.log(`  picks_killer: ${ck}`);
  console.log(`  picks_equipos:${ce}`);
  console.log(`  predicciones: ${cr}`);
  console.log("\n✅ Migración completa.");
}

main().catch(e => { console.error(e); process.exit(1); });
