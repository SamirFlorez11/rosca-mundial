import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { referencia } = req.body;

  if (!referencia) {
    return res.status(400).json({ error: "Referencia requerida" });
  }

  const secret = process.env.WOMPI_INTEGRITY_SECRET;
  const cadena = `${referencia}6000000COP${secret}`;
  
  const firma = crypto
    .createHash("sha256")
    .update(cadena)
    .digest("hex");

  return res.status(200).json({ firma });
}