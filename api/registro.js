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

    // Generar alias "Nombre Apellido", único (si duplicado: "Nombre Apellido2")
    const partes = nombre_completo.trim().split(/\s+/);
    const baseAlias = nombre_usuario ||
      (partes.length >= 2 ? `${partes[0]} ${partes[1]}` : partes[0]);

    let alias = baseAlias;
    let aliasIntento = 1;
    while (true) {
      const { data: aliasExiste } = await supabase
        .from("usuarios")
        .select("id")
        .eq("nombre_usuario", alias)
        .maybeSingle();
      if (!aliasExiste) break;
      aliasIntento++;
      alias = `${baseAlias}${aliasIntento}`;
    }

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
      picks_completos: false,
      password_hash: "auth_managed_by_supabase"
    });

    if (dbError) {
      console.error("DB error code:", dbError.code, "| message:", dbError.message, "| detail:", dbError.details);
      await supabase.auth.admin.deleteUser(userId);
      // Devolver mensaje específico según el tipo de error
      if (dbError.code === "23505") {
        // Unique violation — detectar qué campo
        const detail = (dbError.details || dbError.message || "").toLowerCase();
        if (detail.includes("correo") || detail.includes("email")) {
          return res.status(409).json({ error: "Este correo ya está registrado. Inicia sesión o usa otro correo.", campo: "correo" });
        }
        if (detail.includes("documento")) {
          return res.status(409).json({ error: "Este documento ya está registrado. ¿Ya tienes cuenta? Inicia sesión.", campo: "documento" });
        }
        if (detail.includes("nombre_usuario") || detail.includes("alias")) {
          return res.status(409).json({ error: "Ese nombre de usuario ya existe. Intenta con otro.", campo: "alias" });
        }
        return res.status(409).json({ error: "Ya existe un registro con esos datos. Intenta iniciar sesión.", campo: "general" });
      }
      if (dbError.code === "23502") {
        // Not null violation
        const col = (dbError.details || dbError.message || "").match(/column "([^"]+)"/)?.[1] || "campo";
        return res.status(400).json({ error: `El campo "${col}" es obligatorio. Verifica el formulario.`, campo: col });
      }
      return res.status(500).json({ error: "Error al guardar los datos: " + (dbError.message || "error desconocido"), campo: "general" });
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