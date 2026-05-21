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
  //  VISITAS
  // ══════════════════════════════════════════════════════
  if (action === "visitas") {
    try {
      const ahora  = new Date();
      const hoy    = ahora.toISOString().slice(0, 10) + "T00:00:00Z";
      const semana = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const mes    = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString();

      // Helper: contar filas con Content-Range
      async function contarVisitas(filtro = "") {
        const sep = filtro ? `&${filtro}` : "";
        const r = await fetch(`${SUPABASE_URL}/rest/v1/visitas?select=id${sep}`, {
          headers: {
            "apikey": SERVICE_KEY,
            "Authorization": `Bearer ${SERVICE_KEY}`,
            "Prefer": "count=exact",
            "Range": "0-0",
          },
        });
        const raw = r.headers.get("content-range") || "";
        const m = raw.match(/\/(\d+)$/);
        return m ? parseInt(m[1]) : 0;
      }

      // Verificar que la tabla existe
      const testR = await fetch(`${SUPABASE_URL}/rest/v1/visitas?select=id&limit=1`, {
        headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` },
      });
      if (!testR.ok) return ok(res, { tablaExiste: false });

      const [cHoy, cSemana, cMes, cTotal] = await Promise.all([
        contarVisitas(`created_at=gte.${encodeURIComponent(hoy)}`),
        contarVisitas(`created_at=gte.${encodeURIComponent(semana)}`),
        contarVisitas(`created_at=gte.${encodeURIComponent(mes)}`),
        contarVisitas(),
      ]);

      return ok(res, { tablaExiste: true, hoy: cHoy, semana: cSemana, mes: cMes, total: cTotal });
    } catch(e) { return err(res, e.message, 500); }
  }

  // ══════════════════════════════════════════════════════
  //  STATS
  // ══════════════════════════════════════════════════════
  if (action === "stats") {
    try {
      const [rPagosAprobados, rTotalUsuarios, rConPicks] = await Promise.all([
        sb("pagos",    { params: { estado: "eq.APPROVED", select: "usuario_id,monto" } }),
        sb("usuarios", { params: { select: "count", head: "true" } }),
        sb("usuarios", { params: { picks_completos: "eq.true", select: "count", head: "true" } }),
      ]);
      const pagosAprobados = Array.isArray(rPagosAprobados.data) ? rPagosAprobados.data : [];
      // Inscritos = usuarios únicos con al menos 1 pago APPROVED (más fiable que activo=true)
      const usuariosConPago = new Set(pagosAprobados.map(p => p.usuario_id));
      const inscritos      = usuariosConPago.size;
      const totalUsuarios  = parseInt(rTotalUsuarios.data?.count ?? 0);
      const pendientes     = Math.max(0, totalUsuarios - inscritos);
      const conPicks       = parseInt(rConPicks.data?.count ?? 0);
      const recaudadoPagos = pagosAprobados.reduce((a, p) => a + (p.monto || 0), 0);
      const recaudado      = Math.max(recaudadoPagos, inscritos * 60000);
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
        select: "id,nombre_completo,nombre_usuario,correo,celular,documento,ciudad,pais,activo,picks_completos,created_at",
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
      // Correo de bienvenida
      try {
        const primerNombre = nombre.trim().split(/\s+/)[0];
        const htmlBienvenida = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:'Arial',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="text-align:center;margin-bottom:28px;">
      <div style="font-size:32px;font-weight:900;letter-spacing:4px;color:#FCD116;">ROSCA MUNDIAL</div>
      <div style="font-size:13px;color:#6b7a99;letter-spacing:1px;margin-top:4px;">MUNDIAL USA · MÉXICO · CANADÁ 2026</div>
    </div>
    <div style="background:#111827;border:1px solid #1e2d45;border-radius:16px;padding:32px;">
      <div style="font-size:22px;font-weight:700;color:#FCD116;margin-bottom:8px;">¡Registro confirmado! ✅</div>
      <div style="font-size:15px;color:#e8eaf0;line-height:1.7;margin-bottom:20px;">
        Hola <strong>${primerNombre}</strong>,<br><br>
        Tu inscripción en la <strong>Rosca Mundial 2026</strong> ha sido confirmada.<br>
        Ya puedes ingresar a la plataforma y comenzar a hacer tus picks.
      </div>
      <div style="background:#1a2235;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
        <div style="font-size:12px;color:#6b7a99;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Fechas clave</div>
        <div style="font-size:13px;color:#e8eaf0;line-height:2;">
          🔒 <strong>Cierre de picks:</strong> 11 de junio 2026, 5:30 PM<br>
          ⚽ <strong>Inicio del Mundial:</strong> 11 de junio 2026, 6:00 PM<br>
          🏆 <strong>Final del Mundial:</strong> 19 de julio 2026
        </div>
      </div>
      <a href="https://roscamundial.com/login.html"
         style="display:block;text-align:center;background:linear-gradient(135deg,#FCD116,#e5a800);color:#000;font-weight:700;font-size:15px;padding:14px;border-radius:10px;text-decoration:none;letter-spacing:1px;">
        ⚡ IR A MIS PICKS
      </a>
    </div>
    <div style="text-align:center;margin-top:20px;font-size:11px;color:#6b7a99;">
      roscamundial.com · Montería, Colombia · 2026
    </div>
  </div>
</body></html>`;
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: `Rosca Mundial <${FROM_EMAIL}>`,
            to: correo.toLowerCase(),
            subject: "✅ ¡Registro confirmado! Ya estás en la Rosca Mundial 2026",
            html: htmlBienvenida,
          }),
        });
      } catch (e) { console.error("Error enviando correo bienvenida:", e); }
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
      const [rPagos, rAprobados, rActivos] = await Promise.all([
        sb("pagos", { params }),
        sb("pagos", { params: { estado: "eq.APPROVED", select: "monto" } }),
        sb("usuarios", { params: { activo: "eq.true", select: "id" } }),
      ]);
      const aprobados         = Array.isArray(rAprobados.data) ? rAprobados.data : [];
      const activosCount      = Array.isArray(rActivos.data) ? rActivos.data.length : 0;
      const recaudadoPorPagos = aprobados.reduce((a, p) => a + (p.monto || 0), 0);
      // Usar el mayor entre lo que dice la tabla pagos y activos×60.000
      // (algunos usuarios fueron activados manualmente sin fila en pagos)
      const totalRecaudado    = Math.max(recaudadoPorPagos, activosCount * 60000);
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
    const rUser = await sb("usuarios", { params: { id: `eq.${usuario_id}`, select: "id,nombre_completo,nombre_usuario,correo,picks_data,picks_completos" } });
    const u = (rUser.data || [])[0];
    const pd = u?.picks_data || {};
    return ok(res, {
      usuario: u ? { ...u, nombre: u.nombre_completo, alias: u.nombre_usuario } : null,
      picks_data: pd,
      resumen: {
        lev: Object.keys(pd.lev||{}).length,
        killer: (pd.killer||[]).length,
        carnicero: (pd.carnicero||[]).length,
        banderin: (pd.banderin||[]).length,
        virgen: (pd.virgen||[]).length,
        pied: (pd.pied||[]).length,
        mecha: (pd.mecha||[]).length,
        completo: u?.picks_completos || false
      }
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
      const ahora = new Date().toISOString();
      const abierto = estado === "abierto";
      // Al cerrar manualmente: setear cerrada_en para que el cron no lo reabra automáticamente.
      // Al abrir manualmente: limpiar cerrada_en para que el cron pueda volver a gestionarlo.
      const patchBody = {
        estado,
        picks_visibles: abierto,
        updated_at: ahora,
        ...(abierto ? { cerrada_en: null, abierta_en: ahora } : { cerrada_en: ahora })
      };
      await sb(`fases?id=eq.${fase_id}`, { method: "PATCH", body: patchBody });
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
  //  EDITAR USUARIO COMPLETO (menos cédula y picks)
  // ══════════════════════════════════════════════════════
  if (action === "editar-usuario" && req.method === "POST") {
    const { usuario_id, nombre_completo, nombre_usuario, correo, celular, ciudad, pais, nueva_password } = req.body || {};
    if (!usuario_id) return err(res, "Falta usuario_id");

    // Verificar usuario existe
    const rU = await sb("usuarios", { params: { id: `eq.${usuario_id}`, select: "id,correo,nombre_completo" } });
    const usuario = rU.data?.[0];
    if (!usuario) return err(res, "Usuario no encontrado");

    // Si cambia correo: verificar que no esté en uso y actualizar en Auth
    if (correo && correo.toLowerCase() !== usuario.correo) {
      const rExiste = await sb("usuarios", { params: { correo: `eq.${correo.toLowerCase()}`, select: "id" } });
      if (rExiste.data?.length > 0) return err(res, "Ese correo ya está en uso por otro usuario");
      const authUp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${usuario_id}`, {
        method: "PUT",
        headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: correo.toLowerCase(), email_confirm: true })
      });
      if (!authUp.ok) { const e = await authUp.json().catch(() => ({})); return err(res, `Error Auth correo: ${e.message || authUp.status}`); }
    }

    // Si cambia contraseña: actualizar en Auth
    if (nueva_password && nueva_password.length >= 8) {
      const authUp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${usuario_id}`, {
        method: "PUT",
        headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password: nueva_password })
      });
      if (!authUp.ok) { const e = await authUp.json().catch(() => ({})); return err(res, `Error Auth pass: ${e.message || authUp.status}`); }
    }

    // Actualizar tabla usuarios
    const patch = {};
    if (nombre_completo) patch.nombre_completo = nombre_completo.trim();
    if (nombre_usuario)  patch.nombre_usuario  = nombre_usuario.trim();
    if (correo)          patch.correo          = correo.toLowerCase();
    if (celular)         patch.celular         = celular.trim();
    if (ciudad !== undefined) patch.ciudad     = ciudad.trim();
    if (pais)            patch.pais            = pais.trim();
    if (Object.keys(patch).length) {
      await sb(`usuarios?id=eq.${usuario_id}`, { method: "PATCH", body: patch });
    }
    await log("usuario_editado", { usuario_id, campos: Object.keys(patch) });
    return ok(res, { mensaje: "Usuario actualizado correctamente" });
  }

  // ══════════════════════════════════════════════════════
  //  ENVIAR EMAIL DE RESET DE CONTRASEÑA
  // ══════════════════════════════════════════════════════
  if (action === "reset-password" && req.method === "POST") {
    const { correo } = req.body || {};
    if (!correo) return err(res, "Falta correo");
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: "POST",
      headers: { "apikey": SERVICE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: correo.toLowerCase() })
    });
    if (!authRes.ok) { const e = await authRes.json().catch(() => ({})); return err(res, e.message || "Error enviando email"); }
    await log("reset_password_enviado", { correo });
    return ok(res, { mensaje: `Email de restablecimiento enviado a ${correo}` });
  }

  // ══════════════════════════════════════════════════════
  //  EDITAR CORREO DE USUARIO
  // ══════════════════════════════════════════════════════
  if (action === "editar-correo" && req.method === "POST") {
    const { usuario_id, nuevo_correo } = req.body || {};
    if (!usuario_id || !nuevo_correo) return err(res, "Faltan parámetros");
    if (!nuevo_correo.includes("@")) return err(res, "Correo inválido");
    // Verificar que no esté en uso por otro usuario
    const rExiste = await sb("usuarios", { params: { correo: `eq.${nuevo_correo.toLowerCase()}`, select: "id" } });
    if (rExiste.data?.length > 0 && rExiste.data[0].id !== usuario_id) {
      return err(res, "Ese correo ya está en uso por otro usuario");
    }
    // Actualizar en Supabase Auth (Admin API REST)
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${usuario_id}`, {
      method: "PUT",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email: nuevo_correo.toLowerCase(), email_confirm: true })
    });
    if (!authRes.ok) {
      const authErr = await authRes.json().catch(() => ({}));
      return err(res, `Error en Auth: ${authErr.message || authRes.status}`);
    }
    // Actualizar en tabla usuarios
    await sb(`usuarios?id=eq.${usuario_id}`, { method: "PATCH", body: { correo: nuevo_correo.toLowerCase() } });
    await log("correo_editado", { usuario_id, nuevo_correo });
    return ok(res, { mensaje: "Correo actualizado correctamente" });
  }

  // ══════════════════════════════════════════════════════
  //  REGISTRAR PAGO MANUAL — para usuarios activos sin fila en pagos
  // ══════════════════════════════════════════════════════
  if (action === "registrar-pago" && req.method === "POST") {
    const { usuario_id, monto, metodo_pago, referencia } = req.body || {};
    if (!usuario_id) return err(res, "Falta usuario_id");
    const rU = await sb("usuarios", { params: { id: `eq.${usuario_id}`, select: "id,nombre_completo,activo" } });
    const usuario = rU.data?.[0];
    if (!usuario) return err(res, "Usuario no encontrado");
    const montoFinal = monto || 60000;
    const metodoPago = metodo_pago || "EFECTIVO";
    const ref = referencia ? `MANUAL_${metodoPago}_${referencia.substring(0,30)}` : `MANUAL_ADMIN_${Date.now()}`;
    await sb("pagos", { method: "POST", body: {
      usuario_id,
      monto: montoFinal,
      moneda: "COP",
      estado: "APPROVED",
      metodo_pago: metodoPago,
      wompi_transaction_id: ref
    }});
    await sb(`usuarios?id=eq.${usuario_id}`, { method: "PATCH", body: { activo: true } });
    await log("pago_registrado_manual", { usuario_id, nombre: usuario.nombre_completo, metodo: metodoPago, monto: montoFinal, referencia });
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
    // ── Lookup tables embebidos ────────────────────────────────────────────────
    const EQ = {mex:'México',rsa:'Sudáfrica',kor:'Corea del Sur',cze:'Rep. Checa',can:'Canadá',bih:'Bosnia-Herz.',qat:'Catar',sui:'Suiza',bra:'Brasil',mar:'Marruecos',hai:'Haití',sco:'Escocia',usa:'EE.UU.',par:'Paraguay',aus:'Australia',tur:'Turquía',ger:'Alemania',cur:'Curazao',civ:'Costa de Marfil',ecu:'Ecuador',ned:'Países Bajos',jpn:'Japón',swe:'Suecia',tun:'Túnez',esp:'España',cpv:'Cabo Verde',ksa:'Arabia Saudita',uru:'Uruguay',fra:'Francia',sen:'Senegal',irq:'Irak',nor:'Noruega',arg:'Argentina',alg:'Argelia',aut:'Austria',jor:'Jordania',por:'Portugal',cod:'RD Congo',uzb:'Uzbekistán',col:'Colombia',eng:'Inglaterra',cro:'Croacia',gha:'Ghana',pan:'Panamá',bel:'Bélgica',egy:'Egipto',irn:'Irán',nzl:'Nueva Zelanda'};
    const PART = [
      {id:'p0', g:'A',f:'Jun 11',lv:'mex',vv:'rsa'},{id:'p1', g:'A',f:'Jun 11',lv:'kor',vv:'cze'},
      {id:'p2', g:'B',f:'Jun 12',lv:'can',vv:'bih'},{id:'p3', g:'D',f:'Jun 12',lv:'usa',vv:'par'},
      {id:'p4', g:'B',f:'Jun 13',lv:'qat',vv:'sui'},{id:'p5', g:'C',f:'Jun 13',lv:'bra',vv:'mar'},
      {id:'p6', g:'C',f:'Jun 13',lv:'hai',vv:'sco'},{id:'p7', g:'D',f:'Jun 13',lv:'aus',vv:'tur'},
      {id:'p8', g:'E',f:'Jun 14',lv:'ger',vv:'cur'},{id:'p9', g:'F',f:'Jun 14',lv:'ned',vv:'jpn'},
      {id:'p10',g:'E',f:'Jun 14',lv:'civ',vv:'ecu'},{id:'p11',g:'F',f:'Jun 14',lv:'swe',vv:'tun'},
      {id:'p12',g:'H',f:'Jun 15',lv:'esp',vv:'cpv'},{id:'p13',g:'G',f:'Jun 15',lv:'bel',vv:'egy'},
      {id:'p14',g:'H',f:'Jun 15',lv:'ksa',vv:'uru'},{id:'p15',g:'G',f:'Jun 15',lv:'irn',vv:'nzl'},
      {id:'p16',g:'I',f:'Jun 16',lv:'fra',vv:'sen'},{id:'p17',g:'I',f:'Jun 16',lv:'irq',vv:'nor'},
      {id:'p18',g:'J',f:'Jun 16',lv:'arg',vv:'alg'},{id:'p19',g:'J',f:'Jun 16',lv:'aut',vv:'jor'},
      {id:'p20',g:'K',f:'Jun 17',lv:'por',vv:'cod'},{id:'p21',g:'L',f:'Jun 17',lv:'eng',vv:'cro'},
      {id:'p22',g:'L',f:'Jun 17',lv:'gha',vv:'pan'},{id:'p23',g:'K',f:'Jun 17',lv:'uzb',vv:'col'},
      {id:'p24',g:'A',f:'Jun 18',lv:'cze',vv:'rsa'},{id:'p25',g:'B',f:'Jun 18',lv:'sui',vv:'bih'},
      {id:'p26',g:'B',f:'Jun 18',lv:'can',vv:'qat'},{id:'p27',g:'A',f:'Jun 18',lv:'mex',vv:'kor'},
      {id:'p28',g:'D',f:'Jun 19',lv:'usa',vv:'aus'},{id:'p29',g:'C',f:'Jun 19',lv:'sco',vv:'mar'},
      {id:'p30',g:'C',f:'Jun 19',lv:'bra',vv:'hai'},{id:'p31',g:'D',f:'Jun 19',lv:'tur',vv:'par'},
      {id:'p32',g:'F',f:'Jun 20',lv:'ned',vv:'swe'},{id:'p33',g:'E',f:'Jun 20',lv:'ger',vv:'civ'},
      {id:'p34',g:'E',f:'Jun 20',lv:'ecu',vv:'cur'},{id:'p35',g:'F',f:'Jun 20',lv:'tun',vv:'jpn'},
      {id:'p36',g:'H',f:'Jun 21',lv:'esp',vv:'ksa'},{id:'p37',g:'G',f:'Jun 21',lv:'bel',vv:'irn'},
      {id:'p38',g:'H',f:'Jun 21',lv:'uru',vv:'cpv'},{id:'p39',g:'G',f:'Jun 21',lv:'nzl',vv:'egy'},
      {id:'p40',g:'I',f:'Jun 22',lv:'fra',vv:'irq'},{id:'p41',g:'I',f:'Jun 22',lv:'nor',vv:'sen'},
      {id:'p42',g:'J',f:'Jun 22',lv:'arg',vv:'aut'},{id:'p43',g:'J',f:'Jun 22',lv:'jor',vv:'alg'},
      {id:'p44',g:'K',f:'Jun 23',lv:'por',vv:'uzb'},{id:'p45',g:'L',f:'Jun 23',lv:'eng',vv:'gha'},
      {id:'p46',g:'L',f:'Jun 23',lv:'pan',vv:'cro'},{id:'p47',g:'K',f:'Jun 23',lv:'col',vv:'cod'},
      {id:'p48',g:'B',f:'Jun 24',lv:'bih',vv:'qat'},{id:'p49',g:'B',f:'Jun 24',lv:'sui',vv:'can'},
      {id:'p50',g:'C',f:'Jun 24',lv:'sco',vv:'bra'},{id:'p51',g:'C',f:'Jun 24',lv:'mar',vv:'hai'},
      {id:'p52',g:'A',f:'Jun 24',lv:'rsa',vv:'kor'},{id:'p53',g:'A',f:'Jun 24',lv:'cze',vv:'mex'},
      {id:'p54',g:'E',f:'Jun 25',lv:'ecu',vv:'ger'},{id:'p55',g:'E',f:'Jun 25',lv:'cur',vv:'civ'},
      {id:'p56',g:'F',f:'Jun 25',lv:'jpn',vv:'swe'},{id:'p57',g:'F',f:'Jun 25',lv:'tun',vv:'ned'},
      {id:'p58',g:'D',f:'Jun 25',lv:'tur',vv:'usa'},{id:'p59',g:'D',f:'Jun 25',lv:'par',vv:'aus'},
      {id:'p60',g:'I',f:'Jun 26',lv:'sen',vv:'irq'},{id:'p61',g:'I',f:'Jun 26',lv:'nor',vv:'fra'},
      {id:'p62',g:'H',f:'Jun 26',lv:'uru',vv:'esp'},{id:'p63',g:'H',f:'Jun 26',lv:'cpv',vv:'ksa'},
      {id:'p64',g:'G',f:'Jun 26',lv:'nzl',vv:'bel'},{id:'p65',g:'G',f:'Jun 26',lv:'egy',vv:'irn'},
      {id:'p66',g:'L',f:'Jun 27',lv:'cro',vv:'gha'},{id:'p67',g:'L',f:'Jun 27',lv:'pan',vv:'eng'},
      {id:'p68',g:'K',f:'Jun 27',lv:'col',vv:'por'},{id:'p69',g:'K',f:'Jun 27',lv:'cod',vv:'uzb'},
      {id:'p70',g:'J',f:'Jun 27',lv:'jor',vv:'arg'},{id:'p71',g:'J',f:'Jun 27',lv:'alg',vv:'aut'},
    ];
    const JUG = {"arg-1":"Messi (ARG)","arg-2":"Álvarez (ARG)","arg-3":"L.Fernández (ARG)","arg-4":"Garnacho (ARG)","arg-5":"Dybala (ARG)","arg-6":"González (ARG)","arg-7":"E.Fernández (ARG)","arg-8":"Paul (ARG)","arg-9":"Allister (ARG)","arg-10":"Paredes (ARG)","arg-11":"Almada (ARG)","arg-12":"Carboni (ARG)","arg-13":"Romero (ARG)","arg-14":"L.Martínez (ARG)","arg-15":"Molina (ARG)","arg-16":"Tagliafico (ARG)","arg-17":"Acuña (ARG)","arg-18":"E.Martínez (ARG)","arg-19":"Rulli (ARG)","bra-1":"Vinicius Jr. (BRA)","bra-2":"Rodrygo (BRA)","bra-3":"Raphinha (BRA)","bra-4":"Endrick (BRA)","bra-5":"Martinelli (BRA)","bra-6":"Richarlison (BRA)","bra-7":"Cunha (BRA)","bra-8":"Neymar (BRA)","bra-9":"Guimarães (BRA)","bra-10":"Paquetá (BRA)","bra-11":"Casemiro (BRA)","bra-12":"Gerson (BRA)","bra-13":"Marquinhos (BRA)","bra-14":"Militão (BRA)","bra-15":"Magalhães (BRA)","bra-16":"Danilo (BRA)","bra-17":"Becker (BRA)","bra-18":"Weverton (BRA)","col-1":"Díaz (COL)","col-2":"Durán (COL)","col-3":"Hernández (COL)","col-4":"Sinisterra (COL)","col-5":"Borré (COL)","col-6":"Rodríguez (COL)","col-7":"Ríos (COL)","col-8":"Quintero (COL)","col-9":"Uribe (COL)","col-10":"Barrios (COL)","col-11":"Sánchez (COL)","col-12":"Mosquera (COL)","col-13":"Lucumí (COL)","col-14":"Muñoz (COL)","col-15":"Vargas (COL)","ecu-1":"Caicedo (ECU)","ecu-2":"Páez (ECU)","ecu-3":"Valencia (ECU)","ecu-4":"Plata (ECU)","ecu-5":"Campana (ECU)","ecu-6":"Mena (ECU)","ecu-7":"Sarmiento (ECU)","ecu-8":"Gruezo (ECU)","ecu-9":"Méndez (ECU)","ecu-10":"Hincapié (ECU)","ecu-11":"Torres (ECU)","ecu-12":"Arreaga (ECU)","ecu-13":"Domínguez (ECU)","usa-1":"Pulisic (USA)","usa-2":"Balogun (USA)","usa-3":"Sargent (USA)","usa-4":"Pepi (USA)","usa-5":"McKennie (USA)","usa-6":"Adams (USA)","usa-7":"Musah (USA)","usa-8":"Reyna (USA)","usa-9":"Aaronson (USA)","usa-10":"Robinson (USA)","usa-11":"Dest (USA)","usa-12":"Scally (USA)","usa-13":"Zimmerman (USA)","usa-14":"Turner (USA)","mex-1":"Giménez (MEX)","mex-2":"Lozano (MEX)","mex-3":"Jiménez (MEX)","mex-4":"Vega (MEX)","mex-5":"Antuna (MEX)","mex-6":"Álvarez (MEX)","mex-7":"Pineda (MEX)","mex-8":"Alvarado (MEX)","mex-9":"Corona (MEX)","mex-10":"Montes (MEX)","mex-11":"Sánchez (MEX)","mex-12":"Arteaga (MEX)","mex-13":"Ochoa (MEX)","can-1":"David (CAN)","can-2":"Buchanan (CAN)","can-3":"Millar (CAN)","can-4":"Larin (CAN)","can-5":"Davies (CAN)","can-6":"Eustáquio (CAN)","can-7":"Koné (CAN)","can-8":"Laryea (CAN)","can-9":"Cornelius (CAN)","can-10":"Miller (CAN)","can-11":"Crépeau (CAN)","uru-1":"Núñez (URU)","uru-2":"Torres (URU)","uru-3":"Rodríguez (URU)","uru-4":"Gómez (URU)","uru-5":"Valverde (URU)","uru-6":"Bentancur (URU)","uru-7":"Cruz (URU)","uru-8":"Canobbio (URU)","uru-9":"Araújo (URU)","uru-10":"Giménez (URU)","uru-11":"Olivera (URU)","uru-12":"Coates (URU)","uru-13":"Rochet (URU)","fra-1":"Mbappé (FRA)","fra-2":"Griezmann (FRA)","fra-3":"Thuram (FRA)","fra-4":"Dembélé (FRA)","fra-5":"Muani (FRA)","fra-6":"Barcola (FRA)","fra-7":"Tchouaméni (FRA)","fra-8":"Kanté (FRA)","fra-9":"Camavinga (FRA)","fra-10":"Zaïre-Emery (FRA)","fra-11":"Guendouzi (FRA)","fra-12":"Saliba (FRA)","fra-13":"Hernández (FRA)","fra-14":"Koundé (FRA)","fra-15":"Upamecano (FRA)","fra-16":"Konaté (FRA)","fra-17":"Maignan (FRA)","esp-1":"Yamal (ESP)","esp-2":"Williams (ESP)","esp-3":"Morata (ESP)","esp-4":"Olmo (ESP)","esp-5":"Torres (ESP)","esp-6":"Gil (ESP)","esp-7":"Pedri (ESP)","esp-8":"Ruiz (ESP)","esp-9":"Rodri (ESP)","esp-10":"Baena (ESP)","esp-11":"Zubimendi (ESP)","esp-12":"Laporte (ESP)","esp-13":"Cucurella (ESP)","esp-14":"Grimaldo (ESP)","esp-15":"Normand (ESP)","esp-16":"Carvajal (ESP)","esp-17":"Simón (ESP)","esp-18":"Raya (ESP)","por-1":"Ronaldo (POR)","por-2":"Leão (POR)","por-3":"Ramos (POR)","por-4":"Félix (POR)","por-5":"Neto (POR)","por-6":"Fernandes (POR)","por-7":"Silva (POR)","por-8":"Vitinha (POR)","por-9":"Neves (POR)","por-10":"Nunes (POR)","por-11":"Dias (POR)","por-12":"Mendes (POR)","por-13":"Cancelo (POR)","por-14":"Inácio (POR)","por-15":"Costa (POR)","mar-1":"Ziyech (MAR)","mar-2":"En-Nesyri (MAR)","mar-3":"Ezzalzouli (MAR)","mar-4":"Aboukhlal (MAR)","mar-5":"Zaroury (MAR)","mar-6":"Amrabat (MAR)","mar-7":"Ounahi (MAR)","mar-8":"Amallah (MAR)","mar-9":"Hakimi (MAR)","mar-10":"Mazraoui (MAR)","mar-11":"Aguerd (MAR)","mar-12":"Bounou) (MAR)","ger-1":"Wirtz (GER)","ger-2":"Musiala (GER)","ger-3":"Havertz (GER)","ger-4":"Füllkrug (GER)","ger-5":"Beier (GER)","ger-6":"Sané (GER)","ger-7":"Führich (GER)","ger-8":"Kimmich (GER)","ger-9":"Goretzka (GER)","ger-10":"Gündogan (GER)","ger-11":"Rüdiger (GER)","ger-12":"Tah (GER)","ger-13":"Schlotterbeck (GER)","ger-14":"Henrichs (GER)","ger-15":"Neuer (GER)","ger-16":"Stegen (GER)","eng-1":"Bellingham (ENG)","eng-2":"Kane (ENG)","eng-3":"Saka (ENG)","eng-4":"Foden (ENG)","eng-5":"Palmer (ENG)","eng-6":"Gordon (ENG)","eng-7":"Watkins (ENG)","eng-8":"Madueke (ENG)","eng-9":"Rice (ENG)","eng-10":"Gallagher (ENG)","eng-11":"Jones (ENG)","eng-12":"Alexander-Arnold (ENG)","eng-13":"Walker (ENG)","eng-14":"Stones (ENG)","eng-15":"Guehi (ENG)","eng-16":"Pickford (ENG)","ned-1":"Gakpo (NED)","ned-2":"Brobbey (NED)","ned-3":"Malen (NED)","ned-4":"Simons (NED)","ned-5":"Reijnders (NED)","ned-6":"Jong (NED)","ned-7":"Gravenberch (NED)","ned-8":"Veerman (NED)","ned-9":"Dijk (NED)","ned-10":"Ligt (NED)","ned-11":"Aké (NED)","ned-12":"Frimpong (NED)","ned-13":"Dumfries (NED)","ned-14":"Verbruggen (NED)","bel-1":"Bruyne (BEL)","bel-2":"Lukaku (BEL)","bel-3":"Openda (BEL)","bel-4":"Ketelaere (BEL)","bel-5":"Lukebakio (BEL)","bel-6":"Trossard (BEL)","bel-7":"Onana (BEL)","bel-8":"Tielemans (BEL)","bel-9":"Theate (BEL)","bel-10":"Faes (BEL)","bel-11":"Courtois (BEL)","jpn-1":"Mitoma (JPN)","jpn-2":"Kubo (JPN)","jpn-3":"Minamino (JPN)","jpn-4":"Doan (JPN)","jpn-5":"Nakamura (JPN)","jpn-6":"Endo (JPN)","jpn-7":"Kamada (JPN)","jpn-8":"Morita (JPN)","jpn-9":"Ao Tanaka (JPN)","jpn-10":"Sugawara (JPN)","jpn-11":"Ko Itakura (JPN)","jpn-12":"Tomiyasu (JPN)","jpn-13":"Gonda (JPN)","kor-1":"Heung-min (KOR)","kor-2":"Kang-in (KOR)","kor-3":"Hee-chan (KOR)","kor-4":"Gue-sung (KOR)","kor-5":"Oh Hyeon-gyu (KOR)","kor-6":"In-beom (KOR)","kor-7":"Jae-sung (KOR)","kor-8":"Seung-ho (KOR)","kor-9":"Min-jae (KOR)","kor-10":"Young-gwon (KOR)","kor-11":"Jin-su (KOR)","kor-12":"Seung-gyu (KOR)","aus-1":"Leckie (AUS)","aus-2":"Boyle (AUS)","aus-3":"Duke (AUS)","aus-4":"Tilio (AUS)","aus-5":"Irankunda (AUS)","aus-6":"McGree (AUS)","aus-7":"Irvine (AUS)","aus-8":"Devlin (AUS)","aus-9":"Souttar (AUS)","aus-10":"Atkinson (AUS)","aus-11":"King (AUS)","aus-12":"Ryan (AUS)","irn-1":"Taremi (IRN)","irn-2":"Azmoun (IRN)","irn-3":"Jahanbakhsh (IRN)","irn-4":"Gholizadeh (IRN)","irn-5":"Ansarifard (IRN)","irn-6":"Ghoddos (IRN)","irn-7":"Nourollahi (IRN)","irn-8":"Rezaeian (IRN)","irn-9":"Mohammadi (IRN)","irn-10":"Pouraliganji (IRN)","irn-11":"Kanani (IRN)","sen-1":"Mané (SEN)","sen-2":"Sarr (SEN)","sen-3":"Jackson (SEN)","sen-4":"Dia (SEN)","sen-5":"Diallo (SEN)","sen-6":"Sarr (SEN)","sen-7":"Camara (SEN)","sen-8":"Gueye (SEN)","sen-9":"Gueye (SEN)","sen-10":"Koulibaly (SEN)","sen-11":"Mendy (SEN)","egy-1":"Salah (EGY)","egy-2":"Marmoush (EGY)","egy-3":"Mohamed (EGY)","egy-4":"Adel (EGY)","egy-5":"Hamdy (EGY)","egy-6":"Elneny (EGY)","egy-7":"Fathi (EGY)","egy-8":"Tawfik (EGY)","egy-9":"Abdelmonem (EGY)","egy-10":"Gabaski (EGY)","civ-1":"Adingra (CIV)","civ-2":"Haller (CIV)","civ-3":"Zaha (CIV)","civ-4":"Kouamé (CIV)","civ-5":"Krasso (CIV)","civ-6":"Kessié (CIV)","civ-7":"Sangaré (CIV)","civ-8":"Fofana (CIV)","civ-9":"Bailly (CIV)","civ-10":"Boly (CIV)","gha-1":"Kudus (GHA)","gha-2":"Semenyo (GHA)","gha-3":"Williams (GHA)","gha-4":"Ekuban (GHA)","gha-5":"Ayew (GHA)","gha-6":"Partey (GHA)","gha-7":"Samed (GHA)","gha-8":"Lamptey (GHA)","gha-9":"Djiku (GHA)","gha-10":"Ofori (GHA)","ksa-1":"Al-Dawsari (KSA)","ksa-2":"Al-Buraikan (KSA)","ksa-3":"Al-Shehri (KSA)","ksa-4":"Bahebri (KSA)","ksa-5":"Kanno (KSA)","ksa-6":"Al-Najei (KSA)","ksa-7":"Al-Bulaihi (KSA)","ksa-8":"Al-Ghanam (KSA)","ksa-9":"Al-Owais (KSA)","cro-1":"Modrić (CRO)","cro-2":"Kramarić (CRO)","cro-3":"Petković (CRO)","cro-4":"Pjaca (CRO)","cro-5":"Kovačić (CRO)","cro-6":"Brozović (CRO)","cro-7":"Vlašić (CRO)","cro-8":"Sučić (CRO)","cro-9":"Majer (CRO)","cro-10":"Gvardiol (CRO)","cro-11":"Stanišić (CRO)","cro-12":"Livaković (CRO)","sui-1":"Xhaka (SUI)","sui-2":"Embolo (SUI)","sui-3":"Okafor (SUI)","sui-4":"Ndoye (SUI)","sui-5":"Amdouni (SUI)","sui-6":"Shaqiri (SUI)","sui-7":"Aebischer (SUI)","sui-8":"Rieder (SUI)","sui-9":"Akanji (SUI)","sui-10":"Elvedi (SUI)","sui-11":"Widmer (SUI)","sui-12":"Sommer (SUI)","aut-1":"Sabitzer (AUT)","aut-2":"Baumgartner (AUT)","aut-3":"Laimer (AUT)","aut-4":"Wimmer (AUT)","aut-5":"Schmid (AUT)","aut-6":"Arnautović (AUT)","aut-7":"Gregoritsch (AUT)","aut-8":"Weimann (AUT)","aut-9":"Alaba (AUT)","aut-10":"Lienhart (AUT)","aut-11":"Wöber (AUT)","aut-12":"Posch (AUT)","aut-13":"Pentz (AUT)","tur-1":"Çalhanoğlu (TUR)","tur-2":"Güler (TUR)","tur-3":"Yıldız (TUR)","tur-4":"Yılmaz (TUR)","tur-5":"Yıldırım (TUR)","tur-6":"Kadıoğlu (TUR)","tur-7":"Özcan (TUR)","tur-8":"Çelik (TUR)","tur-9":"Akaydın (TUR)","tur-10":"Kabak (TUR)","tur-11":"Çakır (TUR)","sco-1":"Robertson (SCO)","sco-2":"McTominay (SCO)","sco-3":"Shankland (SCO)","sco-4":"McGinn (SCO)","sco-5":"Gilmour (SCO)","sco-6":"Christie (SCO)","sco-7":"Adams (SCO)","sco-8":"Dykes (SCO)","sco-9":"Tierney (SCO)","sco-10":"McKenna (SCO)","sco-11":"Gordon (SCO)","pan-1":"Díaz (PAN)","pan-2":"Waterman (PAN)","pan-3":"Fajardo (PAN)","pan-4":"Stephens (PAN)","pan-5":"Carrasquilla (PAN)","pan-6":"Bárcenas (PAN)","pan-7":"Quintero (PAN)","pan-8":"Miller (PAN)","pan-9":"Davis (PAN)","nzl-1":"Wood (NZL)","nzl-2":"Elliot (NZL)","nzl-3":"Garbett (NZL)","nzl-4":"Just (NZL)","nzl-5":"Bell (NZL)","nzl-6":"Cacace (NZL)","nzl-7":"Tuiloma (NZL)","nzl-8":"Payne (NZL)","par-1":"Almirón (PAR)","par-2":"Enciso (PAR)","par-3":"Sanabria (PAR)","par-4":"Gómez (PAR)","par-5":"Villasanti (PAR)","par-6":"Lucena (PAR)","par-7":"Giménez (PAR)","par-8":"Gómez (PAR)","par-9":"Rojas (PAR)","par-10":"Arzamendia (PAR)","par-11":"Aguilar (PAR)","rsa-1":"Tau (RSA)","rsa-2":"Zwane (RSA)","rsa-3":"Makgopa (RSA)","rsa-4":"Foster (RSA)","rsa-5":"Mokoena (RSA)","rsa-6":"Zungu (RSA)","rsa-7":"Maart (RSA)","rsa-8":"Morena (RSA)","rsa-9":"Sibisi (RSA)","rsa-10":"Kekana (RSA)","rsa-11":"Williams (RSA)","cze-1":"Souček (CZE)","cze-2":"Schick (CZE)","cze-3":"Hložek (CZE)","cze-4":"Kuchta (CZE)","cze-5":"Lingr (CZE)","cze-6":"Barák (CZE)","cze-7":"Provod (CZE)","cze-8":"Coufal (CZE)","cze-9":"Holeš (CZE)","cze-10":"Jurásek (CZE)","cze-11":"Kovář (CZE)","bih-1":"Džeko (BIH)","bih-2":"Demirović (BIH)","bih-3":"Bajrami (BIH)","bih-4":"Pjanić (BIH)","bih-5":"Ahmedhodžić (BIH)","bih-6":"Botman (BIH)","bih-7":"Žunić (BIH)","bih-8":"Šehić (BIH)","qat-1":"Afif (QAT)","qat-2":"Ali (QAT)","qat-3":"Ahmed (QAT)","qat-4":"Al-Haydos (QAT)","qat-5":"Boudiaf (QAT)","qat-6":"Hassan (QAT)","qat-7":"Barsham (QAT)","hai-1":"Nazon (HAI)","hai-2":"Pierrot (HAI)","hai-3":"Dossou (HAI)","hai-4":"Guerrier (HAI)","hai-5":"Saba (HAI)","hai-6":"Jérôme (HAI)","cur-1":"Bacuna (CUR)","cur-2":"Zeefuik (CUR)","cur-3":"Antonia (CUR)","cur-4":"Koolwijk (CUR)","cur-5":"Carolina (CUR)","cur-6":"Martina (CUR)","swe-1":"Gyökeres (SWE)","swe-2":"Isak (SWE)","swe-3":"Kulusevski (SWE)","swe-4":"Forsberg (SWE)","swe-5":"Svanberg (SWE)","swe-6":"Bergvall (SWE)","swe-7":"Adegbenro (SWE)","swe-8":"Hien (SWE)","swe-9":"Augustinsson (SWE)","swe-10":"Johnsson (SWE)","tun-1":"Skhiri (TUN)","tun-2":"Mejbri (TUN)","tun-3":"Jaziri (TUN)","tun-4":"Khazri (TUN)","tun-5":"Msakni (TUN)","tun-6":"Sliti (TUN)","tun-7":"Talbi (TUN)","tun-8":"Bronn (TUN)","tun-9":"Abdi (TUN)","tun-10":"Said (TUN)","cpv-1":"Mendes (CPV)","cpv-2":"Rodrigues (CPV)","cpv-3":"Cabral (CPV)","cpv-4":"Monteiro (CPV)","cpv-5":"Andrade (CPV)","cpv-6":"Rocha (CPV)","cpv-7":"Soares (CPV)","irq-1":"Attwan (IRQ)","irq-2":"Resan (IRQ)","irq-3":"Ali (IRQ)","irq-4":"Ali (IRQ)","irq-5":"Tariq (IRQ)","irq-6":"Yaseen (IRQ)","irq-7":"Natiq (IRQ)","irq-8":"Hassan (IRQ)","nor-1":"Haaland (NOR)","nor-2":"Sörloth (NOR)","nor-3":"Nusa (NOR)","nor-4":"Holm (NOR)","nor-5":"Ødegaard (NOR)","nor-6":"Berge (NOR)","nor-7":"Thorsby (NOR)","nor-8":"Østigård (NOR)","nor-9":"Ajer (NOR)","nor-10":"Nyland (NOR)","alg-1":"Mahrez (ALG)","alg-2":"Amoura (ALG)","alg-3":"Belaïli (ALG)","alg-4":"Delort (ALG)","alg-5":"Bennacer (ALG)","alg-6":"Aouar (ALG)","alg-7":"Bedrane (ALG)","alg-8":"Atal (ALG)","alg-9":"Bensebaini (ALG)","alg-10":"Benlamri (ALG)","jor-1":"Al-Taamari (JOR)","jor-2":"Al-Naimat (JOR)","jor-3":"Mardini (JOR)","jor-4":"Al-Rawabdeh (JOR)","jor-5":"Ibrahim (JOR)","jor-6":"Al-Ajalin (JOR)","jor-7":"Faisal (JOR)","jor-8":"Shafi (JOR)","cod-1":"Bakambu (COD)","cod-2":"Wissa (COD)","cod-3":"Lukebakio (COD)","cod-4":"Bongonda (COD)","cod-5":"Mbemba (COD)","cod-6":"Masuaku (COD)","cod-7":"Kiassumbua (COD)","uzb-1":"Shomurodov (UZB)","uzb-2":"Khamdamov (UZB)","uzb-3":"Fayzullayev (UZB)","uzb-4":"Shukurov (UZB)","uzb-5":"Turgunboev (UZB)","uzb-6":"Masharipov (UZB)","uzb-7":"Yakhshiboev (UZB)","uzb-8":"Jurayev (UZB)","uzb-9":"Abdukholiqov (UZB)","uzb-10":"Sergeyev (UZB)"};

    const levLabel = v => v === 'L' ? 'Local' : v === 'E' ? 'Empate' : v === 'V' ? 'Visitante' : '';
    const jug = id => JUG[id] || id;
    const eq  = id => EQ[id]  || id;

    // ── Encabezados ────────────────────────────────────────────────────────────
    const header = [
      "Nombre","Alias","Correo","Estado",
      "LEV completados","Killer completados","Carnicero completados",
      "Banderín completados","Virgen completados","Pie de Niña completados","Mecha Corta completados",
    ];
    // LEV: 72 partidos de fase de grupos
    PART.forEach(p => header.push(`LEV Gr${p.g} ${p.f} — ${EQ[p.lv]} vs ${EQ[p.vv]}`));
    // Killer: 15 posiciones
    for (let i=1;i<=15;i++) header.push(`Killer ${i}`);
    // Categorías de equipos: 10 c/u
    const CATS = [{k:'carnicero',l:'Carnicero'},{k:'banderin',l:'Banderín'},{k:'virgen',l:'Virgen'},{k:'pied',l:'Pie de Niña'},{k:'mecha',l:'Mecha Corta'}];
    CATS.forEach(({l}) => { for(let i=1;i<=10;i++) header.push(`${l} ${i}`); });

    // ── Filas por usuario ──────────────────────────────────────────────────────
    const r = await sb("usuarios", { params: { select: "id,nombre_completo,nombre_usuario,correo,picks_data,picks_completos", order: "nombre_completo.asc", limit: "500" } });
    const rows = [header];

    (r.data || []).forEach(u => {
      const p = u.picks_data || {};
      const levKeys = Object.keys(p.lev || {});
      const row = [
        u.nombre_completo, u.nombre_usuario || "—", u.correo || "—",
        u.picks_completos ? "COMPLETO" : "INCOMPLETO",
        `${levKeys.length}/72`,
        `${(p.killer||[]).length}/15`,
        `${(p.carnicero||[]).length}/10`,
        `${(p.banderin||[]).length}/10`,
        `${(p.virgen||[]).length}/10`,
        `${(p.pied||[]).length}/10`,
        `${(p.mecha||[]).length}/10`,
      ];
      // LEV por partido
      PART.forEach(pt => row.push(levLabel(p.lev?.[pt.id] || '')));
      // Killer
      const killer = p.killer || [];
      for (let i=0;i<15;i++) row.push(killer[i] ? jug(killer[i]) : '');
      // Equipos por categoría
      CATS.forEach(({k}) => {
        const arr = p[k] || [];
        for (let i=0;i<10;i++) row.push(arr[i] ? eq(arr[i]) : '');
      });
      rows.push(row);
    });

    const csv = "﻿" + rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv;charset=utf-8");
    res.setHeader("Content-Disposition", `attachment;filename=rosca-picks-detalle-${new Date().toISOString().slice(0,10)}.csv`);
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
      const TABLAS_BK = ["usuarios","pagos","fases"];
      const exports = await Promise.all(TABLAS_BK.map(async t => {
        const r = await sb(t, { params: { select: "id", limit: "10000" } });
        return { tabla: t, registros: (r.data||[]).length };
      }));
      // Contar usuarios con picks completos
      const rPicks = await sb("usuarios", { params: { picks_completos: "eq.true", select: "id", head: "true" } });
      const nombre = `backup_${new Date().toISOString().replace(/[:.]/g,"-")}.json`;
      await log("backup_manual", { nombre, tablas: exports, picks_completos: parseInt(rPicks.data?.count||0), timestamp: new Date().toISOString() });
      return ok(res, { mensaje: "Backup registrado. Usa ⬇ Descargar para obtener el JSON completo con todos los picks.", nombre, tablas: exports }, 201);
    }
  }

  if (action === "backup-download") {
    // Exporta TODO: usuarios (con picks_data), pagos, fases, logs recientes
    const [rU, rP, rF, rL] = await Promise.all([
      sb("usuarios", { params: { select: "*", order: "created_at.asc", limit: "2000" } }),
      sb("pagos",    { params: { select: "*", order: "created_at.asc", limit: "2000" } }),
      sb("fases",    { params: { select: "*", order: "fecha_inicio.asc" } }),
      sb("logs",     { params: { select: "*", order: "created_at.desc", limit: "1000" } }),
    ]);
    // Resumen de picks por usuario para referencia rápida
    const picksResumen = (rU.data || []).map(u => {
      const p = u.picks_data || {};
      return {
        id: u.id, nombre: u.nombre_completo, alias: u.nombre_usuario, correo: u.correo,
        lev: Object.keys(p.lev||{}).length,
        killer: (p.killer||[]).length, carnicero: (p.carnicero||[]).length,
        banderin: (p.banderin||[]).length, virgen: (p.virgen||[]).length,
        pied: (p.pied||[]).length, mecha: (p.mecha||[]).length,
        completo: u.picks_completos,
        picks_data: p,
      };
    });
    return ok(res, {
      exportado: new Date().toISOString(),
      version: "2.0",
      resumen: {
        total_usuarios: (rU.data||[]).length,
        total_pagos: (rP.data||[]).length,
        total_fases: (rF.data||[]).length,
        usuarios_con_picks_completos: picksResumen.filter(u=>u.completo).length,
      },
      tablas: {
        usuarios: rU.data || [],
        pagos: rP.data || [],
        fases: rF.data || [],
        logs: rL.data || [],
      },
      picks_resumen: picksResumen,
    });
  }

  return err(res, "Acción no encontrada: " + action, 404);
}