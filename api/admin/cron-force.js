/**
 * /api/admin/cron-force.js
 *
 * POST body: { tipo }  → "partidos" | "goles" | "jugadores" | "todo"
 *      Fuerza la ejecución del cron de actualización de datos de Sportmonks.
 *      Internamente llama al propio endpoint /api/cron-actualizar-datos.js
 *      pasando el CRON_SECRET para autenticarse.
 */
const { sb, requireAdmin, setCORS, ok, err } = require("./_lib");

const CRON_SECRET  = process.env.CRON_SECRET;
const BASE_URL     = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "https://roscamundial.com";

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireAdmin(req)) return err(res, "No autorizado", 401);
  if (req.method !== "POST") return err(res, "Método no permitido", 405);

  const { tipo = "todo" } = req.body || {};
  const tipos_validos = ["partidos", "goles", "jugadores", "todo"];
  if (!tipos_validos.includes(tipo)) return err(res, "Tipo inválido");

  try {
    const inicio = Date.now();

    // Llamar al cron existente
    const cronRes = await fetch(`${BASE_URL}/api/cron-actualizar-datos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CRON_SECRET}`,
      },
      body: JSON.stringify({ tipo, forzado: true }),
    });

    const cronData = await cronRes.json().catch(() => ({}));
    const duracion = ((Date.now() - inicio) / 1000).toFixed(2) + "s";

    // Registrar en logs
    await sb("logs", {
      method: "POST",
      body: {
        tipo: "cron",
        mensaje: `Sync manual forzado por admin: ${tipo}`,
        meta: { tipo, duracion, exito: cronRes.ok, respuesta: cronData },
      },
    });

    if (!cronRes.ok) {
      return err(res, `Cron respondió con error ${cronRes.status}: ${JSON.stringify(cronData)}`);
    }

    return ok(res, {
      mensaje: `Sincronización "${tipo}" completada`,
      duracion,
      detalles: cronData,
    });

  } catch (e) {
    console.error("[admin/cron-force]", e);
    return err(res, `Error ejecutando sync: ${e.message}`, 500);
  }
}
