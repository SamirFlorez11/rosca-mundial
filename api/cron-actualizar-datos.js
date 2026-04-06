// api/cron-actualizar-datos.js
// Se ejecuta 12 veces al dia — cada 2 horas
// Jala datos de Sportmonks y actualiza Supabase
// Rosca Mundial 2026

const SPORTMONKS_TOKEN = process.env.SPORTMONKS_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MUNDIAL_SEASON_ID = 26618;

// Cliente Supabase con service key (acceso total)
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

// Cliente Sportmonks
async function sportmonksQuery(endpoint) {
  const url = `https://api.sportmonks.com/v3/football/${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': SPORTMONKS_TOKEN,
      'Accept': 'application/json'
    }
  });
  if (!response.ok) {
    throw new Error(`Sportmonks error ${response.status}: ${endpoint}`);
  }
  return response.json();
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
      const local = partido.participants?.find(p => p.meta?.location === 'home');
      const visitante = partido.participants?.find(p => p.meta?.location === 'away');
      const scoreLocal = partido.scores?.find(s => s.description === 'CURRENT' && s.score?.participant === 'home')?.score?.goals ?? null;
      const scoreVisitante = partido.scores?.find(s => s.description === 'CURRENT' && s.score?.participant === 'away')?.score?.goals ?? null;

      // Calcular resultado L/E/V
      let resultado = null;
      if (scoreLocal !== null && scoreVisitante !== null) {
        if (scoreLocal > scoreVisitante) resultado = 'L';
        else if (scoreLocal < scoreVisitante) resultado = 'V';
        else resultado = 'E';
      }

      // Estado del partido
      const estadoMap = {
        'NS': 'programado',
        'LIVE': 'en_curso',
        '1H': 'en_curso',
        '2H': 'en_curso',
        'HT': 'en_curso',
        'ET': 'en_curso',
        'PEN': 'en_curso',
        'FT': 'finalizado',
        'AET': 'finalizado',
        'FTP': 'finalizado',
        'CANCL': 'cancelado',
        'SUSP': 'suspendido',
        'POSTP': 'suspendido'
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

      // Si el partido finalizó, actualizar predicciones
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
// ACTUALIZAR PREDICCIONES (marcar aciertos)
// =============================================
async function actualizarPredicciones(sportmonksId, resultadoReal) {
  try {
    // Obtener el partido de nuestra BD
    const partidos = await supabaseQuery(
      `partidos?sportmonks_id=eq.${sportmonksId}&select=id`
    );
    if (!partidos.length) return;
    const partidoId = partidos[0].id;

    // Marcar predicciones correctas e incorrectas
    await supabaseQuery(
      `predicciones?partido_id=eq.${partidoId}`,
      'PATCH',
      { es_correcto: false, updated_at: new Date().toISOString() }
    );
    await supabaseQuery(
      `predicciones?partido_id=eq.${partidoId}&prediccion=eq.${resultadoReal}`,
      'PATCH',
      { es_correcto: true, updated_at: new Date().toISOString() }
    );

    // Recalcular ranking principal
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
    // Obtener todos los usuarios con predicciones correctas acumuladas
    const predicciones = await supabaseQuery(
      `predicciones?es_correcto=eq.true&select=usuario_id,partido_id,partidos(fase)`
    );

    // Agrupar puntos por usuario y fase
    const puntajeMap = {};
    for (const pred of predicciones) {
      const uid = pred.usuario_id;
      const fase = pred.partidos?.fase || 'grupos';
      if (!puntajeMap[uid]) {
        puntajeMap[uid] = {
          puntos_total: 0, puntos_grupos: 0, puntos_16avos: 0,
          puntos_8vos: 0, puntos_cuartos: 0, puntos_semis: 0,
          puntos_tercer_puesto: 0, puntos_final: 0
        };
      }
      puntajeMap[uid].puntos_total++;
      puntajeMap[uid][`puntos_${fase}`]++;
    }

    // Actualizar tabla ranking
    for (const [usuarioId, puntos] of Object.entries(puntajeMap)) {
      await supabaseQuery('ranking', 'POST', {
        usuario_id: usuarioId,
        ...puntos,
        updated_at: new Date().toISOString()
      });
    }

    console.log(`✅ Ranking actualizado para ${Object.keys(puntajeMap).length} usuarios`);
  } catch (error) {
    console.error('❌ Error recalculando ranking:', error.message);
  }
}

// =============================================
// ACTUALIZAR ESTADÍSTICAS DE EQUIPOS
// Goles, tarjetas, corners
// =============================================
async function actualizarEstadisticasEquipos() {
  console.log('📊 Actualizando estadísticas de equipos...');
  try {
    // Obtener todos los partidos finalizados del mundial con estadísticas
    const data = await sportmonksQuery(
      `fixtures?filters=fixtureSeasons:${MUNDIAL_SEASON_ID},fixtureStates:5&include=participants;statistics.type&per_page=100`
    );

    const partidos = data.data || [];
    const statsEquipos = {}; // Acumular por equipo

    for (const partido of partidos) {
      if (!partido.statistics) continue;

      for (const stat of partido.statistics) {
        const equipoId = stat.participant_id;
        if (!statsEquipos[equipoId]) {
          statsEquipos[equipoId] = {
            goles_favor: 0, goles_contra: 0,
            tarjetas_amarillas: 0, tarjetas_rojas: 0,
            puntos_tarjetas: 0, corners: 0, partidos_jugados: 0
          };
        }

        const tipo = stat.type?.code;
        const valor = stat.data?.value || 0;

        switch(tipo) {
          case 'goals': statsEquipos[equipoId].goles_favor += valor; break;
          case 'goals-conceded': statsEquipos[equipoId].goles_contra += valor; break;
          case 'yellowcards': 
            statsEquipos[equipoId].tarjetas_amarillas += valor;
            statsEquipos[equipoId].puntos_tarjetas += valor; // amarilla = 1
            break;
          case 'redcards':
            statsEquipos[equipoId].tarjetas_rojas += valor;
            statsEquipos[equipoId].puntos_tarjetas += valor * 2; // roja = 2
            break;
          case 'corners': statsEquipos[equipoId].corners += valor; break;
        }
      }
    }

    // Guardar en Supabase
    for (const [sportmonksEquipoId, stats] of Object.entries(statsEquipos)) {
      // Buscar el equipo en nuestra BD
      const equipos = await supabaseQuery(
        `equipos?sportmonks_id=eq.${sportmonksEquipoId}&select=id`
      );
      if (!equipos.length) continue;

      await supabaseQuery('estadisticas_equipos', 'POST', {
        equipo_id: equipos[0].id,
        ...stats,
        updated_at: new Date().toISOString()
      });
    }

    console.log(`✅ Estadísticas de ${Object.keys(statsEquipos).length} equipos actualizadas`);

    // Recalcular rankings especiales
    await recalcularRankingsEspeciales();
  } catch (error) {
    console.error('❌ Error actualizando estadísticas equipos:', error.message);
  }
}

// =============================================
// ACTUALIZAR ESTADÍSTICAS DE JUGADORES
// Para El Killer (goles + asistencias)
// =============================================
async function actualizarEstadisticasJugadores() {
  console.log('👟 Actualizando estadísticas de jugadores...');
  try {
    const data = await sportmonksQuery(
      `topscorers/seasons/${MUNDIAL_SEASON_ID}?include=player;type&per_page=200`
    );

    const scorers = data.data || [];

    for (const scorer of scorers) {
      const jugadorSportmonksId = scorer.player_id;
      const tipo = scorer.type?.code;
      const valor = scorer.total || 0;

      // Buscar jugador en nuestra BD
      const jugadores = await supabaseQuery(
        `jugadores?sportmonks_id=eq.${jugadorSportmonksId}&select=id`
      );
      if (!jugadores.length) continue;
      const jugadorId = jugadores[0].id;

      // Actualizar goles o asistencias
      const updateData = { updated_at: new Date().toISOString() };
      if (tipo === 'goals') updateData.goles = valor;
      if (tipo === 'assists') updateData.asistencias = valor;

      await supabaseQuery(
        `estadisticas_jugadores?jugador_id=eq.${jugadorId}`,
        'PATCH',
        updateData
      );

      // Actualizar puntos_killer (goles + asistencias)
      const stats = await supabaseQuery(
        `estadisticas_jugadores?jugador_id=eq.${jugadorId}&select=goles,asistencias`
      );
      if (stats.length) {
        const puntos = (stats[0].goles || 0) + (stats[0].asistencias || 0);
        await supabaseQuery(
          `estadisticas_jugadores?jugador_id=eq.${jugadorId}`,
          'PATCH',
          { puntos_killer: puntos }
        );
      }
    }

    console.log('✅ Estadísticas de jugadores actualizadas');
    await recalcularRankingKiller();
  } catch (error) {
    console.error('❌ Error actualizando estadísticas jugadores:', error.message);
  }
}

// =============================================
// RECALCULAR RANKING KILLER
// =============================================
async function recalcularRankingKiller() {
  try {
    const picks = await supabaseQuery(
      `picks_killer?select=usuario_id,jugador_id,estadisticas_jugadores(goles,asistencias,puntos_killer)`
    );

    const rankingMap = {};
    const detalleMap = {};

    for (const pick of picks) {
      const uid = pick.usuario_id;
      const stats = pick.estadisticas_jugadores;
      if (!stats) continue;

      if (!rankingMap[uid]) rankingMap[uid] = 0;
      rankingMap[uid] += stats.puntos_killer || 0;

      if (!detalleMap[uid]) detalleMap[uid] = [];
      detalleMap[uid].push({
        usuario_id: uid,
        jugador_id: pick.jugador_id,
        goles: stats.goles || 0,
        asistencias: stats.asistencias || 0,
        puntos: stats.puntos_killer || 0,
        updated_at: new Date().toISOString()
      });
    }

    for (const [usuarioId, puntos] of Object.entries(rankingMap)) {
      await supabaseQuery('ranking_killer', 'POST', {
        usuario_id: usuarioId,
        puntos_total: puntos,
        updated_at: new Date().toISOString()
      });
    }

    console.log('✅ Ranking Killer actualizado');
  } catch (error) {
    console.error('❌ Error recalculando ranking killer:', error.message);
  }
}

// =============================================
// RECALCULAR RANKINGS ESPECIALES
// Virgen, Carnicero, Pie de Niña, Banderín, Mechacorta
// =============================================
async function recalcularRankingsEspeciales() {
  const categorias = [
    { nombre: 'virgen',      tabla: 'ranking_virgen',      campo: 'goles_favor',       inverso: true  },
    { nombre: 'carnicero',   tabla: 'ranking_carnicero',   campo: 'puntos_tarjetas',   inverso: false },
    { nombre: 'pie_de_nina', tabla: 'ranking_pie_de_nina', campo: 'puntos_tarjetas',   inverso: true  },
    { nombre: 'banderin',    tabla: 'ranking_banderin',    campo: 'corners',           inverso: false },
    { nombre: 'mechacorta',  tabla: 'ranking_mechacorta',  campo: 'corners',           inverso: true  }
  ];

  for (const cat of categorias) {
    try {
      const picks = await supabaseQuery(
        `picks_equipos?categoria=eq.${cat.nombre}&select=usuario_id,equipo_id,estadisticas_equipos(${cat.campo})`
      );

      const rankingMap = {};
      for (const pick of picks) {
        const uid = pick.usuario_id;
        const valor = pick.estadisticas_equipos?.[cat.campo] || 0;
        if (!rankingMap[uid]) rankingMap[uid] = 0;
        rankingMap[uid] += valor;
      }

      for (const [usuarioId, puntos] of Object.entries(rankingMap)) {
        await supabaseQuery(cat.tabla, 'POST', {
          usuario_id: usuarioId,
          puntos_total: puntos,
          updated_at: new Date().toISOString()
        });
      }

      console.log(`✅ Ranking ${cat.nombre} actualizado`);
    } catch (error) {
      console.error(`❌ Error ranking ${cat.nombre}:`, error.message);
    }
  }
}

// =============================================
// HANDLER PRINCIPAL — Vercel Cron
// =============================================
export default async function handler(req, res) {

  // Verificar que viene de Vercel Cron
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  console.log(`🚀 Cron iniciado: ${new Date().toISOString()}`);
  const inicio = Date.now();

  try {
    await actualizarPartidos();
    await actualizarEstadisticasEquipos();
    await actualizarEstadisticasJugadores();

    const duracion = ((Date.now() - inicio) / 1000).toFixed(2);
    console.log(`✅ Cron completado en ${duracion}s`);

    return res.status(200).json({
      exito: true,
      duracion: `${duracion}s`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error en cron:', error);
    return res.status(500).json({ error: error.message });
  }
}
