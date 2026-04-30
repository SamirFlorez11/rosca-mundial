import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const {
    nombre_completo,
    correo,
    celular,
    documento,
    password,
    ciudad = "",
    pais = "Colombia",
    nombre_usuario = ""
  } = req.body;

  if (!nombre_completo || !correo || !celular || !documento || !password) {
    return res.status(400).json({ error: "Todos los campos son obligatorios" });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "La contraseña debe tener mínimo 8 caracteres" });
  }

  try {
    const { data: correoExiste } = await supabase
      .from("usuarios")
      .select("id, activo")
      .eq("correo", correo.toLowerCase())
      .maybeSingle();

    if (correoExiste && correoExiste.activo) {
      return res.status(409).json({ error: "Este correo ya está registrado" });
    }

    if (correoExiste && !correoExiste.activo) {
      // Retornar el usuario_id para que pueda reintentar el pago
      return res.status(200).json({
        success: true,
        usuario_id: correoExiste.id,
        mensaje: "Usuario ya registrado, procede al pago"
      });
    }

    const { data: docExiste } = await supabase
      .from("usuarios")
      .select("id,activo")
      .eq("documento", documento)
      .maybeSingle();

    if (docExiste && docExiste.activo) {
      return res.status(409).json({ error: "Este documento ya está registrado" });
    }

    if (docExiste && !docExiste.activo) {
      // Retornar el usuario_id para que pueda reintentar el pago
      return res.status(200).json({
        success: true,
        usuario_id: docExiste.id,
        mensaje: "Usuario ya registrado, procede al pago"
      });
    }

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: correo.toLowerCase(),
      password: password,
      email_confirm: true
    });

    if (authError) {
      console.error("Auth error:", authError);
      if (authError.message.includes("already registered")) {
        return res.status(409).json({ error: "Este correo ya está registrado" });
      }
      return res.status(500).json({ error: "Error al crear la cuenta" });
    }

    const userId = authData.user.id;

    const alias = nombre_usuario || nombre_completo.trim().split(" ")[0];

    const { error: dbError } = await supabase.from("usuarios").insert({
      id: userId,
      nombre_completo: nombre_completo.trim(),
      nombre_usuario: alias,
      correo: correo.toLowerCase(),
      celular: celular.trim(),
      documento: documento.trim(),
      ciudad: ciudad.trim(),
      pais: pais || "Colombia",
      activo: false,
      picks_completos: false
    });

    if (dbError) {
      console.error("DB error:", dbError);
      await supabase.auth.admin.deleteUser(userId);
      return res.status(500).json({ error: "Error al guardar los datos" });
    }

    // Crear cupo #1 vinculado al usuario
    const { error: cupoError } = await supabase.from("cupos").insert({
      usuario_id: userId,
      numero: 1,
      alias: alias,
      activo: false,
      picks_data: {},
      picks_completos: false
    });
    if (cupoError) console.error("Error creando cupo 1:", cupoError.message);

    await supabase.from("logs").insert({
      usuario_id: userId,
      accion: "registro",
      detalle: { correo, nombre_completo, ciudad }
    });

    return res.status(200).json({
      success: true,
      usuario_id: userId,
      mensaje: "Usuario registrado correctamente"
    });

  } catch (err) {
    console.error("Error inesperado:", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}