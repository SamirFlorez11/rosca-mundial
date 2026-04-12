/**
 * /api/admin/backup.js
 *
 * GET   → Lista backups guardados en tabla backups_meta
 * POST  → Dispara backup manual (exporta tablas críticas a JSON en Supabase Storage)
 */
const { sb, requireAdmin, setCORS, ok, err } = require("./_lib");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

// Tablas críticas a respaldar
const TABLAS_BACKUP = [
  "usuarios",
  "pagos",
  "predicciones",
  "picks_killer",
  "picks_equipos",
  "fases",
  "ranking",
];

async function exportarTabla(tabla) {
  const r = await sb(tabla, {
    params: { select: "*", limit: "10000" },
  });
  return r.data || [];
}

async function subirAStorage(nombre, contenido) {
  const url = `${SUPABASE_URL}/storage/v1/object/backups/${nombre}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: contenido,
  });
  return r.ok;
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireAdmin(req)) return err(res, "No autorizado", 401);

  // ── GET: listar backups ───────────────────────────────────────────────────
  if (req.method === "GET") {
    const rBackups = await sb("backups_meta", {
      params: {
        select: "id,nombre,tablas,tamano_kb,created_at,tipo",
        order: "created_at.desc",
        limit: "20",
      },
    });
    return ok(res, { backups: rBackups.data || [] });
  }

  // ── POST: crear backup ────────────────────────────────────────────────────
  if (req.method === "POST") {
    try {
      const inicio   = Date.now();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const nombreArchivo = `backup_${timestamp}.json`;

      // Exportar todas las tablas en paralelo
      const exportaciones = await Promise.all(
        TABLAS_BACKUP.map(async t => {
          const data = await exportarTabla(t);
          return { tabla: t, registros: data.length, data };
        })
      );

      const backupData = {
        generado: new Date().toISOString(),
        tablas: Object.fromEntries(exportaciones.map(e => [e.tabla, e.data])),
      };

      const contenido = JSON.stringify(backupData, null, 2);
      const tamano_kb = Math.round(Buffer.byteLength(contenido, "utf8") / 1024);

      // Intentar subir a Supabase Storage (bucket "backups")
      const subido = await subirAStorage(nombreArchivo, contenido).catch(() => false);

      // Registrar metadata del backup
      const rMeta = await sb("backups_meta", {
        method: "POST",
        body: {
          nombre: nombreArchivo,
          tablas: TABLAS_BACKUP,
          tamano_kb,
          tipo: "manual_admin",
          storage_ok: subido,
          resumen: exportaciones.map(e => ({ tabla: e.tabla, registros: e.registros })),
        },
      });

      const duracion = ((Date.now() - inicio) / 1000).toFixed(2) + "s";

      await sb("logs", {
        method: "POST",
        body: {
          tipo: "admin",
          mensaje: `Backup manual creado: ${nombreArchivo} (${tamano_kb} KB)`,
          meta: { nombre: nombreArchivo, tamano_kb, duracion },
        },
      });

      return ok(res, {
        mensaje: "Backup creado exitosamente",
        nombre: nombreArchivo,
        tamano_kb,
        duracion,
        tablas: exportaciones.map(e => ({ tabla: e.tabla, registros: e.registros })),
        storage_ok: subido,
      }, 201);

    } catch (e) {
      console.error("[admin/backup]", e);
      return err(res, `Error creando backup: ${e.message}`, 500);
    }
  }

  return err(res, "Método no permitido", 405);
}
