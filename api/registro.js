const { createClient } = require("@supabase/supabase-js")

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
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
      .select("id")
      .eq("correo", correo.toLowerCase())
      .maybeSingle();

    if (correoExiste) {
      return res.status(409).json({ error: "Este correo ya está registrado" });
    }

    const { data: docExiste } = await supabase
      .from("usuarios")
      .select("id")
      .eq("documento", documento)
      .maybeSingle();

    if (docExiste) {
      return res.status(409).json({ error: "Este documento ya está registrado" });
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

    const { error: dbError } = await supabase.from("usuarios").insert({
      id: userId,
      nombre_completo: nombre_completo.trim(),
      nombre_usuario: nombre_usuario || nombre_completo.trim().split(" ")[0],
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
