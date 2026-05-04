const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const FROM_EMAIL   = process.env.RESEND_FROM_EMAIL || "noreply@roscamundial.com";

// ─── Cliente Supabase ─────────────────────────────────────────────────────────
async function sb(table, { method = "GET", body, params = {} } = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const qs = new URLSearchParams(params).toString();
  if (qs) url += "?" + qs;
  const res = await fetch(url, {
    method,
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": method === "POST" ? "return=representation" : "return=minimal",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { data, status: res.status, ok: res.ok };
}

// ─── Log helper (usa estructura real de tabla logs) ───────────────────────────
async function log(accion, detalle = {}, usuario_id = null) {
  try {
    await sb("logs", { method: "POST", body: { accion, detalle, usuario_id } });
  } catch (e) { console.error("Error escribiendo log:", e.message); }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function requireAdmin(req) {
  const token = req.headers["x-admin-token"];
  if (!ADMIN_SECRET) return false;
  return token === ADMIN_SECRET;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Admin-Token");
}
const ok  = (res, data, status = 200) => res.status(status).json({ ok: true,  ...data });
const err = (res, msg,  status = 400) => res.status(status).json({ ok: false, error: msg });

// ─── Router ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireAdmin(req)) return err(res, "No autorizado", 401);

  const action = req.query.action || "";

  // ══════════════════════════════════════════════════════
  //  STATS
  // ══════════════════════════════════════════════════════
  if (action === "stats") {
    try {
      const [rActivos, rPendientes, rConPicks, rRecaudado] = await Promise.all([
        sb("usuarios", { params: { activo: "eq.true",  select: "count", head: "true" } }),
        sb("usuarios", { params: { activo: "eq.false", select: "count", head: "true" } }),
        sb("usuarios", { params: { picks_completos: "eq.true", activo: "eq.true", select: "count", head: "true" } }),
        sb("pagos",    { params: { estado: "eq.APPROVED", select: "monto" } }),
      ]);
      const inscritos  = parseInt(rActivos.data?.count    ?? 0);
      const pendientes = parseInt(rPendientes.data?.count ?? 0);
      const conPicks   = parseInt(rConPicks.data?.count   ?? 0);
      const pagos      = Array.isArray(rRecaudado.data) ? rRecaudado.data : [];
      const recaudado  = pagos.reduce((a, p) => a + (p.monto || 0), 0);
      const hace14     = new Date(Date.now() - 14 * 86400000).toISOString();
      const rDiario    = await sb("pagos", { params: { estado: "eq.APPROVED", created_at: `gte.${hace14}`, select: "created_at", order: "created_at.asc" } });
      const dias = {};
      for (let i = 13; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000).toISOString().split("T")[0];
        dias[d] = 0;
      }
      if (Array.isArray(rDiario.data)) rDiario.data.forEach(p => { const d = p.created_at?.split("T")[0]; if (d && dias[d] !== undefined) dias[d]++; });
      return ok(res, { inscritos, pendientes, conPicks, sinPicks: inscritos - conPicks, recaudado, meta: 400, porcentaje: Math.round(inscritos / 400 * 100), chartDiario: Object.entries(dias).map(([fecha, count]) => ({ fecha, count })) });
    } catch (e) { return err(res, e.message, 500); }
  }

  // ══════════════════════════════════════════════════════
  //  USUARIOS
  // ══════════════════════════════════════════════════════
  if (action === "usuarios") {
    if (req.method === "GET") {
      const { page = 1, limit = 20, q = "", activo = "", picks = "" } = req.query;
      const from = (parseInt(page) - 1) * parseInt(limit);
      const params = {
        select: "id,nombre_completo,nombre_usuario,correo,celular,documento,activo,picks_completos,created_at",
        order: "created_at.desc", offset: String(from), limit: String(limit)
      };
      if (activo !== "") params.activo = `eq.${activo}`;
      if (picks === "completo")   params.picks_completos = "eq.true";
      if (picks === "incompleto") params.picks_completos = "eq.false";
      if (q) params["or"] = `nombre_completo.ilike.*${q}*,correo.ilike.*${q}*,documento.ilike.*${q}*`;
      const [rData, rCount] = await Promise.all([
        sb("usuarios", { params }),
        sb("usuarios", { params: { ...params, select: "count", head: "true", offset: "0", limit: "1" } }),
      ]);
      if (!rData.ok) return err(res, "Error consultando usuarios");
      const ids = (rData.data || []).map(u => u.id);
      let pagosMap = {};
      if (ids.length) {
        const rPagos = await sb("pagos", { params: { usuario_id: `in.(${ids.join(",")})`, select: "usuario_id,estado,metodo_pago", order: "created_at.desc" } });
        if (Array.isArray(rPagos.data)) rPagos.data.forEach(p => { if (!pagosMap[p.usuario_id]) pagosMap[p.usuario_id] = p; });
      }
      const usuarios = (rData.data || []).map(u => ({
        ...u,
        alias: u.nombre_usuario,
        nombre: u.nombre_completo,
        // Fallback: si activo=true pero no hay fila en pagos, mostrar como pagado
        pago_estado: pagosMap[u.id]?.estado || (u.activo ? "APPROVED" : "SIN_PAGO"),
        pago_metodo: pagosMap[u.id]?.metodo_pago || (u.activo ? "ACTIVADO_MANUAL" : null),
        tiene_pago_registrado: !!pagosMap[u.id],
      }));
      return ok(res, { usuarios, total: parseInt(rCount.data?.count ?? 0) });
    }
    if (req.method === "POST") {
      const { nombre, alias, correo, celular, documento, password, estado_pago } = req.body || {};
      if (!nombre || !correo || !documento) return err(res, "Faltan campos obligatorios");
      const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: correo, password: password || "RoscaTemp2026!", email_confirm: true })
      });
      const authData = await authRes.json();
      if (!authRes.ok) return err(res, authData.message || "Error creando auth user");
      const uid = authData.id;
      await sb("usuarios", { method: "POST", body: {
        id: uid, nombre_completo: nombre,
        nombre_usuario: alias || nombre.split(" ")[0] + "2026",
        correo, celular, documento,
        password_hash: "auth_managed_by_supabase",
        activo: estado_pago === "pagado",
        picks_completos: false
      }});
      if (estado_pago === "pagado") {
        await sb("pagos", { method: "POST", body: { usuario_id: uid, monto: 60000, moneda: "COP", estado: "APPROVED", metodo_pago: "MANUAL_ADMIN", wompi_transaction_id: `ADMIN_${Date.now()}` }});
      }
      await log(`usuario_creado_manual`, { nombre, correo, documento, estado_pago });
      return ok(res, { mensaje: "Usuario creado", id: uid }, 201);
    }
    if (req.method === "PATCH") {
      const { id, activo } = req.body || {};
      if (!id || activo === undefined) return err(res, "Faltan id o activo");
      await sb(`usuarios?id=eq.${id}`, { method: "PATCH", body: { activo } });
      await log(`usuario_${activo ? "activado" : "desactivado"}`, { id });
      return ok(res, { mensaje: `Usuario ${activo ? "activado" : "desactivado"}` });
    }
  }

  // ══════════════════════════════════════════════════════
  //  PAGOS
  // ══════════════════════════════════════════════════════
  if (action === "pagos") {
    if (req.method === "GET") {
      const { page = 1, limit = 30, estado = "" } = req.query;
      const from = (parseInt(page) - 1) * parseInt(limit);
      const params = {
        select: "id,usuario_id,monto,moneda,estado,metodo_pago,wompi_transaction_id,created_at,usuarios(nombre_completo,correo)",
        order: "created_at.desc", offset: String(from), limit: String(limit)
      };
      if (estado) params.estado = `eq.${estado}`;
      const [rPagos, rAprobados] = await Promise.all([
        sb("pagos", { params }),
        sb("pagos", { params: { estado: "eq.APPROVED", select: "monto" } }),
      ]);
      const aprobados      = Array.isArray(rAprobados.data) ? rAprobados.data : [];
      const totalRecaudado = aprobados.reduce((a, p) => a + (p.monto || 0), 0);
      return ok(res, { pagos: rPagos.data || [], totalRecaudado, pozo: Math.round(totalRecaudado * 0.7), organizador: Math.round(totalRecaudado * 0.3) });
    }
    if (req.method === "PATCH") {
      const { pago_id, usuario_id } = req.body || {};
      if (!pago_id || !usuario_id) return err(res, "Faltan pago_id o usuario_id");
      await Promise.all([
        sb(`pagos?id=eq.${pago_id}`,       { method: "PATCH", body: { estado: "APPROVED", metodo_pago: "MANUAL_ADMIN" } }),
        sb(`usuarios?id=eq.${usuario_id}`, { method: "PATCH", body: { activo: true } }),
      ]);
      await log("pago_activado_manual", { pago_id, usuario_id });
      return ok(res, { mensaje: "Pago aprobado y usuario activado" });
    }
  }

  // ══════════════════════════════════════════════════════
  //  ALIAS
  // ══════════════════════════════════════════════════════
  if (action === "alias") {
    const PALABRAS = ["puta","mierda","hijueputa","culo","verga","pendejo","malparido","gonorrea","maricon","idiota","hdp","hp"];
    const esSospechoso = (a = "") => { const s = a.toLowerCase().replace(/[^a-z0-9]/gi,""); return PALABRAS.some(p => s.includes(p)); };
    if (req.method === "GET") {
      const r = await sb("usuarios", { params: { select: "id,nombre_completo,nombre_usuario,activo", order: "nombre_completo.asc", limit: "500" } });
      const usuarios = (r.data || []).map(u => ({ ...u, alias: u.nombre_usuario, nombre: u.nombre_completo, flagged: esSospechoso(u.nombre_usuario) }));
      return ok(res, { usuarios, totalFlagged: usuarios.filter(u => u.flagged).length });
    }
    if (req.method === "PATCH") {
      const { usuario_id, alias_nuevo } = req.body || {};
      if (!usuario_id || !alias_nuevo) return err(res, "Faltan campos");
      const rCheck = await sb("usuarios", { params: { nombre_usuario: `eq.${alias_nuevo}`, id: `neq.${usuario_id}`, select: "id" } });
      if (Array.isArray(rCheck.data) && rCheck.data.length > 0) return err(res, "Alias ya en uso");
      await sb(`usuarios?id=eq.${usuario_id}`, { method: "PATCH", body: { nombre_usuario: alias_nuevo } });
      await log("alias_actualizado", { usuario_id, alias_nuevo });
      return ok(res, { mensaje: "Alias actualizado" });
    }
  }

  // ══════════════════════════════════════════════════════
  //  PICKS
  // ══════════════════════════════════════════════════════
  if (action === "picks") {
    const { usuario_id, resumen } = req.query;
    if (resumen === "1") {
      const r = await sb("usuarios", { params: { activo: "eq.true", select: "id,nombre_completo,nombre_usuario,picks_completos", order: "nombre_completo.asc", limit: "500" } });
      return ok(res, { usuarios: (r.data || []).map(u => ({ ...u, nombre: u.nombre_completo, alias: u.nombre_usuario })) });
    }
    if (!usuario_id) return err(res, "Falta usuario_id");
    const [rUser, rPred, rKiller, rEquipos] = await Promise.all([
      sb("usuarios",     { params: { id: `eq.${usuario_id}`, select: "id,nombre_completo,nombre_usuario,correo" } }),
      sb("predicciones", { params: { usuario_id: `eq.${usuario_id}`, select: "partido_id,prediccion,es_correcto", order: "partido_id.asc" } }),
      sb("picks_killer", { params: { usuario_id: `eq.${usuario_id}`, select: "jugador_id" } }),
      sb("picks_equipos",{ params: { usuario_id: `eq.${usuario_id}`, select: "categoria,equipo_id", order: "categoria.asc" } }),
    ]);
    const catMap = {};
    (rEquipos.data || []).forEach(p => { if (!catMap[p.categoria]) catMap[p.categoria] = []; catMap[p.categoria].push(p.equipo_id); });
    const u = (rUser.data || [])[0];
    return ok(res, {
      usuario: u ? { ...u, nombre: u.nombre_completo, alias: u.nombre_usuario } : null,
      predicciones: rPred.data || [],
      killer: rKiller.data || [],
      especiales: catMap,
      resumen: { totalPredicciones: (rPred.data||[]).length, killer: (rKiller.data||[]).length, categoriasEspeciales: Object.keys(catMap).length }
    });
  }

  // ══════════════════════════════════════════════════════
  //  FASES
  // ══════════════════════════════════════════════════════
  if (action === "fases") {
    if (req.method === "GET") {
      const r = await sb("fases", { params: { select: "id,nombre,estado,fecha_inicio,fecha_fin,picks_visibles", order: "fecha_inicio.asc" } });
      return ok(res, { fases: (r.data || []).map(f => ({ ...f, apertura_picks: f.fecha_inicio, cierre_picks: f.fecha_fin })) });
    }
    if (req.method === "PATCH") {
      const { fase_id, estado } = req.body || {};
      if (!fase_id || !estado) return err(res, "Faltan campos");
      if (!["abierto","cerrado","bloqueada"].includes(estado)) return err(res, "Estado inválido. Usar: abierto | cerrado | bloqueada");
      const abierto = estado === "abierto";
      await sb(`fases?id=eq.${fase_id}`, { method: "PATCH", body: { estado, picks_visibles: abierto, updated_at: new Date().toISOString() } });
      await log("fase_cambiada_manual", { fase_id, estado });
      return ok(res, { mensaje: `Fase ${estado}` });
    }
  }

  // ══════════════════════════════════════════════════════
  //  RANKING
  // ══════════════════════════════════════════════════════
  if (action === "ranking") {
    const TABLAS = {
      principal: { tabla: "ranking",            col: "puntos_total", label: "Aciertos" },
      killer:    { tabla: "ranking_killer",      col: "puntos_total", label: "G+A" },
      carnicero: { tabla: "ranking_carnicero",   col: "puntos_total", label: "Pts tarjetas" },
      banderin:  { tabla: "ranking_banderin",    col: "puntos_total", label: "Corners" },
      virgen:    { tabla: "ranking_virgen",      col: "puntos_total", label: "Goles (menos)" },
      pied:      { tabla: "ranking_pie_de_nina", col: "puntos_total", label: "Tarjetas (menos)" },
      mecha:     { tabla: "ranking_mechacorta",  col: "puntos_total", label: "Corners (menos)" },
    };
    const resultados = {};
    await Promise.all(Object.entries(TABLAS).map(async ([cat, cfg]) => {
      const r = await sb(cfg.tabla, { params: { select: `${cfg.col},usuarios(nombre_usuario,nombre_completo)`, order: `${cfg.col}.desc`, limit: "10" } });
      resultados[cat] = { label: cfg.label, data: (r.data || []).map((row, i) => ({ posicion: i + 1, alias: row.usuarios?.nombre_usuario || "—", nombre: row.usuarios?.nombre_completo || "—", puntos: row[cfg.col] ?? 0 })) };
    }));
    return ok(res, { rankings: resultados });
  }

  // ══════════════════════════════════════════════════════
  //  LOGS — usa columnas reales: accion, detalle (jsonb)
  // ══════════════════════════════════════════════════════
  if (action === "logs") {
    if (req.method !== "GET") return err(res, "Método no permitido", 405);
    const { accion = "", limit = "50", page = "1" } = req.query;
    const from = (parseInt(page) - 1) * parseInt(limit);
    const params = {
      select: "id,accion,detalle,usuario_id,ip_address,created_at",
      order: "created_at.desc",
      offset: String(from),
      limit: String(Math.min(parseInt(limit), 200))
    };
    if (accion) params.accion = `eq.${accion}`;
    const [rLogs, rCount] = await Promise.all([
      sb("logs", { params }),
      sb("logs", { params: { ...(accion ? { accion: `eq.${accion}` } : {}), select: "count", head: "true" } }),
    ]);
    // Normalizar para el panel: mapear accion → tipo, detalle → meta
    const logs = (rLogs.data || []).map(l => ({
      ...l,
      tipo:    l.accion,
      mensaje: typeof l.detalle === "object" ? (l.detalle?.mensaje || l.accion) : l.accion,
      meta:    l.detalle,
    }));
    return ok(res, { logs, total: parseInt(rCount.data?.count ?? 0) });
  }

  // ══════════════════════════════════════════════════════
  //  NOTIFICACIONES — tabla real por usuario individual
  // ══════════════════════════════════════════════════════
  if (action === "notificaciones") {
    if (req.method === "GET") {
      // Listar notificaciones recientes agrupadas por asunto
      const r = await sb("notificaciones", {
        params: { select: "id,tipo,asunto,estado,intentos,created_at,enviado_at,usuario_id", order: "created_at.desc", limit: "100" }
      });
      // Agrupar por asunto para mostrar envíos masivos
      const grupos = {};
      (r.data || []).forEach(n => {
        const key = n.asunto || n.tipo;
        if (!grupos[key]) grupos[key] = { asunto: key, tipo: n.tipo, total: 0, enviados: 0, created_at: n.created_at };
        grupos[key].total++;
        if (n.estado === "enviado") grupos[key].enviados++;
      });
      return ok(res, { notificaciones: Object.values(grupos) });
    }
    if (req.method === "POST") {
      // Envío masivo: crea un registro por usuario en tabla notificaciones + envía email
      const { destinatarios, correo_especifico, asunto, mensaje, tipo = "email_masivo" } = req.body || {};
      if (!asunto || !mensaje) return err(res, "Faltan asunto o mensaje");

      // Obtener lista de usuarios según destinatarios
      let usuarios = [];
      if (destinatarios === "uno") {
        if (!correo_especifico) return err(res, "Falta correo_especifico");
        const r = await sb("usuarios", { params: { correo: `eq.${correo_especifico}`, select: "id,correo,nombre_completo" } });
        usuarios = r.data || [];
      } else if (destinatarios === "todos") {
        const r = await sb("usuarios", { params: { activo: "eq.true", select: "id,correo,nombre_completo" } });
        usuarios = r.data || [];
      } else if (destinatarios === "pendientes") {
        const r = await sb("usuarios", { params: { activo: "eq.false", select: "id,correo,nombre_completo" } });
        usuarios = r.data || [];
      } else if (destinatarios === "sin-picks") {
        const r = await sb("usuarios", { params: { activo: "eq.true", picks_completos: "eq.false", select: "id,correo,nombre_completo" } });
        usuarios = r.data || [];
      }
      if (!usuarios.length) return err(res, "Sin destinatarios");

      const htmlBody = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 20px;background:#0D1B3E;color:#fff;border-radius:16px;"><h1 style="color:#E8A020;">${asunto}</h1><div style="color:rgba(255,255,255,0.8);line-height:1.7;white-space:pre-line;">${mensaje}</div><p style="color:rgba(255,255,255,0.3);font-size:11px;margin-top:24px;">roscamundial.com</p></div>`;
      let enviados = 0;

      // Enviar en batches y registrar en tabla notificaciones por usuario
      const correos = usuarios.map(u => u.correo).filter(Boolean);
      for (let i = 0; i < correos.length; i += 50) {
        const batch = correos.slice(i, i + 50);
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: `Rosca Mundial <${FROM_EMAIL}>`, to: batch, subject: asunto, html: htmlBody })
        });
        if (r.ok) enviados += batch.length;
      }

      // Registrar una notificación por usuario
      for (const u of usuarios) {
        await sb("notificaciones", { method: "POST", body: {
          usuario_id: u.id, tipo, asunto,
          estado: enviados > 0 ? "enviado" : "error",
          enviado_at: enviados > 0 ? new Date().toISOString() : null,
        }});
      }

      await log("notificacion_masiva_enviada", { destinatarios, asunto, enviados, total: usuarios.length });
      return ok(res, { mensaje: `Enviado a ${enviados} de ${usuarios.length}`, enviados });
    }
  }

  // ══════════════════════════════════════════════════════
  //  CRON FORCE
  // ══════════════════════════════════════════════════════
  if (action === "cron-force") {
    const { tipo = "todo" } = req.body || {};
    const BASE = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://roscamundial.com";
    const inicio = Date.now();
    try {
      const cronRes = await fetch(`${BASE}/api/cron-actualizar-datos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.CRON_SECRET}` },
        body: JSON.stringify({ tipo, forzado: true })
      });
      const duracion = ((Date.now() - inicio) / 1000).toFixed(2) + "s";
      await log("cron_forzado_manual", { tipo, duracion, exito: cronRes.ok });
      return ok(res, { mensaje: `Sync "${tipo}" completado`, duracion });
    } catch (e) {
      return err(res, `Error ejecutando sync: ${e.message}`, 500);
    }
  }

  // ══════════════════════════════════════════════════════
  //  REGISTRAR PAGO MANUAL — para usuarios activos sin fila en pagos
  // ══════════════════════════════════════════════════════
  if (action === "registrar-pago" && req.method === "POST") {
    const { usuario_id } = req.body || {};
    if (!usuario_id) return err(res, "Falta usuario_id");
    // Verificar que el usuario existe y está activo
    const rU = await sb("usuarios", { params: { id: `eq.${usuario_id}`, select: "id,nombre_completo,activo" } });
    const usuario = rU.data?.[0];
    if (!usuario) return err(res, "Usuario no encontrado");
    // Insertar pago APPROVED
    const rP = await sb("pagos", { method: "POST", body: {
      usuario_id,
      monto: 60000,
      moneda: "COP",
      estado: "APPROVED",
      metodo_pago: "WOMPI_WEBHOOK_MANUAL",
      wompi_transaction_id: `MANUAL_ADMIN_${Date.now()}`
    }});
    // Asegurar activo = true
    await sb(`usuarios?id=eq.${usuario_id}`, { method: "PATCH", body: { activo: true } });
    await log("pago_registrado_manual", { usuario_id, nombre: usuario.nombre_completo });
    return ok(res, { mensaje: `Pago registrado para ${usuario.nombre_completo}` }, 201);
  }

  // ══════════════════════════════════════════════════════
  //  PICKS EXPORT (JSON + CSV) — evita exponer service key en frontend
  // ══════════════════════════════════════════════════════
  if (action === "picks-export-json") {
    const r = await sb("usuarios", { params: { activo: "eq.true", select: "id,nombre_completo,nombre_usuario,picks_data", order: "nombre_completo.asc", limit: "500" } });
    const picks = (r.data || []).map(u => ({ id: u.id, nombre: u.nombre_completo, alias: u.nombre_usuario, picks_data: u.picks_data }));
    return ok(res, { exportado: new Date().toISOString(), total_usuarios: picks.length, picks });
  }

  if (action === "picks-export-csv") {
    const r = await sb("usuarios", { params: { activo: "eq.true", select: "id,nombre_completo,nombre_usuario,picks_data", order: "nombre_completo.asc", limit: "500" } });
    const rows = [["ID","Nombre","Alias","LEV (partidos)","Killer","Carnicero","Banderin","Virgen","Pied","Mecha","Estado"]];
    (r.data || []).forEach(u => {
      const p = u.picks_data || {};
      rows.push([u.id, u.nombre_completo, u.nombre_usuario || "—",
        Object.keys(p.lev || {}).length, (p.killer||[]).length, (p.carnicero||[]).length,
        (p.banderin||[]).length, (p.virgen||[]).length, (p.pied||[]).length, (p.mecha||[]).length,
        Object.keys(p.lev || {}).length >= 72 && (p.killer||[]).length >= 15 && (p.carnicero||[]).length >= 10 ? "COMPLETO" : "INCOMPLETO"]);
    });
    const csv = "﻿" + rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv;charset=utf-8");
    res.setHeader("Content-Disposition", `attachment;filename=rosca-picks-${new Date().toISOString().slice(0,10)}.csv`);
    return res.status(200).send(csv);
  }

  // ══════════════════════════════════════════════════════
  //  CUPOS — gestión de cupos por usuario
  // ══════════════════════════════════════════════════════
  if (action === "cupos") {
    if (req.method === "GET") {
      const { usuario_id } = req.query;
      const params = { select: "id,usuario_id,numero,alias,activo,picks_completos,created_at", order: "usuario_id.asc,numero.asc", limit: "1000" };
      if (usuario_id) params.usuario_id = `eq.${usuario_id}`;
      const r = await sb("cupos", { params });
      // Agrupar por usuario_id para stats generales
      if (!usuario_id) {
        const byUser = {};
        (r.data || []).forEach(c => {
          if (!byUser[c.usuario_id]) byUser[c.usuario_id] = { total: 0, activos: 0 };
          byUser[c.usuario_id].total++;
          if (c.activo) byUser[c.usuario_id].activos++;
        });
        const totalCupos  = (r.data || []).length;
        const totalActivos = (r.data || []).filter(c => c.activo).length;
        const usuariosMulti = Object.values(byUser).filter(u => u.total > 1).length;
        return ok(res, { cupos: r.data || [], stats: { totalCupos, totalActivos, usuariosMulti } });
      }
      return ok(res, { cupos: r.data || [] });
    }
    if (req.method === "POST") {
      const { usuario_id, alias } = req.body || {};
      if (!usuario_id) return err(res, "Falta usuario_id");
      // Verificar cupos actuales
      const rCount = await sb("cupos", { params: { usuario_id: `eq.${usuario_id}`, select: "count", head: "true" } });
      const count = parseInt(rCount.data?.count ?? 0);
      if (count >= 5) return err(res, "Máximo 5 cupos por usuario");
      const numero = count + 1;
      // Obtener alias base del usuario si no se provee
      let alias_final = alias;
      if (!alias_final) {
        const rU = await sb("usuarios", { params: { id: `eq.${usuario_id}`, select: "nombre_usuario" } });
        const nombre_usuario = rU.data?.[0]?.nombre_usuario || "Cupo";
        alias_final = `${nombre_usuario} - Cupo ${numero}`;
      }
      const rInsert = await sb("cupos", { method: "POST", body: { usuario_id, numero, alias: alias_final, activo: true, picks_data: {}, picks_completos: false } });
      if (!rInsert.ok) return err(res, "Error creando cupo");
      await log("cupo_creado_admin", { usuario_id, numero, alias: alias_final });
      return ok(res, { mensaje: `Cupo #${numero} creado`, cupo: rInsert.data?.[0] }, 201);
    }
    if (req.method === "PATCH") {
      const { cupo_id, alias, activo } = req.body || {};
      if (!cupo_id) return err(res, "Falta cupo_id");
      const updates = {};
      if (alias !== undefined) updates.alias = alias.trim();
      if (activo !== undefined) updates.activo = activo;
      await sb(`cupos?id=eq.${cupo_id}`, { method: "PATCH", body: updates });
      await log("cupo_actualizado_admin", { cupo_id, ...updates });
      return ok(res, { mensaje: "Cupo actualizado" });
    }
  }

  // ══════════════════════════════════════════════════════
  //  BACKUP — guarda en logs con accion="backup"
  // ══════════════════════════════════════════════════════
  if (action === "backup") {
    if (req.method === "GET") {
      const r = await sb("logs", { params: { accion: "eq.backup_manual", select: "id,detalle,created_at", order: "created_at.desc", limit: "10" } });
      return ok(res, { backups: (r.data || []).map(l => ({ ...l, nombre: l.detalle?.nombre || "backup", tamano_kb: l.detalle?.tamano_kb || 0 })) });
    }
    if (req.method === "POST") {
      const TABLAS_BK = ["usuarios","pagos","predicciones","picks_killer","picks_equipos","fases","ranking"];
      const exports = await Promise.all(TABLAS_BK.map(async t => {
        const r = await sb(t, { params: { select: "*", limit: "10000" } });
        return { tabla: t, registros: (r.data||[]).length };
      }));
      const nombre = `backup_${new Date().toISOString().replace(/[:.]/g,"-")}.json`;
      await log("backup_manual", { nombre, tablas: exports, timestamp: new Date().toISOString() });
      return ok(res, { mensaje: "Backup registrado", nombre, tablas: exports }, 201);
    }
  }

  return err(res, "Acción no encontrada: " + action, 404);
}