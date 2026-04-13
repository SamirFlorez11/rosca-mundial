// api/cron-actualizar-datos.js
// Se ejecuta 1x/día (Hobby) → 12x/día cuando activemos Pro el 25 mayo
// Rosca Mundial 2026

const SPORTMONKS_TOKEN    = process.env.SPORTMONKS_API_KEY;
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY= process.env.SUPABASE_SERVICE_KEY;
const MUNDIAL_SEASON_ID   = 26618;

// ─── Clientes ────────────────────────────────────────────────────────────────
async function supabaseQuery(endpoint, method = 'GET', body = null) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    method,
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'resolution=merge-duplicates' : ''
    },
    body: body ? JSON.stringify(body) : null
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase error: ${error}`);
  }
  return method === 'GET' ? response.json() : response;
}

async function sportmonksQuery(endpoint) {
  const url = `https://api.sportmonks.com/v3/football/${endpoint}`;
  const response = await fetch(url, {
    headers: { 'Authorization': SPORTMONKS_TOKEN, 'Accept': 'application/json' }
  });
  if (!response.ok) throw new Error(`Sportmonks error ${response.status}: ${endpoint}`);
  return response.json();
}

// =============================================
// GESTIÓN AUTOMÁTICA DE FASES
// Se ejecuta al inicio de cada cron
// =============================================
async function gestionarFasesAutomatico() {
  console.log('🔓 Verificando fases automáticas...');
  try {
    const ahora = new Date();

    // Fechas clave del Mundial 2026 (UTC-5 Colombia)
    // Convertidas a UTC sumando 5 horas
    const FASES = [
      {
        id: null, // se busca por nombre
        nombre: 'Picks Iniciales',
        apertura: new Date('2026-05-12T05:00:00Z'), // 12 mayo 00:00 COL
        cierre:   new Date('2026-06-11T22:30:00Z'), // 11 junio 17:30 COL
      },
      {
        nombre: 'Fase de Grupos',
        apertura: new Date('2026-06-11T23:00:00Z'), // 11 junio 18:00 COL (tras primer partido)
        cierre:   new Date('2026-06-26T23:59:00Z'), // 26 junio fin grupos
      },
      {
        nombre: '16avos',
        apertura: new Date('2026-06-27T05:00:00Z'),
        cierre:   new Date('2026-06-29T23:59:00Z'),
      },
      {
        nombre: 'Cuartos',
        apertura: new Date('2026-07-04T05:00:00Z'),
        cierre:   new Date('2026-07-05T23:59:00Z'),
      },
      {
        nombre: 'Semis',
        apertura: new Date('2026-07-08T05:00:00Z'),
        cierre:   new Date('2026-07-09T23:59:00Z'),
      },
      {
        nombre: 'Final',
        apertura: new Date('2026-07-14T05:00:00Z'),
        cierre:   new Date('2026-07-15T23:59:00Z'),
      },
    ];

    // Obtener fases actuales de Supabase
    const fasesDB = await supabaseQuery('fases?select=id,nombre,estado,fecha_inicio,fecha_fin&order=fecha_inicio.asc');

    for (const fase of FASES) {
      const faseDB = fasesDB.find(f => f.nombre === fase.nombre);
      if (!faseDB) continue;

      const debeEstarAbierta = ahora >= fase.apertura && ahora <= fase.cierre;
      const debeEstarCerrada = ahora > fase.cierre;
      const estaAbierta      = faseDB.estado === 'abierto';
      const estaCerrada      = faseDB.estado === 'cerrado';

      // Abrir si llegó la hora y no está abierta
      if (debeEstarAbierta && !estaAbierta) {
        await supabaseQuery(`fases?id=eq.${faseDB.id}`, 'PATCH', {
          estado: 'abierto',
          abierta_en: ahora.toISOString()
        });
        await supabaseQuery('logs', 'POST', {
          tipo: 'cron',
          mensaje: `Fase "${fase.nombre}" abierta automáticamente`,
          meta: { fase_id: faseDB.id, timestamp: ahora.toISOString() }
        });
        console.log(`✅ Fase "${fase.nombre}" abierta automáticamente`);
      }

      // Cerrar si pasó el cierre y no está cerrada
      if (debeEstarCerrada && !estaCerrada) {
        await supabaseQuery(`fases?id=eq.${faseDB.id}`, 'PATCH', {
          estado: 'cerrado',
          cerrada_en: ahora.toISOString()
        });
        await supabaseQuery('logs', 'POST', {
          tipo: 'cron',
          mensaje: `Fase "${fase.nombre}" cerrada automáticamente`,
          meta: { fase_id: faseDB.id, timestamp: ahora.toISOString() }
        });
        console.log(`✅ Fase "${fase.nombre}" cerrada automáticamente`);
      }
    }

    console.log('✅ Verificación de fases completada');
  } catch (error) {
    console.error('❌ Error gestionando fases:', error.message);
  }
}

// =============================================
// ACTUALIZAR RESULTADOS DE PARTIDOS
// =============================================
async function actualizarPartidos() {
  console.log('📅 Actualizando partidos...');
  try {
    const data = await sportmonksQuery(
      `fixtures?filters=fixtureSeasons:${MUNDIAL_SEASON_ID}&include=participants;scores;state&per_page=100`
    );

    const partidos = data.data || [];
    let actualizados = 0;

    for (const partido of partidos) {
      const local     = partido.participants?.find(p => p.meta?.location === 'home');
      const visitante = partido.participants?.find(p => p.meta?.location === 'away');
      const scoreLocal     = partido.scores?.find(s => s.description === 'CURRENT' && s.score?.participant === 'home')?.score?.goals ?? null;
      const scoreVisitante = partido.scores?.find(s => s.description === 'CURRENT' && s.score?.participant === 'away')?.score?.goals ?? null;

      let resultado = null;
      if (scoreLocal !== null && scoreVisitante !== null) {
        if (scoreLocal > scoreVisitante) resultado = 'L';
        else if (scoreLocal < scoreVisitante) resultado = 'V';
        else resultado = 'E';
      }

      const estadoMap = {
        'NS':'programado','LIVE':'en_curso','1H':'en_curso','2H':'en_curso',
        'HT':'en_curso','ET':'en_curso','PEN':'en_curso',
        'FT':'finalizado','AET':'finalizado','FTP':'finalizado',
        'CANCL':'cancelado','SUSP':'suspendido','POSTP':'suspendido'
      };
      const estado = estadoMap[partido.state?.short_name] || 'programado';

      await supabaseQuery('partidos', 'POST', {
        sportmonks_id: partido.id,
        goles_local: scoreLocal,
        goles_visitante: scoreVisitante,
        resultado: estado === 'finalizado' ? resultado : null,
        estado,
        updated_at: new Date().toISOString()
      });

      if (estado === 'finalizado' && resultado) {
        await actualizarPredicciones(partido.id, resultado);
      }
      actualizados++;
    }
    console.log(`✅ ${actualizados} partidos actualizados`);
  } catch (error) {
    console.error('❌ Error actualizando partidos:', error.message);
  }
}

// =============================================
// ACTUALIZAR PREDICCIONES
// =============================================
async function actualizarPredicciones(sportmonksId, resultadoReal) {
  try {
    const partidos = await supabaseQuery(`partidos?sportmonks_id=eq.${sportmonksId}&select=id`);
    if (!partidos.length) return;
    const partidoId = partidos[0].id;

    await supabaseQuery(`predicciones?partido_id=eq.${partidoId}`, 'PATCH',
      { es_correcto: false, updated_at: new Date().toISOString() });
    await supabaseQuery(`predicciones?partido_id=eq.${partidoId}&prediccion=eq.${resultadoReal}`, 'PATCH',
      { es_correcto: true, updated_at: new Date().toISOString() });

    await recalcularRanking(partidoId);
  } catch (error) {
    console.error('❌ Error actualizando predicciones:', error.message);
  }
}

// =============================================
// RECALCULAR RANKING PRINCIPAL
// =============================================
async function recalcularRanking(partidoId) {
  try {
    const predicciones = await supabaseQuery(
      `predicciones?es_correcto=eq.true&select=usuario_id,partido_id,partidos(fase)`
    );

    const puntajeMap = {};
    for (const pred of predicciones) {
      const uid  = pred.usuario_id;
      const fase = pred.partidos?.fase || 'grupos';
      if (!puntajeMap[uid]) puntajeMap[uid] = { puntos_total:0,puntos_grupos:0,puntos_16avos:0,puntos_8vos:0,puntos_cuartos:0,puntos_semis:0,puntos_tercer_puesto:0,puntos_final:0 };
      puntajeMap[uid].puntos_total++;
      puntajeMap[uid][`puntos_${fase}`] = (puntajeMap[uid][`puntos_${fase}`] || 0) + 1;
    }

    for (const [usuarioId, puntos] of Object.entries(puntajeMap)) {
      await supabaseQuery('ranking', 'POST', {
        usuario_id: usuarioId, ...puntos, updated_at: new Date().toISOString()
      });
    }
    console.log(`✅ Ranking actualizado para ${Object.keys(puntajeMap).length} usuarios`);
  } catch (error) {
    console.error('❌ Error recalculando ranking:', error.message);
  }
}

// =============================================
// ESTADÍSTICAS EQUIPOS
// =============================================
async function actualizarEstadisticasEquipos() {
  console.log('📊 Actualizando estadísticas de equipos...');
  try {
    const data = await sportmonksQuery(
      `fixtures?filters=fixtureSeasons:${MUNDIAL_SEASON_ID},fixtureStates:5&include=participants;statistics.type&per_page=100`
    );

    const statsEquipos = {};
    for (const partido of data.data || []) {
      if (!partido.statistics) continue;
      for (const stat of partido.statistics) {
        const equipoId = stat.participant_id;
        if (!statsEquipos[equipoId]) statsEquipos[equipoId] = { goles_favor:0,goles_contra:0,tarjetas_amarillas:0,tarjetas_rojas:0,puntos_tarjetas:0,corners:0,partidos_jugados:0 };
        const tipo  = stat.type?.code;
        const valor = stat.data?.value || 0;
        if (tipo === 'goals')         statsEquipos[equipoId].goles_favor        += valor;
        if (tipo === 'goals-conceded')statsEquipos[equipoId].goles_contra       += valor;
        if (tipo === 'yellowcards')  { statsEquipos[equipoId].tarjetas_amarillas+= valor; statsEquipos[equipoId].puntos_tarjetas += valor; }
        if (tipo === 'redcards')     { statsEquipos[equipoId].tarjetas_rojas    += valor; statsEquipos[equipoId].puntos_tarjetas += valor * 2; }
        if (tipo === 'corners')       statsEquipos[equipoId].corners            += valor;
      }
    }

    for (const [sportmonksEquipoId, stats] of Object.entries(statsEquipos)) {
      const equipos = await supabaseQuery(`equipos?sportmonks_id=eq.${sportmonksEquipoId}&select=id`);
      if (!equipos.length) continue;
      await supabaseQuery('estadisticas_equipos', 'POST', { equipo_id: equipos[0].id, ...stats, updated_at: new Date().toISOString() });
    }

    console.log(`✅ Estadísticas de ${Object.keys(statsEquipos).length} equipos actualizadas`);
    await recalcularRankingsEspeciales();
  } catch (error) {
    console.error('❌ Error estadísticas equipos:', error.message);
  }
}

// =============================================
// ESTADÍSTICAS JUGADORES
// =============================================
async function actualizarEstadisticasJugadores() {
  console.log('👟 Actualizando estadísticas de jugadores...');
  try {
    const data = await sportmonksQuery(`topscorers/seasons/${MUNDIAL_SEASON_ID}?include=player;type&per_page=200`);

    for (const scorer of data.data || []) {
      const tipo  = scorer.type?.code;
      const valor = scorer.total || 0;
      const jugadores = await supabaseQuery(`jugadores?sportmonks_id=eq.${scorer.player_id}&select=id`);
      if (!jugadores.length) continue;
      const jugadorId = jugadores[0].id;

      const updateData = { updated_at: new Date().toISOString() };
      if (tipo === 'goals')   updateData.goles       = valor;
      if (tipo === 'assists') updateData.asistencias  = valor;
      await supabaseQuery(`estadisticas_jugadores?jugador_id=eq.${jugadorId}`, 'PATCH', updateData);

      const stats = await supabaseQuery(`estadisticas_jugadores?jugador_id=eq.${jugadorId}&select=goles,asistencias`);
      if (stats.length) {
        await supabaseQuery(`estadisticas_jugadores?jugador_id=eq.${jugadorId}`, 'PATCH',
          { puntos_killer: (stats[0].goles || 0) + (stats[0].asistencias || 0) });
      }
    }

    console.log('✅ Estadísticas de jugadores actualizadas');
    await recalcularRankingKiller();
  } catch (error) {
    console.error('❌ Error estadísticas jugadores:', error.message);
  }
}

// =============================================
// RANKING KILLER
// =============================================
async function recalcularRankingKiller() {
  try {
    const picks = await supabaseQuery(
      `picks_killer?select=usuario_id,jugador_id,estadisticas_jugadores(goles,asistencias,puntos_killer)`
    );
    const rankingMap = {};
    for (const pick of picks) {
      const uid   = pick.usuario_id;
      const stats = pick.estadisticas_jugadores;
      if (!stats) continue;
      if (!rankingMap[uid]) rankingMap[uid] = 0;
      rankingMap[uid] += stats.puntos_killer || 0;
    }
    for (const [usuarioId, puntos] of Object.entries(rankingMap)) {
      await supabaseQuery('ranking_killer', 'POST', { usuario_id: usuarioId, puntos_total: puntos, updated_at: new Date().toISOString() });
    }
    console.log('✅ Ranking Killer actualizado');
  } catch (error) {
    console.error('❌ Error ranking killer:', error.message);
  }
}

// =============================================
// RANKINGS ESPECIALES
// =============================================
async function recalcularRankingsEspeciales() {
  const categorias = [
    { nombre: 'virgen',      tabla: 'ranking_virgen',       campo: 'goles_favor',     inverso: true  },
    { nombre: 'carnicero',   tabla: 'ranking_carnicero',    campo: 'puntos_tarjetas', inverso: false },
    { nombre: 'pie_de_nina', tabla: 'ranking_pie_de_nina',  campo: 'puntos_tarjetas', inverso: true  },
    { nombre: 'banderin',    tabla: 'ranking_banderin',     campo: 'corners',         inverso: false },
    { nombre: 'mechacorta',  tabla: 'ranking_mechacorta',   campo: 'corners',         inverso: true  },
  ];

  for (const cat of categorias) {
    try {
      const picks = await supabaseQuery(
        `picks_equipos?categoria=eq.${cat.nombre}&select=usuario_id,equipo_id,estadisticas_equipos(${cat.campo})`
      );
      const rankingMap = {};
      for (const pick of picks) {
        const uid   = pick.usuario_id;
        const valor = pick.estadisticas_equipos?.[cat.campo] || 0;
        if (!rankingMap[uid]) rankingMap[uid] = 0;
        rankingMap[uid] += valor;
      }
      for (const [usuarioId, puntos] of Object.entries(rankingMap)) {
        await supabaseQuery(cat.tabla, 'POST', { usuario_id: usuarioId, puntos_total: puntos, updated_at: new Date().toISOString() });
      }
      console.log(`✅ Ranking ${cat.nombre} actualizado`);
    } catch (error) {
      console.error(`❌ Error ranking ${cat.nombre}:`, error.message);
    }
  }
}

// =============================================
// HANDLER PRINCIPAL
// =============================================
export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  console.log(`🚀 Cron iniciado: ${new Date().toISOString()}`);
  const inicio = Date.now();

  try {
    // 1. Gestión automática de fases (siempre, sin importar si Sportmonks está activo)
    await gestionarFasesAutomatico();

    // 2. Datos de Sportmonks (solo cuando la API esté activa — 25 mayo)
    if (SPORTMONKS_TOKEN) {
      await actualizarPartidos();
      await actualizarEstadisticasEquipos();
      await actualizarEstadisticasJugadores();
    } else {
      console.log('⏳ Sportmonks no activo todavía — saltando sync de datos');
    }

    // 3. Log en Supabase
    await supabaseQuery('logs', 'POST', {
      tipo: 'cron',
      mensaje: 'Cron ejecutado exitosamente',
      meta: { duracion: ((Date.now() - inicio) / 1000).toFixed(2) + 's', sportmonks_activo: !!SPORTMONKS_TOKEN }
    });

    const duracion = ((Date.now() - inicio) / 1000).toFixed(2);
    console.log(`✅ Cron completado en ${duracion}s`);
    return res.status(200).json({ exito: true, duracion: `${duracion}s`, timestamp: new Date().toISOString() });

  } catch (error) {
    console.error('❌ Error en cron:', error);
    return res.status(500).json({ error: error.message });
  }
}