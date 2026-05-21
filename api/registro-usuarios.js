const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });

  try {
    const url = `${SUPABASE_URL}/rest/v1/usuarios?select=nombre_completo,nombre_usuario,created_at&activo=eq.true&order=created_at.desc&limit=500`;
    const r = await fetch(url, {
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!r.ok) return res.status(500).json({ error: "Error consultando usuarios" });

    const usuarios = await r.json();
    return res.status(200).json({ usuarios: usuarios || [], total: usuarios?.length || 0 });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
