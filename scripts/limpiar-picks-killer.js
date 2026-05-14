// Elimina picks de jugadores que ya no están en ninguna lista oficial
// Ejecutar: node scripts/limpiar-picks-killer.js

// Requiere variables de entorno del .env.local (cárgalas antes de ejecutar)
// set SUPABASE_URL=... && set SUPABASE_SERVICE_KEY=... && node scripts/limpiar-picks-killer.js
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Faltan variables de entorno SUPABASE_URL y SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const IDS_INVALIDOS = new Set([
  // Francia — eliminados de la lista oficial
  "fra-3","fra-9","fra-10","fra-11","fra-13","fra-16","fra-19","fra-28",
  // Nueva Zelanda — eliminados de la lista oficial
  "nzl-2","nzl-5","nzl-6","nzl-9","nzl-10","nzl-12",
  "nzl-16","nzl-18","nzl-19","nzl-23","nzl-24",
]);

async function api(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

async function main() {
  console.log("Obteniendo usuarios con picks_data...");
  const usuarios = await api(
    "/usuarios?select=id,correo,picks_data&picks_data=not.is.null"
  );

  console.log(`Total usuarios con picks_data: ${usuarios.length}`);

  let modificados = 0;
  let picksEliminados = 0;

  for (const u of usuarios) {
    const killer = u.picks_data?.killer;
    if (!Array.isArray(killer) || killer.length === 0) continue;

    const original = killer.length;
    const limpio = killer.filter((id) => !IDS_INVALIDOS.has(id));

    if (limpio.length === original) continue; // nada que cambiar

    const eliminados = killer.filter((id) => IDS_INVALIDOS.has(id));
    console.log(
      `  Usuario ${u.correo ?? u.id}: eliminando [${eliminados.join(", ")}]`
    );

    await api(`/usuarios?id=eq.${u.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        picks_data: { ...u.picks_data, killer: limpio },
      }),
    });

    modificados++;
    picksEliminados += eliminados.length;
  }

  console.log(
    `\nListo. Usuarios modificados: ${modificados}. Picks eliminados: ${picksEliminados}.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
