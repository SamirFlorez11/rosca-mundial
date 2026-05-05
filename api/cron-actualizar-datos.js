// api/cron-actualizar-datos.js
// Se ejecuta cada 2 min (Vercel Pro). Solo llama a Sportmonks si hay partido en curso o a punto de comenzar.
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
// Se ejecuta al inicio de cada cron (cada 2 min)
//
// REGLA PRINCIPAL: Una vez que el cron cierra una fase (cerrada_en queda
// registrado), NUNCA la vuelve a abrir automáticamente. El admin puede
// reabrirla manualmente desde el panel.
//
// Valores esperados en partidos.fase (ajustar si Sportmonks usa otros nombres):
//   'grupos' | '16avos' | '8vos' | 'cuartos' | 'semis' | 'tercer_puesto' | 'final'
// =============================================
async function gestionarFasesAutomatico() {
  console.log('🔓 Verificando fases automáticas...');
  try {
    const ahora = new Date();

    const fasesDB = await supabaseQuery(
      'fases?select=id,nombre,estado,cerrada_en,abierta_en&order=fecha_inicio.asc'
    );

    // ── Helpers ───────────────────────────────────────────────────────────────

    const abrirFase = async (f, motivo) => {
      await supabaseQuery(`fases?id=eq.${f.id}`, 'PATCH', {
        estado: 'abierto', abierta_en: ahora.toISOString()
      });
      await supabaseQuery('logs', 'POST', {
        accion: 'fase_abierta_automatica',
        detalle: { fase: f.nombre, motivo, ts: ahora.toISOString() }
      });
      console.log(`✅ Fase "${f.nombre}" abierta (${motivo})`);
    };

    const cerrarFase = async (f, motivo) => {
      await supabaseQuery(`fases?id=eq.${f.id}`, 'PATCH', {
        estado: 'cerrado', cerrada_en: ahora.toISOString()
      });
      await supabaseQuery('logs', 'POST', {
        accion: 'fase_cerrada_automatica',
        detalle: { fase: f.nombre, motivo, ts: ahora.toISOString() }
      });
      console.log(`✅ Fase "${f.nombre}" cerrada (${motivo})`);
    };

    // ¿Quedan partidos sin terminar en una fase? (programado o en_curso)
    const hayPendientes = async (fasePartidos) => {
      try {
        const r = await supabaseQuery(
          `partidos?fase=eq.${fasePartidos}&estado=in.(programado,en_curso)&select=id&limit=1`
        );
        return r.length > 0;
      } catch { return true; } // ante duda, asumir que sí hay pendientes
    };

    // Minutos transcurridos desde que terminó el último partido de una fase.
    // Usa fecha_hora + 2h como estimación del momento de fin del partido.
    // Devuelve null si no hay partidos finalizados en esa fase.
    const minDesdeUltimoPartido = async (fasePartidos) => {
      try {
        const r = await supabaseQuery(
          `partidos?fase=eq.${fasePartidos}&estado=eq.finalizado&select=fecha_hora&order=fecha_hora.desc&limit=1`
        );
        if (!r.length) return null;
        const finEstimado = new Date(r[0].fecha_hora);
        finEstimado.setHours(finEstimado.getHours() + 2); // ~2h por partido
        return (ahora - finEstimado) / 60000;
      } catch { return null; }
    };

    // Minutos que faltan para el primer partido de una fase.
    // Valor negativo = ya comenzó. Devuelve null si no hay partidos.
    const minParaPrimerPartido = async (fasePartidos) => {
      try {
        const r = await supabaseQuery(
          `partidos?fase=eq.${fasePartidos}&select=fecha_hora&order=fecha_hora.asc&limit=1`
        );
        if (!r.length) return null;
        return (new Date(r[0].fecha_hora) - ahora) / 60000;
      } catch { return null; }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // PICKS INICIALES
    // Abre: 12 mayo 00:00 COT (05:00 UTC) — fecha fija
    // Cierra: 30 min antes del primer partido de grupos (dinámico)
    //         Fallback duro: 11 junio 22:00 UTC = 17:00 COT
    // ═══════════════════════════════════════════════════════════════════════════
    {
      const f = fasesDB.find(d => d.nombre === 'Picks Iniciales');
      if (f && !f.cerrada_en) {
        const APERTURA   = new Date('2026-05-01T05:00:00Z'); // 1 mayo — ya pasó, abre de inmediato
        const CIERRE_MAX = new Date('2026-06-11T22:00:00Z'); // fallback duro

        if (f.estado !== 'abierto' && ahora >= APERTURA) {
          await abrirFase(f, 'apertura_programada_mayo1');
        } else if (f.estado === 'abierto') {
          const minPrimero = await minParaPrimerPartido('grupos');
          const cerrar = (minPrimero !== null && minPrimero <= 30) || ahora >= CIERRE_MAX;
          if (cerrar) await cerrarFase(f, '30min_antes_primer_partido_grupos');
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FASE DE GRUPOS
    // Misma ventana que Picks Iniciales: abre desde mayo 1, cierra antes del
    // primer partido del torneo (los picks de grupos se hacen antes de que empiece)
    // ═══════════════════════════════════════════════════════════════════════════
    {
      const f = fasesDB.find(d => d.nombre === 'Fase de Grupos');
      if (f && !f.cerrada_en) {
        const APERTURA   = new Date('2026-05-01T05:00:00Z');
        const CIERRE_MAX = new Date('2026-06-11T22:00:00Z');

        if (f.estado !== 'abierto' && ahora >= APERTURA) {
          await abrirFase(f, 'apertura_programada_mayo1');
        } else if (f.estado === 'abierto') {
          const minPrimero = await minParaPrimerPartido('grupos');
          const cerrar = (minPrimero !== null && minPrimero <= 30) || ahora >= CIERRE_MAX;
          if (cerrar) await cerrarFase(f, '30min_antes_primer_partido_grupos');
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FASES ELIMINATORIAS (dinámica, basada en partidos reales de la BD)
    //
    // Apertura: cuando NO quedan partidos pendientes en la fase previa
    //           Y han pasado ≥ 30 min desde el último partido de esa fase
    // Cierre:   cuando falta ≤ 30 min para el primer partido de esta fase
    //
    // Ajusta `fasePrev` y `faseProp` si los valores en partidos.fase difieren.
    // ═══════════════════════════════════════════════════════════════════════════
    const KNOCK = [
      // nombre en fases  | fase previa en partidos | fase propia en partidos
      { nombre: '16avos',  fasePrev: 'grupos',   faseProp: '16avos'        },
      { nombre: 'Cuartos', fasePrev: '8vos',     faseProp: 'cuartos'       },
      { nombre: 'Semis',   fasePrev: 'cuartos',  faseProp: 'semis'         },
      // Final + 3er puesto abren juntos tras las dos semis
      { nombre: 'Final',   fasePrev: 'semis',    faseProp: 'tercer_puesto' },
    ];

    for (const def of KNOCK) {
      const f = fasesDB.find(d => d.nombre === def.nombre);
      if (!f || f.cerrada_en) continue; // no existe o ya cerrada definitivamente

      if (f.estado !== 'abierto') {
        // Condición de apertura: todos los partidos previos finalizados + 30 min
        const pendientes = await hayPendientes(def.fasePrev);
        if (pendientes) continue;
        const min = await minDesdeUltimoPartido(def.fasePrev);
        if (min !== null && min >= 30) {
          await abrirFase(f, `30min_tras_fin_${def.fasePrev}`);
        }
      } else {
        // Condición de cierre: 30 min para el primer partido de esta fase
        const min = await minParaPrimerPartido(def.faseProp);
        if (min !== null && min <= 30) {
          await cerrarFase(f, `30min_antes_${def.faseProp}`);
        }
      }
    }

    console.log('✅ Verificación de fases completada');
  } catch (err) {
    console.error('❌ Error gestionando fases:', err.message);
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

      // Solo procesar predicciones una vez por partido finalizado
      const yaEnBD = await supabaseQuery(
        `partidos?sportmonks_id=eq.${partido.id}&select=estado,picks_procesados`
      );
      const estabaFinalizado = yaEnBD[0]?.estado === 'finalizado';
      const yaProcesado     = yaEnBD[0]?.picks_procesados === true;

      if (estado === 'finalizado' && resultado && !yaProcesado) {
        await actualizarPredicciones(partido.id, resultado);
        await supabaseQuery(`partidos?sportmonks_id=eq.${partido.id}`, 'PATCH', {
          picks_procesados: true
        });
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
// DETECCIÓN DE PARTIDO ACTIVO
// Devuelve true si hay partido en curso o que empieza en los próximos 10 min.
// Cuando no hay partidos activos el cron sale en ~50ms sin tocar Sportmonks.
// =============================================
async function hayPartidoActivo() {
  try {
    const ahora   = new Date();
    const en10min = new Date(ahora.getTime() + 10 * 60 * 1000);

    // Partidos en curso
    const enCurso = await supabaseQuery(
      `partidos?estado=eq.en_curso&select=id&limit=1`
    );
    if (enCurso.length > 0) return true;

    // Partidos que empiezan en los próximos 10 minutos
    const porEmpezar = await supabaseQuery(
      `partidos?estado=eq.programado&fecha_hora=gte.${ahora.toISOString()}&fecha_hora=lte.${en10min.toISOString()}&select=id&limit=1`
    );
    return porEmpezar.length > 0;
  } catch {
    // Si falla la consulta, preferimos ejecutar de todas formas
    return true;
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
    // 1. Gestión de fases — siempre, es solo lectura/escritura en Supabase
    await gestionarFasesAutomatico();

    // 2. Datos de Sportmonks — solo si hay partido activo o por empezar
    if (SPORTMONKS_TOKEN) {
      const activo = await hayPartidoActivo();
      if (activo) {
        console.log('⚽ Partido activo detectado — sincronizando con Sportmonks...');
        await actualizarPartidos();
        await actualizarEstadisticasEquipos();
        await actualizarEstadisticasJugadores();
      } else {
        const duracionSkip = ((Date.now() - inicio) / 1000).toFixed(2);
        console.log(`⏭️ Sin partidos activos — skip Sportmonks (${duracionSkip}s)`);
        return res.status(200).json({ exito: true, skip: true, duracion: `${duracionSkip}s`, timestamp: new Date().toISOString() });
      }
    } else {
      console.log('⏳ Sportmonks no activo todavía — saltando sync de datos');
    }

    // 3. Log en Supabase
    await supabaseQuery('logs', 'POST', {
      accion: 'cron_ejecutado',
      detalle: { mensaje: 'Cron ejecutado con sync Sportmonks', duracion: ((Date.now() - inicio) / 1000).toFixed(2) + 's', sportmonks_activo: !!SPORTMONKS_TOKEN }
    });

    const duracion = ((Date.now() - inicio) / 1000).toFixed(2);
    console.log(`✅ Cron completado en ${duracion}s`);
    return res.status(200).json({ exito: true, duracion: `${duracion}s`, timestamp: new Date().toISOString() });

  } catch (error) {
    console.error('❌ Error en cron:', error);
    return res.status(500).json({ error: error.message });
  }
}