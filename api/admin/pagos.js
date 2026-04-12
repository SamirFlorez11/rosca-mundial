/**
 * /api/admin/pagos.js
 *
 * GET   ?page=1&limit=30&estado=APPROVED|PENDING|DECLINED&q=texto
 *       → Lista de pagos con datos del usuario
 *
 * PATCH body: { pago_id, usuario_id }
 *       → Activar pago manual (marcar APPROVED y activar usuario)
 */
const { sb, requireAdmin, setCORS, ok, err } = require("./_lib");

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireAdmin(req)) return err(res, "No autorizado", 401);

  // ── GET: listar pagos ────────────────────────────────────────────────────
  if (req.method === "GET") {
    const { page = 1, limit = 30, estado = "", q = "" } = req.query;
    const from = (parseInt(page) - 1) * parseInt(limit);

    const params = {
      select: "id,usuario_id,monto,estado,metodo,referencia,created_at,usuarios(nombre,correo,celular,documento)",
      order: "created_at.desc",
      offset: String(from),
      limit: String(limit),
    };
    if (estado) params.estado = `eq.${estado}`;

    const rPagos = await sb("pagos", { params });
    if (!rPagos.ok) return err(res, "Error consultando pagos");

    let pagos = rPagos.data || [];

    // Filtro texto del lado servidor (simple)
    if (q) {
      const ql = q.toLowerCase();
      pagos = pagos.filter(p =>
        p.usuarios?.nombre?.toLowerCase().includes(ql) ||
        p.usuarios?.correo?.toLowerCase().includes(ql) ||
        p.referencia?.toLowerCase().includes(ql)
      );
    }

    // Conteo total para paginación
    const rCount = await sb("pagos", {
      params: { ...(estado ? { estado: `eq.${estado}` } : {}), select: "count", head: "true" },
    });

    // Resumen financiero
    const rAprobados = await sb("pagos", {
      params: { estado: "eq.APPROVED", select: "monto" },
    });
    const aprobados = Array.isArray(rAprobados.data) ? rAprobados.data : [];
    const totalRecaudado = aprobados.reduce((acc, p) => acc + (p.monto || 0), 0);

    return ok(res, {
      pagos,
      total: parseInt(rCount.data?.count ?? 0),
      totalRecaudado,
      pozo: Math.round(totalRecaudado * 0.7),
      organizador: Math.round(totalRecaudado * 0.3),
    });
  }

  // ── PATCH: activar pago manual ────────────────────────────────────────────
  if (req.method === "PATCH") {
    const { pago_id, usuario_id } = req.body || {};
    if (!pago_id || !usuario_id) return err(res, "Faltan pago_id o usuario_id");

    // Marcar pago como APPROVED
    const rPago = await sb(`pagos?id=eq.${pago_id}`, {
      method: "PATCH",
      body: { estado: "APPROVED", metodo: "MANUAL_ADMIN" },
    });
    if (!rPago.ok) return err(res, "Error actualizando pago");

    // Activar usuario
    const rUser = await sb(`usuarios?id=eq.${usuario_id}`, {
      method: "PATCH",
      body: { estado: "activo" },
    });
    if (!rUser.ok) return err(res, "Error activando usuario");

    // Log
    await sb("logs", {
      method: "POST",
      body: {
        tipo: "pago",
        mensaje: `Pago #${pago_id} activado manualmente por admin`,
        meta: { pago_id, usuario_id },
      },
    });

    return ok(res, { mensaje: "Pago aprobado y usuario activado" });
  }

  return err(res, "Método no permitido", 405);
}
