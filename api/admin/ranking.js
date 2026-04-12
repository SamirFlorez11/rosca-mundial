/**
 * /api/admin/ranking.js
 *
 * GET ?categoria=principal|killer|carnicero|banderin|virgen|pied|mecha&limit=25
 *     → Top N del ranking solicitado
 */
const { sb, requireAdmin, setCORS, ok, err } = require("./_lib");

const TABLAS = {
  principal:  { tabla: "ranking",             colPuntos: "aciertos",          label: "Aciertos" },
  killer:     { tabla: "ranking_killer",      colPuntos: "puntos_goles_asist", label: "G+A" },
  carnicero:  { tabla: "ranking_carnicero",   colPuntos: "puntos_tarjetas",    label: "Pts tarjetas" },
  banderin:   { tabla: "ranking_banderin",    colPuntos: "puntos_corners",     label: "Corners" },
  virgen:     { tabla: "ranking_virgen",      colPuntos: "puntos_virgen",      label: "Goles recibidos (menos)" },
  pied:       { tabla: "ranking_pied",        colPuntos: "puntos_pied",        label: "Pts tarjetas (menos)" },
  mecha:      { tabla: "ranking_mecha",       colPuntos: "puntos_mecha",       label: "Corners (menos)" },
};

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireAdmin(req)) return err(res, "No autorizado", 401);
  if (req.method !== "GET") return err(res, "Método no permitido", 405);

  const { categoria = "principal", limit = "25" } = req.query;

  // Si pide "todos", devolver todos los rankings de una vez
  if (categoria === "todos") {
    const resultados = {};
    await Promise.all(
      Object.entries(TABLAS).map(async ([cat, cfg]) => {
        const r = await sb(cfg.tabla, {
          params: {
            select: `posicion,${cfg.colPuntos},usuarios(alias,nombre)`,
            order: `${cfg.colPuntos}.desc`,
            limit: "10",
          },
        });
        resultados[cat] = {
          label: cfg.label,
          data: (r.data || []).map((row, i) => ({
            posicion: row.posicion || i + 1,
            alias:    row.usuarios?.alias || "—",
            nombre:   row.usuarios?.nombre || "—",
            puntos:   row[cfg.colPuntos] ?? 0,
          })),
        };
      })
    );
    return ok(res, { rankings: resultados });
  }

  const cfg = TABLAS[categoria];
  if (!cfg) return err(res, `Categoría inválida. Usar: ${Object.keys(TABLAS).join("|")}`);

  const r = await sb(cfg.tabla, {
    params: {
      select: `posicion,usuario_id,${cfg.colPuntos},usuarios(alias,nombre,correo)`,
      order: `${cfg.colPuntos}.desc`,
      limit: String(Math.min(parseInt(limit), 100)),
    },
  });

  if (!r.ok) return err(res, "Error consultando ranking");

  const data = (r.data || []).map((row, i) => ({
    posicion: row.posicion || i + 1,
    alias:    row.usuarios?.alias  || "—",
    nombre:   row.usuarios?.nombre || "—",
    correo:   row.usuarios?.correo || "—",
    puntos:   row[cfg.colPuntos]   ?? 0,
  }));

  return ok(res, { categoria, label: cfg.label, ranking: data });
}
