/**
 * /api/admin/usuarios.js
 *
 * GET    ?page=1&limit=20&q=texto&estado=activo&picks=completo
 *        → Lista paginada de usuarios con filtros
 *
 * POST   body: { nombre, alias, correo, celular, documento, password, estado_pago }
 *        → Crear usuario manualmente (sin Wompi)
 *
 * PATCH  body: { id, estado }  → "activo" | "inactivo"
 *        → Activar o desactivar usuario
 */
const { sb, requireAdmin, setCORS, ok, err } = require("./_lib");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireAdmin(req)) return err(res, "No autorizado", 401);

  // ── GET: listar usuarios ─────────────────────────────────────────────────
  if (req.method === "GET") {
    const { page = 1, limit = 20, q = "", estado = "", picks = "" } = req.query;
    const from = (parseInt(page) - 1) * parseInt(limit);
    const to   = from + parseInt(limit) - 1;

    const params = {
      select: "id,nombre,alias,correo,celular,documento,estado,picks_completos,created_at",
      order: "created_at.desc",
      offset: String(from),
      limit: String(limit),
    };

    // Filtros
    if (estado) params.estado = `eq.${estado}`;
    if (picks === "completo")   params.picks_completos = "eq.true";
    if (picks === "incompleto") params.picks_completos = "eq.false";

    // Búsqueda por texto (nombre, correo, documento)
    if (q) {
      params["or"] = `nombre.ilike.*${q}*,correo.ilike.*${q}*,documento.ilike.*${q}*`;
    }

    const [rData, rCount] = await Promise.all([
      sb("usuarios", { params }),
      sb("usuarios", { params: { ...params, select: "count", head: "true", offset: "0", limit: "1" } }),
    ]);

    if (!rData.ok) return err(res, "Error consultando usuarios");

    // Enriquecer con estado de pago desde tabla pagos
    const ids = (rData.data || []).map(u => u.id);
    let pagosMap = {};
    if (ids.length) {
      const rPagos = await sb("pagos", {
        params: { usuario_id: `in.(${ids.join(",")})`, select: "usuario_id,estado,metodo,created_at", order: "created_at.desc" },
      });
      if (Array.isArray(rPagos.data)) {
        rPagos.data.forEach(p => {
          if (!pagosMap[p.usuario_id]) pagosMap[p.usuario_id] = p;
        });
      }
    }

    const usuarios = (rData.data || []).map(u => ({
      ...u,
      pago_estado: pagosMap[u.id]?.estado || "SIN_PAGO",
      pago_metodo: pagosMap[u.id]?.metodo || null,
    }));

    return ok(res, {
      usuarios,
      total: parseInt(rCount.data?.count ?? 0),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  }

  // ── POST: crear usuario manual ────────────────────────────────────────────
  if (req.method === "POST") {
    const { nombre, alias, correo, celular, documento, password, estado_pago } = req.body || {};
    if (!nombre || !correo || !documento) return err(res, "Faltan campos obligatorios");

    // 1. Crear en Supabase Auth
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: correo,
        password: password || "RoscaTemp2026!",
        email_confirm: true,
        user_metadata: { nombre, alias, celular, documento },
      }),
    });
    const authData = await authRes.json();
    if (!authRes.ok) return err(res, authData.message || "Error creando auth user");

    const uid = authData.id;

    // 2. Insertar en tabla usuarios
    const rUser = await sb("usuarios", {
      method: "POST",
      body: {
        id: uid,
        nombre,
        alias: alias || nombre.split(" ")[0] + "2026",
        correo,
        celular,
        documento,
        estado: estado_pago === "pagado" ? "activo" : "pendiente",
        picks_completos: false,
      },
    });
    if (!rUser.ok) return err(res, "Error insertando usuario en BD");

    // 3. Si viene pagado, registrar pago manual
    if (estado_pago === "pagado") {
      await sb("pagos", {
        method: "POST",
        body: {
          usuario_id: uid,
          monto: 60000,
          estado: "APPROVED",
          metodo: "MANUAL_ADMIN",
          referencia: `ADMIN_${Date.now()}`,
        },
      });
    }

    // 4. Log
    await sb("logs", {
      method: "POST",
      body: { tipo: "admin", mensaje: `Usuario creado manualmente: ${correo}`, meta: { nombre, documento } },
    });

    return ok(res, { mensaje: "Usuario creado exitosamente", id: uid }, 201);
  }

  // ── PATCH: activar / desactivar ───────────────────────────────────────────
  if (req.method === "PATCH") {
    const { id, estado } = req.body || {};
    if (!id || !estado) return err(res, "Faltan id o estado");
    if (!["activo", "inactivo", "pendiente"].includes(estado)) return err(res, "Estado inválido");

    const rUpdate = await sb(`usuarios?id=eq.${id}`, {
      method: "PATCH",
      body: { estado },
    });
    if (!rUpdate.ok) return err(res, "Error actualizando usuario");

    await sb("logs", {
      method: "POST",
      body: { tipo: "admin", mensaje: `Usuario ${id} → estado: ${estado}`, meta: { id, estado } },
    });

    return ok(res, { mensaje: `Usuario ${estado}` });
  }

  return err(res, "Método no permitido", 405);
}
