/**
 * /api/admin/fases.js
 *
 * GET   → Estado actual de todas las fases
 * PATCH body: { fase_id, estado }  → "abierto" | "cerrado" | "pendiente"
 */
const { sb, requireAdmin, setCORS, ok, err } = require("./_lib");

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireAdmin(req)) return err(res, "No autorizado", 401);

  // ── GET: leer fases ───────────────────────────────────────────────────────
  if (req.method === "GET") {
    const rFases = await sb("fases", {
      params: {
        select: "id,nombre,descripcion,estado,apertura_picks,cierre_picks,orden",
        order: "orden.asc",
      },
    });
    if (!rFases.ok) return err(res, "Error consultando fases");
    return ok(res, { fases: rFases.data || [] });
  }

  // ── PATCH: cambiar estado de fase ─────────────────────────────────────────
  if (req.method === "PATCH") {
    const { fase_id, estado } = req.body || {};
    if (!fase_id || !estado) return err(res, "Faltan fase_id o estado");
    if (!["abierto", "cerrado", "pendiente"].includes(estado)) {
      return err(res, "Estado inválido. Usar: abierto | cerrado | pendiente");
    }

    // Si se va a ABRIR una fase, verificar que la anterior esté cerrada
    if (estado === "abierto") {
      const rFases = await sb("fases", {
        params: { select: "id,orden,estado", order: "orden.asc" },
      });
      const fases = rFases.data || [];
      const actual = fases.find(f => f.id === fase_id);
      if (actual) {
        const anterior = fases.find(f => f.orden === actual.orden - 1);
        if (anterior && anterior.estado !== "cerrado") {
          return err(res, `La fase anterior (${anterior.nombre}) debe estar cerrada primero`);
        }
      }
    }

    const rUpdate = await sb(`fases?id=eq.${fase_id}`, {
      method: "PATCH",
      body: {
        estado,
        ...(estado === "abierto" ? { abierta_en: new Date().toISOString() } : {}),
        ...(estado === "cerrado" ? { cerrada_en: new Date().toISOString() } : {}),
      },
    });
    if (!rUpdate.ok) return err(res, "Error actualizando fase");

    // Log de acción crítica
    await sb("logs", {
      method: "POST",
      body: {
        tipo: "admin",
        mensaje: `Fase ${fase_id} → ${estado.toUpperCase()} (acción admin)`,
        meta: { fase_id, estado, timestamp: new Date().toISOString() },
      },
    });

    return ok(res, { mensaje: `Fase ${estado === "abierto" ? "abierta" : "cerrada"} correctamente` });
  }

  return err(res, "Método no permitido", 405);
}
