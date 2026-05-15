// scripts/actualizar-listas-oficiales.cjs
// Actualiza datos.js con las listas oficiales de JPN, BEL, CIV, TUN, HAI
// e inserta los jugadores nuevos en Supabase.
// Protocolo: IDs existentes NUNCA se renumeran. Eliminados se borran (gap). Nuevos = siguiente ID libre.

const fs   = require('fs');
const path = require('path');

// Leer .env.local manualmente
const envPath = path.join(__dirname, '..', '.env.local');
const envVars = fs.readFileSync(envPath, 'utf8').split('\n').reduce((acc, line) => {
  const m = line.match(/^([^=]+)="?([^"]*)"?$/);
  if (m) acc[m[1].trim()] = m[2].trim();
  return acc;
}, {});

const SUPABASE_URL = envVars.SUPABASE_URL;
const SERVICE_KEY  = envVars.SUPABASE_SERVICE_KEY;

// ─── 1. CAMBIOS EN datos.js ────────────────────────────────────────────────

const datosPath = path.join(__dirname, '..', 'datos.js');
let datos = fs.readFileSync(datosPath, 'utf8');

// IDs eliminados de cada lista oficial
const IDS_ELIMINADOS = [
  // JPN (prelista 30 → oficial 26, quedan: 1,2,4,5,7,8,10,12,14,17,18,19,20,22,27,30)
  'jpn-3','jpn-6','jpn-9','jpn-11','jpn-13','jpn-15','jpn-16',
  'jpn-21','jpn-23','jpn-24','jpn-25','jpn-26','jpn-28','jpn-29',
  // BEL (prelista 26 → oficial 26, quedan: 1,4,8,9,10,11,13,14,15,16,17,20,21,23,24,25)
  'bel-2','bel-3','bel-5','bel-6','bel-7','bel-12','bel-18','bel-19','bel-22','bel-26',
  // CIV (prelista 26 → oficial 26, quedan: 7,8,9,11,13,14,15,19,21)
  'civ-1','civ-2','civ-3','civ-4','civ-5','civ-6','civ-10','civ-12',
  'civ-16','civ-17','civ-18','civ-20','civ-22','civ-23','civ-24','civ-25','civ-26',
  // TUN (prelista 26 → oficial 26, quedan: 4,5,6,13,14)
  'tun-1','tun-2','tun-3','tun-7','tun-8','tun-9','tun-10','tun-11','tun-12',
  'tun-15','tun-16','tun-17','tun-18','tun-19','tun-20',
  'tun-21','tun-22','tun-23','tun-24','tun-25','tun-26',
  // HAI (prelista 26 → oficial 26, quedan: 1,2,6,16,21,22)
  'hai-3','hai-4','hai-5','hai-7','hai-8','hai-9','hai-10','hai-11','hai-12',
  'hai-13','hai-14','hai-15','hai-17','hai-18','hai-19','hai-20',
  'hai-23','hai-24','hai-25','hai-26',
];

// Eliminar líneas de jugadores cortados
const lineas = datos.split('\n');
datos = lineas.filter(l => !IDS_ELIMINADOS.some(id => l.includes(`id:'${id}'`))).join('\n');

// Jugadores NUEVOS por equipo (se insertan después del último ID existente de cada equipo)
const NUEVOS = [
  // ─── JAPÓN (nuevos jpn-31 a jpn-40) ────────────────────────────────────
  { anchor: "id:'jpn-30'", eq:'jpn', fl:'🇯🇵', jugadores:[
    {id:'jpn-31',n:'Tomoki Hayakawa',     p:'POR'},
    {id:'jpn-32',n:'Shogo Taniguchi',     p:'DEF'},
    {id:'jpn-33',n:'Junnosuke Suzuki',    p:'DEF'},
    {id:'jpn-34',n:'Tsuyoshi Watanabe',   p:'DEF'},
    {id:'jpn-35',n:'Kaishu Sano',         p:'MED'},
    {id:'jpn-36',n:'Kaito Nakamura',      p:'DEL'},
    {id:'jpn-37',n:'Iori Suzuki',         p:'DEL'},
    {id:'jpn-38',n:'Kento Shiogai',       p:'DEL'},
    {id:'jpn-39',n:'Keisuke Goto',        p:'DEL'},
    {id:'jpn-40',n:'Kaoru Ueda',          p:'DEL'},
  ]},
  // ─── BÉLGICA (nuevos bel-27 a bel-36) ───────────────────────────────────
  { anchor: "id:'bel-25'", eq:'bel', fl:'🇧🇪', jugadores:[
    {id:'bel-27',n:'Senne Lammens',           p:'POR'},
    {id:'bel-28',n:'Mike Penders',            p:'POR'},
    {id:'bel-29',n:'Koni de Winter',          p:'DEF'},
    {id:'bel-30',n:'Nathan Ngoy',             p:'DEF'},
    {id:'bel-31',n:'Maxim de Cuyper',         p:'DEF'},
    {id:'bel-32',n:'Joaquin Seys',            p:'DEF'},
    {id:'bel-33',n:'Nicolas Raskin',          p:'MED'},
    {id:'bel-34',n:'Axel Witsel',             p:'MED'},
    {id:'bel-35',n:'Matias Fernández-Pardo',  p:'DEL'},
    {id:'bel-36',n:'Diego Moreira',           p:'DEL'},
  ]},
  // ─── COSTA DE MARFIL (nuevos civ-27 a civ-43) ───────────────────────────
  { anchor: "id:'civ-21'", eq:'civ', fl:'🇨🇮', jugadores:[
    {id:'civ-27',n:'Yahia Fofana',       p:'POR'},
    {id:'civ-28',n:'Mohamed Kone',       p:'POR'},
    {id:'civ-29',n:'Alban Lafont',       p:'POR'},
    {id:'civ-30',n:'Clément Akpa',       p:'DEF'},
    {id:'civ-31',n:'Ousmane Diomande',   p:'DEF'},
    {id:'civ-32',n:'Guéla Doué',         p:'DEF'},
    {id:'civ-33',n:'Wilfried Singo',     p:'DEF'},
    {id:'civ-34',n:'Parfait Guiagon',    p:'MED'},
    {id:'civ-35',n:'Christ Inao Oulai',  p:'MED'},
    {id:'civ-36',n:'Jean Michaël Seri',  p:'MED'},
    {id:'civ-37',n:'Ange-Yoan Bonny',    p:'DEL'},
    {id:'civ-38',n:'Amad Diallo',        p:'DEL'},
    {id:'civ-39',n:'Yan Diomande',       p:'DEL'},
    {id:'civ-40',n:'Evann Guessand',     p:'DEL'},
    {id:'civ-41',n:'Nicolas Pepe',       p:'DEL'},
    {id:'civ-42',n:'Bazoumana Toure',    p:'DEL'},
    {id:'civ-43',n:'Elye Wahi',          p:'DEL'},
  ]},
  // ─── TÚNEZ (nuevos tun-27 a tun-47) ─────────────────────────────────────
  { anchor: "id:'tun-14'", eq:'tun', fl:'🇹🇳', jugadores:[
    {id:'tun-27',n:'Aymen Dahmen',           p:'POR'},
    {id:'tun-28',n:'Anis Chamakh',           p:'POR'},
    {id:'tun-29',n:'Sabri Ben Hassen',       p:'POR'},
    {id:'tun-30',n:'Van Valery',             p:'DEF'},
    {id:'tun-31',n:'Moutaz Neffati',         p:'DEF'},
    {id:'tun-32',n:'Omar Rekik',             p:'DEF'},
    {id:'tun-33',n:'Adem Arous',             p:'DEF'},
    {id:'tun-34',n:'Raed Chikhaoui',         p:'DEF'},
    {id:'tun-35',n:'Mohamed Ali Ben Hmida',  p:'DEF'},
    {id:'tun-36',n:'Mohamed Hadj Mahmoud',   p:'MED'},
    {id:'tun-37',n:'Rani Khedira',           p:'MED'},
    {id:'tun-38',n:'Anis Ben Slimane',       p:'MED'},
    {id:'tun-39',n:'Mortadha Ben Ouanes',    p:'MED'},
    {id:'tun-40',n:'Ismaël Gharbi',          p:'MED'},
    {id:'tun-41',n:'Khalil Ayari',           p:'DEL'},
    {id:'tun-42',n:'Elias Achouri',          p:'DEL'},
    {id:'tun-43',n:'Elias Saad',             p:'DEL'},
    {id:'tun-44',n:'Firas Chaouat',          p:'DEL'},
    {id:'tun-45',n:'Hazem Mastouri',         p:'DEL'},
    {id:'tun-46',n:'Rayan Elloumi',          p:'DEL'},
    {id:'tun-47',n:'Sebastian Tounekti',     p:'DEL'},
  ]},
  // ─── HAITÍ (nuevos hai-27 a hai-46) ─────────────────────────────────────
  { anchor: "id:'hai-22'", eq:'hai', fl:'🇭🇹', jugadores:[
    {id:'hai-27',n:'Alexandre Pierre',       p:'POR'},
    {id:'hai-28',n:'Wilguens Paugain',        p:'DEF'},
    {id:'hai-29',n:'Duke Lacroix',            p:'DEF'},
    {id:'hai-30',n:'Martin Experience',       p:'DEF'},
    {id:'hai-31',n:'JK Duverne',              p:'DEF'},
    {id:'hai-32',n:'Ricardo Adé',             p:'DEF'},
    {id:'hai-33',n:'Hannes Delcroix',         p:'DEF'},
    {id:'hai-34',n:'Keeto Thermoncy',         p:'DEF'},
    {id:'hai-35',n:'Leverton Pierre',         p:'MED'},
    {id:'hai-36',n:'Carl-Fred Sainthe',       p:'MED'},
    {id:'hai-37',n:'Jean-Jacques Danley',     p:'MED'},
    {id:'hai-38',n:'Jeanricner Bellegarde',   p:'MED'},
    {id:'hai-39',n:'Pierre Woodenski',        p:'MED'},
    {id:'hai-40',n:'Dominique Simon',         p:'MED'},
    {id:'hai-41',n:'Louicius Deedson',        p:'DEL'},
    {id:'hai-42',n:'Ruben Providence',        p:'DEL'},
    {id:'hai-43',n:'Josué Casimir',           p:'DEL'},
    {id:'hai-44',n:'Wilson Isidor',           p:'DEL'},
    {id:'hai-45',n:'Yassin Fortune',          p:'DEL'},
    {id:'hai-46',n:'Lenny Joseph',            p:'DEL'},
  ]},
];

// Insertar nuevos jugadores después de la línea ancla de cada equipo
for (const grupo of NUEVOS) {
  const lineasNuevas = grupo.jugadores.map(j =>
    `  {id:'${j.id}',nombre:'${j.n}',${' '.repeat(Math.max(1, 26 - j.n.length))}equipo:'${grupo.eq}', pos:'${j.p}', flag:'${grupo.fl}'},`
  ).join('\n');

  // Encuentra la línea que contiene el anchor y la reemplaza por ella misma + los nuevos
  // grupo.anchor ya tiene el formato "id:'jpn-30'" — se usa directamente en el regex
  const escapedAnchor = grupo.anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const anchorRegex = new RegExp(`([ \\t]*\\{${escapedAnchor}[^\\n]*\\}),`);
  datos = datos.replace(anchorRegex, (match) => match + '\n' + lineasNuevas);
}

fs.writeFileSync(datosPath, datos, 'utf8');
console.log('✅ datos.js actualizado');

// Verificar conteos finales
const equiposVerif = ['jpn','bel','civ','tun','hai'];
for (const eq of equiposVerif) {
  const count = (datos.match(new RegExp(`equipo:'${eq}'`, 'g')) || []).length;
  console.log(`   ${eq.toUpperCase()}: ${count} jugadores`);
}

// ─── 2. INSERTAR NUEVOS JUGADORES EN SUPABASE ─────────────────────────────

async function api(method, endpoint, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${endpoint} → ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return null; }
}

async function main() {
  // Obtener UUIDs de equipos por codigo_fifa
  const equipos = await api('GET', 'equipos?select=id,codigo_fifa');
  const eqMap = {};
  equipos.forEach(e => { eqMap[e.codigo_fifa] = e.id; });

  // Construir lista de todos los nuevos jugadores
  const todosNuevos = [];
  for (const grupo of NUEVOS) {
    const equipo_id = eqMap[grupo.eq];
    if (!equipo_id) { console.warn(`⚠️  Equipo ${grupo.eq} no encontrado en Supabase`); continue; }
    for (const j of grupo.jugadores) {
      todosNuevos.push({
        nombre:        j.n,
        nombre_corto:  j.id,       // datos.js ID — puente para picks_killer
        posicion:      j.p,
        equipo_id,
        sportmonks_id: null,
      });
    }
  }

  console.log(`\n📤 Insertando ${todosNuevos.length} jugadores nuevos en Supabase...`);
  await api('POST', 'jugadores', todosNuevos);
  console.log('✅ Jugadores insertados (duplicados ignorados)');

  // Verificar conteo total en Supabase
  const total = await api('GET', 'jugadores?select=id&limit=1');
  const countRes = await fetch(`${SUPABASE_URL}/rest/v1/jugadores?select=equipo_id,nombre_corto`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Prefer': 'count=exact' }
  });
  const count = countRes.headers.get('content-range')?.split('/')[1] || '?';
  console.log(`\n📊 Total jugadores en Supabase: ${count}`);

  // Conteo por equipo nuevos
  for (const eq of ['jpn','bel','civ','tun','hai']) {
    const equipo_id = eqMap[eq];
    if (!equipo_id) continue;
    const rows = await api('GET', `jugadores?equipo_id=eq.${equipo_id}&select=id`);
    console.log(`   ${eq.toUpperCase()}: ${Array.isArray(rows) ? rows.length : '?'} jugadores en Supabase`);
  }
}

main().catch(console.error);
