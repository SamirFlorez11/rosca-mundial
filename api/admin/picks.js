/**
 * /api/admin/picks.js
 *
 * GET ?usuario_id=xxx  → Picks completos del usuario (todas las categorías)
 * GET ?resumen=1       → Resumen de picks de todos los usuarios (tabla)
 */
const { sb, requireAdmin, setCORS, ok, err } = require("./_lib");

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireAdmin(req)) return err(res, "No autorizado", 401);
  if (req.method !== "GET") return err(res, "Método no permitido", 405);

  const { usuario_id, resumen } = req.query;

  // ── Resumen de todos los usuarios ────────────────────────────────────────
  if (resumen === "1") {
    const rUsers = await sb("usuarios", {
      params: {
        estado: "eq.activo",
        select: "id,nombre,alias,picks_completos",
        order: "nombre.asc",
        limit: "500",
      },
    });
    if (!rUsers.ok) return err(res, "Error consultando usuarios");

    const usuarios = rUsers.data || [];

    // Contar picks por categoría para cada usuario (batch)
    const ids = usuarios.map(u => u.id);
    let picksResumen = {};

    if (ids.length) {
      const [rPred, rKiller, rEquipos] = await Promise.all([
        // Predicciones grupos/eliminatorias
        sb("predicciones", {
          params: {
            usuario_id: `in.(${ids.join(",")})`,
            select: "usuario_id,fase",
          },
        }),
        // El Killer
        sb("picks_killer", {
          params: {
            usuario_id: `in.(${ids.join(",")})`,
            select: "usuario_id",
          },
        }),
        // Picks de equipos (carnicero, banderin, etc.)
        sb("picks_equipos", {
          params: {
            usuario_id: `in.(${ids.join(",")})`,
            select: "usuario_id,categoria",
          },
        }),
      ]);

      // Indexar por usuario_id
      const pred   = Array.isArray(rPred.data)    ? rPred.data    : [];
      const killer = Array.isArray(rKiller.data)  ? rKiller.data  : [];
      const equipos= Array.isArray(rEquipos.data) ? rEquipos.data : [];

      ids.forEach(id => {
        const grupos = pred.filter(p => p.usuario_id === id && p.fase === "grupos").length;
        const elim   = pred.filter(p => p.usuario_id === id && p.fase !== "grupos").length;
        const kCount = killer.filter(p => p.usuario_id === id).length;
        const cats   = [...new Set(equipos.filter(p => p.usuario_id === id).map(p => p.categoria))];
        picksResumen[id] = { grupos, elim, killer: kCount, especiales: cats.length };
      });
    }

    return ok(res, {
      usuarios: usuarios.map(u => ({
        ...u,
        picks: picksResumen[u.id] || { grupos: 0, elim: 0, killer: 0, especiales: 0 },
      })),
    });
  }

  // ── Picks de un usuario específico ──────────────────────────────────────
  if (!usuario_id) return err(res, "Falta usuario_id");

  const [rUser, rPred, rKiller, rEquipos] = await Promise.all([
    sb("usuarios", { params: { id: `eq.${usuario_id}`, select: "id,nombre,alias,correo" } }),
    sb("predicciones", {
      params: {
        usuario_id: `eq.${usuario_id}`,
        select: "partido_id,resultado,fase,partidos(equipo_local,equipo_visitante,fecha,fase)",
        order: "partido_id.asc",
      },
    }),
    sb("picks_killer", {
      params: {
        usuario_id: `eq.${usuario_id}`,
        select: "jugador_id,jugadores(nombre,equipo)",
      },
    }),
    sb("picks_equipos", {
      params: {
        usuario_id: `eq.${usuario_id}`,
        select: "categoria,equipo_id,equipos(nombre,pais,bandera_url)",
        order: "categoria.asc",
      },
    }),
  ]);

  const usuario    = (rUser.data || [])[0];
  if (!usuario) return err(res, "Usuario no encontrado", 404);

  const predicciones = rPred.data   || [];
  const killer       = rKiller.data || [];
  const equiposPicks = rEquipos.data|| [];

  // Agrupar predicciones por fase
  const faseMap = {};
  predicciones.forEach(p => {
    const fase = p.fase || p.partidos?.fase || "grupos";
    if (!faseMap[fase]) faseMap[fase] = [];
    faseMap[fase].push({
      partido: `${p.partidos?.equipo_local ?? "?"} vs ${p.partidos?.equipo_visitante ?? "?"}`,
      fecha: p.partidos?.fecha,
      resultado: p.resultado, // "L" | "E" | "V"
    });
  });

  // Agrupar equipos por categoría
  const catMap = {};
  equiposPicks.forEach(p => {
    if (!catMap[p.categoria]) catMap[p.categoria] = [];
    catMap[p.categoria].push(p.equipos?.nombre || p.equipo_id);
  });

  return ok(res, {
    usuario,
    predicciones: faseMap,
    killer: killer.map(k => ({
      nombre: k.jugadores?.nombre || k.jugador_id,
      equipo: k.jugadores?.equipo,
    })),
    especiales: catMap,
    resumen: {
      totalPredicciones: predicciones.length,
      killer: killer.length,
      categoriasEspeciales: Object.keys(catMap).length,
    },
  });
}
