/**
 * /api/admin/logs.js
 *
 * GET ?tipo=pago|registro|picks|admin|cron|error
 *     &desde=2026-05-12
 *     &hasta=2026-06-11
 *     &q=texto
 *     &page=1&limit=50
 */
const { sb, requireAdmin, setCORS, ok, err } = require("./_lib");

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireAdmin(req)) return err(res, "No autorizado", 401);
  if (req.method !== "GET") return err(res, "Método no permitido", 405);

  const {
    tipo   = "",
    desde  = "",
    hasta  = "",
    q      = "",
    page   = "1",
    limit  = "50",
  } = req.query;

  const from = (parseInt(page) - 1) * parseInt(limit);

  const params = {
    select: "id,tipo,mensaje,meta,created_at",
    order: "created_at.desc",
    offset: String(from),
    limit: String(Math.min(parseInt(limit), 200)),
  };

  if (tipo)  params.tipo       = `eq.${tipo}`;
  if (desde) params.created_at = `gte.${desde}`;
  if (hasta) {
    // Si ya hay un filtro de fecha, usar AND (Supabase permite múltiples params del mismo nombre para OR)
    // Para AND en mismo campo usamos la siguiente convención:
    params["created_at"] = `gte.${desde}`;
    params["created_at.lte"] = hasta; // workaround: se agrega como parámetro extra
  }

  const rLogs = await sb("logs", { params });
  if (!rLogs.ok) return err(res, "Error consultando logs");

  let logs = rLogs.data || [];

  // Filtro de texto (lado servidor, simple)
  if (q) {
    const ql = q.toLowerCase();
    logs = logs.filter(l =>
      l.mensaje?.toLowerCase().includes(ql) ||
      JSON.stringify(l.meta || {}).toLowerCase().includes(ql)
    );
  }

  // Conteo total
  const rCount = await sb("logs", {
    params: { ...(tipo ? { tipo: `eq.${tipo}` } : {}), select: "count", head: "true" },
  });

  // Resumen por tipo
  const resumen = {};
  logs.forEach(l => {
    resumen[l.tipo] = (resumen[l.tipo] || 0) + 1;
  });

  return ok(res, {
    logs,
    total: parseInt(rCount.data?.count ?? 0),
    resumen,
    page: parseInt(page),
  });
}
