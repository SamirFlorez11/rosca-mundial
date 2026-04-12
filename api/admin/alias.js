/**
 * /api/admin/alias.js
 *
 * GET   → Lista todos los alias con flag de sospechoso
 * PATCH body: { usuario_id, alias_nuevo }  → Actualizar alias
 */
const { sb, requireAdmin, setCORS, ok, err } = require("./_lib");

// Palabras que disparan revisión (expandir según necesites)
const PALABRAS_SOSPECHOSAS = [
  "puta","mierda","hijueputa","culo","verga","pendejo","malparido",
  "gonorrea","maricon","idiota","estupido","hdp","ñero","hp",
];

function esSospechoso(alias = "") {
  const a = alias.toLowerCase().replace(/[^a-záéíóúüñ0-9]/gi, "");
  return PALABRAS_SOSPECHOSAS.some(p => a.includes(p));
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireAdmin(req)) return err(res, "No autorizado", 401);

  // ── GET: listar alias ────────────────────────────────────────────────────
  if (req.method === "GET") {
    const rUsers = await sb("usuarios", {
      params: {
        select: "id,nombre,alias,estado,updated_at",
        order: "updated_at.desc",
        limit: "500",
      },
    });
    if (!rUsers.ok) return err(res, "Error consultando alias");

    const usuarios = (rUsers.data || []).map(u => ({
      ...u,
      flagged: esSospechoso(u.alias),
    }));

    const totalFlagged = usuarios.filter(u => u.flagged).length;

    return ok(res, { usuarios, totalFlagged });
  }

  // ── PATCH: actualizar alias ───────────────────────────────────────────────
  if (req.method === "PATCH") {
    const { usuario_id, alias_nuevo } = req.body || {};
    if (!usuario_id || !alias_nuevo) return err(res, "Faltan campos");
    if (alias_nuevo.length < 3 || alias_nuevo.length > 30) return err(res, "Alias debe tener 3-30 caracteres");

    // Verificar que el alias no está tomado
    const rCheck = await sb("usuarios", {
      params: { alias: `eq.${alias_nuevo}`, id: `neq.${usuario_id}`, select: "id" },
    });
    if (Array.isArray(rCheck.data) && rCheck.data.length > 0) {
      return err(res, "Ese alias ya está en uso por otro usuario");
    }

    const rUpdate = await sb(`usuarios?id=eq.${usuario_id}`, {
      method: "PATCH",
      body: { alias: alias_nuevo },
    });
    if (!rUpdate.ok) return err(res, "Error actualizando alias");

    await sb("logs", {
      method: "POST",
      body: {
        tipo: "admin",
        mensaje: `Alias de usuario ${usuario_id} cambiado a: ${alias_nuevo}`,
        meta: { usuario_id, alias_nuevo },
      },
    });

    return ok(res, { mensaje: "Alias actualizado" });
  }

  return err(res, "Método no permitido", 405);
}
