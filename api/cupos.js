import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  // Verificar auth del usuario
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No autenticado" });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: "Token inválido" });

  const usuario_id = user.id;

  // ── GET /api/cupos — listar cupos del usuario ──────────────────────────────
  if (req.method === "GET") {
    const { data: cupos, error } = await supabase
      .from("cupos")
      .select("id,numero,alias,activo,picks_completos,created_at")
      .eq("usuario_id", usuario_id)
      .order("numero", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ cupos: cupos || [] });
  }

  // ── POST /api/cupos — crear cupo adicional ──────────────────────────────────
  if (req.method === "POST") {
    const { alias } = req.body || {};

    // Verificar que el usuario base esté activo (pagó)
    const { data: usuario } = await supabase
      .from("usuarios")
      .select("activo, nombre_usuario")
      .eq("id", usuario_id)
      .single();

    if (!usuario?.activo) {
      return res.status(403).json({ error: "Tu cuenta base debe estar activa para agregar cupos" });
    }

    // Contar cupos actuales
    const { count } = await supabase
      .from("cupos")
      .select("*", { count: "exact", head: true })
      .eq("usuario_id", usuario_id);

    if ((count || 0) >= 5) {
      return res.status(400).json({ error: "Máximo 5 cupos por usuario" });
    }

    const numero = (count || 0) + 1;
    const alias_final = alias?.trim() || `${usuario.nombre_usuario} - Cupo ${numero}`;

    const { data: nuevoCupo, error: insertError } = await supabase
      .from("cupos")
      .insert({
        usuario_id,
        numero,
        alias: alias_final,
        activo: false,
        picks_data: {},
        picks_completos: false
      })
      .select("id,numero,alias")
      .single();

    if (insertError) return res.status(500).json({ error: insertError.message });

    await supabase.from("logs").insert({
      usuario_id,
      accion: "cupo_creado",
      detalle: { numero, alias: alias_final }
    });

    return res.status(201).json({
      ok: true,
      cupo: nuevoCupo,
      mensaje: `Cupo #${numero} creado. Procede al pago para activarlo.`
    });
  }

  // ── PATCH /api/cupos — actualizar alias / activar ───────────────────────────
  if (req.method === "PATCH") {
    const { cupo_id, alias, activo } = req.body || {};
    if (!cupo_id) return res.status(400).json({ error: "Falta cupo_id" });

    // Verificar que el cupo pertenece al usuario
    const { data: cupo } = await supabase
      .from("cupos")
      .select("id,usuario_id,numero")
      .eq("id", cupo_id)
      .single();

    if (!cupo || cupo.usuario_id !== usuario_id) {
      return res.status(403).json({ error: "No tienes permiso sobre este cupo" });
    }

    const updates = {};
    if (alias !== undefined) updates.alias = alias.trim();
    if (activo !== undefined) updates.activo = activo;

    const { error } = await supabase
      .from("cupos")
      .update(updates)
      .eq("id", cupo_id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, mensaje: "Cupo actualizado" });
  }

  return res.status(405).json({ error: "Método no permitido" });
}
