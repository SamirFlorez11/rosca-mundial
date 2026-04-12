/**
 * /api/admin/stats.js
 * GET → Devuelve estadísticas generales para el dashboard admin
 */
const { sb, requireAdmin, setCORS, ok, err } = require("./_lib");

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireAdmin(req)) return err(res, "No autorizado", 401);
  if (req.method !== "GET") return err(res, "Método no permitido", 405);

  try {
    // ── Conteos paralelos ──────────────────────────────────────────────────
    const [
      rInscritos,
      rPendientes,
      rInactivos,
      rConPicks,
      rPagosHoy,
      rRecaudado,
    ] = await Promise.all([
      // Usuarios con pago aprobado
      sb("usuarios", { params: { estado: "eq.activo", select: "count", head: "true" } }),
      // Registrados sin pago confirmado
      sb("usuarios", { params: { estado: "eq.pendiente", select: "count", head: "true" } }),
      // Desactivados
      sb("usuarios", { params: { estado: "eq.inactivo", select: "count", head: "true" } }),
      // Usuarios con picks completos (todas las categorías)
      sb("usuarios", { params: { picks_completos: "eq.true", estado: "eq.activo", select: "count", head: "true" } }),
      // Pagos aprobados hoy
      sb("pagos", { params: {
        estado: "eq.APPROVED",
        created_at: `gte.${new Date().toISOString().split("T")[0]}`,
        select: "count",
        head: "true",
      }}),
      // Total recaudado
      sb("pagos", { params: { estado: "eq.APPROVED", select: "monto" } }),
    ]);

    const inscritos  = parseInt(rInscritos.data?.count  ?? 0);
    const pendientes = parseInt(rPendientes.data?.count ?? 0);
    const inactivos  = parseInt(rInactivos.data?.count  ?? 0);
    const conPicks   = parseInt(rConPicks.data?.count   ?? 0);
    const pagosHoy   = parseInt(rPagosHoy.data?.count   ?? 0);

    // Sumar montos de pagos aprobados
    const pagos = Array.isArray(rRecaudado.data) ? rRecaudado.data : [];
    const recaudado = pagos.reduce((acc, p) => acc + (p.monto || 0), 0);

    // ── Inscritos por día (últimos 14 días) ────────────────────────────────
    const hace14 = new Date(Date.now() - 14 * 86400000).toISOString();
    const rDiario = await sb("pagos", {
      params: {
        estado: "eq.APPROVED",
        created_at: `gte.${hace14}`,
        select: "created_at",
        order: "created_at.asc",
      },
    });

    const dias = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().split("T")[0];
      dias[d] = 0;
    }
    if (Array.isArray(rDiario.data)) {
      rDiario.data.forEach(p => {
        const d = p.created_at?.split("T")[0];
        if (d && dias[d] !== undefined) dias[d]++;
      });
    }

    return ok(res, {
      inscritos,
      pendientes,
      inactivos,
      conPicks,
      sinPicks: inscritos - conPicks,
      pagosHoy,
      recaudado,
      meta: 400,
      porcentaje: Math.round(inscritos / 400 * 100),
      chartDiario: Object.entries(dias).map(([fecha, count]) => ({ fecha, count })),
    });

  } catch (e) {
    console.error("[admin/stats]", e);
    return err(res, "Error interno", 500);
  }
}
