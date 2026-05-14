// Carga inicial de equipos y jugadores en Supabase
// Solo inserta los que no existen (idempotente por codigo_fifa / nombre+equipo_id)
// Ejecutar: node scripts/cargar-equipos-jugadores.js

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_KEY");
  process.exit(1);
}

async function api(path, method = "GET", body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

// ── EQUIPOS (48 selecciones, datos de datos.js) ─────────────────────────────
const EQUIPOS_RAW = [
  // GRUPO A
  {codigo:"mex",nombre:"México",grupo:"A"},
  {codigo:"rsa",nombre:"Sudáfrica",grupo:"A"},
  {codigo:"kor",nombre:"Corea del Sur",grupo:"A"},
  {codigo:"cze",nombre:"Rep. Checa",grupo:"A"},
  // GRUPO B
  {codigo:"can",nombre:"Canadá",grupo:"B"},
  {codigo:"bih",nombre:"Bosnia-Herz.",grupo:"B"},
  {codigo:"qat",nombre:"Catar",grupo:"B"},
  {codigo:"sui",nombre:"Suiza",grupo:"B"},
  // GRUPO C
  {codigo:"bra",nombre:"Brasil",grupo:"C"},
  {codigo:"mar",nombre:"Marruecos",grupo:"C"},
  {codigo:"hai",nombre:"Haití",grupo:"C"},
  {codigo:"sco",nombre:"Escocia",grupo:"C"},
  // GRUPO D
  {codigo:"usa",nombre:"Estados Unidos",grupo:"D"},
  {codigo:"par",nombre:"Paraguay",grupo:"D"},
  {codigo:"aus",nombre:"Australia",grupo:"D"},
  {codigo:"tur",nombre:"Turquía",grupo:"D"},
  // GRUPO E
  {codigo:"ger",nombre:"Alemania",grupo:"E"},
  {codigo:"cur",nombre:"Curazao",grupo:"E"},
  {codigo:"civ",nombre:"Costa de Marfil",grupo:"E"},
  {codigo:"ecu",nombre:"Ecuador",grupo:"E"},
  // GRUPO F
  {codigo:"ned",nombre:"Países Bajos",grupo:"F"},
  {codigo:"jpn",nombre:"Japón",grupo:"F"},
  {codigo:"swe",nombre:"Suecia",grupo:"F"},
  {codigo:"tun",nombre:"Túnez",grupo:"F"},
  // GRUPO G
  {codigo:"bel",nombre:"Bélgica",grupo:"G"},
  {codigo:"egy",nombre:"Egipto",grupo:"G"},
  {codigo:"irn",nombre:"Irán",grupo:"G"},
  {codigo:"nzl",nombre:"Nueva Zelanda",grupo:"G"},
  // GRUPO H
  {codigo:"esp",nombre:"España",grupo:"H"},
  {codigo:"cpv",nombre:"Cabo Verde",grupo:"H"},
  {codigo:"ksa",nombre:"Arabia Saudita",grupo:"H"},
  {codigo:"uru",nombre:"Uruguay",grupo:"H"},
  // GRUPO I
  {codigo:"fra",nombre:"Francia",grupo:"I"},
  {codigo:"sen",nombre:"Senegal",grupo:"I"},
  {codigo:"irq",nombre:"Irak",grupo:"I"},
  {codigo:"nor",nombre:"Noruega",grupo:"I"},
  // GRUPO J
  {codigo:"arg",nombre:"Argentina",grupo:"J"},
  {codigo:"alg",nombre:"Argelia",grupo:"J"},
  {codigo:"aut",nombre:"Austria",grupo:"J"},
  {codigo:"jor",nombre:"Jordania",grupo:"J"},
  // GRUPO K
  {codigo:"por",nombre:"Portugal",grupo:"K"},
  {codigo:"cod",nombre:"RD Congo",grupo:"K"},
  {codigo:"uzb",nombre:"Uzbekistán",grupo:"K"},
  {codigo:"col",nombre:"Colombia",grupo:"K"},
  // GRUPO L
  {codigo:"eng",nombre:"Inglaterra",grupo:"L"},
  {codigo:"cro",nombre:"Croacia",grupo:"L"},
  {codigo:"gha",nombre:"Ghana",grupo:"L"},
  {codigo:"pan",nombre:"Panamá",grupo:"L"},
];

// ── JUGADORES CON LISTA OFICIAL ──────────────────────────────────────────────
// Formato: {datos_id, nombre, posicion, codigo_equipo}
const JUGADORES_OFICIALES = [
  // FRANCIA (26j — lista oficial)
  {datos_id:"fra-1",  nombre:"Mike Maignan",         pos:"POR", eq:"fra"},
  {datos_id:"fra-2",  nombre:"Brice Samba",           pos:"POR", eq:"fra"},
  {datos_id:"fra-30", nombre:"Robin Risser",          pos:"POR", eq:"fra"},
  {datos_id:"fra-4",  nombre:"Jules Koundé",          pos:"DEF", eq:"fra"},
  {datos_id:"fra-5",  nombre:"William Saliba",        pos:"DEF", eq:"fra"},
  {datos_id:"fra-6",  nombre:"Dayot Upamecano",       pos:"DEF", eq:"fra"},
  {datos_id:"fra-7",  nombre:"Ibrahima Konaté",       pos:"DEF", eq:"fra"},
  {datos_id:"fra-8",  nombre:"Theo Hernández",        pos:"DEF", eq:"fra"},
  {datos_id:"fra-12", nombre:"Malo Gusto",            pos:"DEF", eq:"fra"},
  {datos_id:"fra-14", nombre:"Maxence Lacroix",       pos:"DEF", eq:"fra"},
  {datos_id:"fra-31", nombre:"Lucas Digne",           pos:"DEF", eq:"fra"},
  {datos_id:"fra-32", nombre:"Lucas Hernández",       pos:"DEF", eq:"fra"},
  {datos_id:"fra-15", nombre:"Aurélien Tchouaméni",   pos:"MED", eq:"fra"},
  {datos_id:"fra-17", nombre:"Adrien Rabiot",         pos:"MED", eq:"fra"},
  {datos_id:"fra-18", nombre:"Warren Zaïre-Emery",    pos:"MED", eq:"fra"},
  {datos_id:"fra-20", nombre:"N'Golo Kanté",          pos:"MED", eq:"fra"},
  {datos_id:"fra-21", nombre:"Manu Koné",             pos:"MED", eq:"fra"},
  {datos_id:"fra-22", nombre:"Rayan Cherki",          pos:"DEL", eq:"fra"},
  {datos_id:"fra-23", nombre:"Kylian Mbappé",         pos:"DEL", eq:"fra"},
  {datos_id:"fra-24", nombre:"Ousmane Dembélé",       pos:"DEL", eq:"fra"},
  {datos_id:"fra-25", nombre:"Marcus Thuram",         pos:"DEL", eq:"fra"},
  {datos_id:"fra-26", nombre:"Bradley Barcola",       pos:"DEL", eq:"fra"},
  {datos_id:"fra-27", nombre:"Désiré Doué",           pos:"DEL", eq:"fra"},
  {datos_id:"fra-29", nombre:"Michael Olise",         pos:"DEL", eq:"fra"},
  {datos_id:"fra-33", nombre:"Maghnes Akliouche",     pos:"DEL", eq:"fra"},
  {datos_id:"fra-34", nombre:"Jean-Philippe Mateta",  pos:"DEL", eq:"fra"},
  // NUEVA ZELANDA (26j — lista oficial)
  {datos_id:"nzl-3",  nombre:"Michael Woud",          pos:"POR", eq:"nzl"},
  {datos_id:"nzl-27", nombre:"Max Crocombe",          pos:"POR", eq:"nzl"},
  {datos_id:"nzl-28", nombre:"Alex Paulsen",          pos:"POR", eq:"nzl"},
  {datos_id:"nzl-1",  nombre:"Tim Payne",             pos:"DEF", eq:"nzl"},
  {datos_id:"nzl-4",  nombre:"Liberato Cacace",       pos:"DEF", eq:"nzl"},
  {datos_id:"nzl-7",  nombre:"Nando Pijnaker",        pos:"DEF", eq:"nzl"},
  {datos_id:"nzl-8",  nombre:"Michael Boxall",        pos:"DEF", eq:"nzl"},
  {datos_id:"nzl-11", nombre:"Finn Surman",           pos:"DEF", eq:"nzl"},
  {datos_id:"nzl-22", nombre:"Callan Elliot",         pos:"DEF", eq:"nzl"},
  {datos_id:"nzl-29", nombre:"Tyler Bindon",          pos:"DEF", eq:"nzl"},
  {datos_id:"nzl-30", nombre:"Francis De Vries",      pos:"DEF", eq:"nzl"},
  {datos_id:"nzl-31", nombre:"Tommy Smith",           pos:"DEF", eq:"nzl"},
  {datos_id:"nzl-15", nombre:"Joe Bell",              pos:"MED", eq:"nzl"},
  {datos_id:"nzl-26", nombre:"Marko Stamenić",        pos:"MED", eq:"nzl"},
  {datos_id:"nzl-32", nombre:"Lachlan Bayliss",       pos:"MED", eq:"nzl"},
  {datos_id:"nzl-33", nombre:"Alex Rufer",            pos:"MED", eq:"nzl"},
  {datos_id:"nzl-34", nombre:"Ryan Thomas",           pos:"MED", eq:"nzl"},
  {datos_id:"nzl-13", nombre:"Matt Garbett",          pos:"DEL", eq:"nzl"},
  {datos_id:"nzl-14", nombre:"Eli Just",              pos:"DEL", eq:"nzl"},
  {datos_id:"nzl-17", nombre:"Sarpreet Singh",        pos:"DEL", eq:"nzl"},
  {datos_id:"nzl-20", nombre:"Callum McCowatt",       pos:"DEL", eq:"nzl"},
  {datos_id:"nzl-21", nombre:"Chris Wood",            pos:"DEL", eq:"nzl"},
  {datos_id:"nzl-25", nombre:"Ben Old",               pos:"DEL", eq:"nzl"},
  {datos_id:"nzl-35", nombre:"Kosta Barbarouses",     pos:"DEL", eq:"nzl"},
  {datos_id:"nzl-36", nombre:"Jesse Randall",         pos:"DEL", eq:"nzl"},
  {datos_id:"nzl-37", nombre:"Ben Waine",             pos:"DEL", eq:"nzl"},
  // SUECIA (29j — prelista, aún sin recorte oficial a 26)
  {datos_id:"swe-1",  nombre:"Robin Olsen",           pos:"POR", eq:"swe"},
  {datos_id:"swe-2",  nombre:"Viktor Johansson",      pos:"POR", eq:"swe"},
  {datos_id:"swe-3",  nombre:"Kristoffer Nordfeldt",  pos:"POR", eq:"swe"},
  {datos_id:"swe-4",  nombre:"Victor Lindelöf",       pos:"DEF", eq:"swe"},
  {datos_id:"swe-5",  nombre:"Isak Hien",             pos:"DEF", eq:"swe"},
  {datos_id:"swe-6",  nombre:"Hjalmar Ekdal",         pos:"DEF", eq:"swe"},
  {datos_id:"swe-7",  nombre:"Gustaf Nilsson",        pos:"DEF", eq:"swe"},
  {datos_id:"swe-8",  nombre:"Emil Holm",             pos:"DEF", eq:"swe"},
  {datos_id:"swe-9",  nombre:"Ludwig Augustinsson",   pos:"DEF", eq:"swe"},
  {datos_id:"swe-10", nombre:"Gabriel Gudmundsson",   pos:"DEF", eq:"swe"},
  {datos_id:"swe-11", nombre:"Linus Wahlqvist",       pos:"DEF", eq:"swe"},
  {datos_id:"swe-12", nombre:"Eric Smith",            pos:"DEF", eq:"swe"},
  {datos_id:"swe-13", nombre:"Carl Starfelt",         pos:"DEF", eq:"swe"},
  {datos_id:"swe-14", nombre:"Dejan Kulusevski",      pos:"MED", eq:"swe"},
  {datos_id:"swe-15", nombre:"Emil Forsberg",         pos:"MED", eq:"swe"},
  {datos_id:"swe-16", nombre:"Hugo Larsson",          pos:"MED", eq:"swe"},
  {datos_id:"swe-17", nombre:"Jesper Karlström",      pos:"MED", eq:"swe"},
  {datos_id:"swe-18", nombre:"Samuel Gustafson",      pos:"MED", eq:"swe"},
  {datos_id:"swe-19", nombre:"Mattias Svanberg",      pos:"MED", eq:"swe"},
  {datos_id:"swe-20", nombre:"Yasin Ayari",           pos:"MED", eq:"swe"},
  {datos_id:"swe-21", nombre:"Lucas Bergvall",        pos:"MED", eq:"swe"},
  {datos_id:"swe-22", nombre:"Niclas Eliasson",       pos:"MED", eq:"swe"},
  {datos_id:"swe-23", nombre:"Anthony Elanga",        pos:"MED", eq:"swe"},
  {datos_id:"swe-24", nombre:"Alexander Isak",        pos:"DEL", eq:"swe"},
  {datos_id:"swe-25", nombre:"Viktor Gyökeres",       pos:"DEL", eq:"swe"},
  {datos_id:"swe-26", nombre:"Benjamin Nygren",       pos:"DEL", eq:"swe"},
  {datos_id:"swe-27", nombre:"Robin Quaison",         pos:"DEL", eq:"swe"},
  {datos_id:"swe-28", nombre:"Jordan Larsson",        pos:"DEL", eq:"swe"},
  {datos_id:"swe-29", nombre:"Sebastian Nanasi",      pos:"DEL", eq:"swe"},
  // BOSNIA-HERZEGOVINA (26j — lista oficial)
  {datos_id:"bih-1",  nombre:"Ibrahim Šehić",         pos:"POR", eq:"bih"},
  {datos_id:"bih-2",  nombre:"Nikola Vasilj",         pos:"POR", eq:"bih"},
  {datos_id:"bih-3",  nombre:"Osman Hadžikić",        pos:"POR", eq:"bih"},
  {datos_id:"bih-4",  nombre:"Sead Kolašinac",        pos:"DEF", eq:"bih"},
  {datos_id:"bih-5",  nombre:"Anel Ahmedhodžić",      pos:"DEF", eq:"bih"},
  {datos_id:"bih-6",  nombre:"Jusuf Gazibegović",     pos:"DEF", eq:"bih"},
  {datos_id:"bih-7",  nombre:"Amar Dedić",            pos:"DEF", eq:"bih"},
  {datos_id:"bih-8",  nombre:"Dennis Hadžikadunić",   pos:"DEF", eq:"bih"},
  {datos_id:"bih-9",  nombre:"Adrian Leon Barišić",   pos:"DEF", eq:"bih"},
  {datos_id:"bih-10", nombre:"Eldar Ćivić",           pos:"DEF", eq:"bih"},
  {datos_id:"bih-11", nombre:"Tarik Muharemović",     pos:"DEF", eq:"bih"},
  {datos_id:"bih-12", nombre:"Nihad Mujakić",         pos:"DEF", eq:"bih"},
  {datos_id:"bih-13", nombre:"Benjamin Tahirović",    pos:"MED", eq:"bih"},
  {datos_id:"bih-14", nombre:"Amar Memić",            pos:"MED", eq:"bih"},
  {datos_id:"bih-15", nombre:"Ivan Bašić",            pos:"MED", eq:"bih"},
  {datos_id:"bih-16", nombre:"Haris Hajradinović",    pos:"MED", eq:"bih"},
  {datos_id:"bih-17", nombre:"Dario Šarić",           pos:"MED", eq:"bih"},
  {datos_id:"bih-18", nombre:"Rade Krunić",           pos:"MED", eq:"bih"},
  {datos_id:"bih-19", nombre:"Miralem Pjanić",        pos:"MED", eq:"bih"},
  {datos_id:"bih-20", nombre:"Amar Rahmanović",       pos:"MED", eq:"bih"},
  {datos_id:"bih-21", nombre:"Dal Varešanović",       pos:"MED", eq:"bih"},
  {datos_id:"bih-22", nombre:"Ermedin Demirović",     pos:"DEL", eq:"bih"},
  {datos_id:"bih-23", nombre:"Edin Džeko",            pos:"DEL", eq:"bih"},
  {datos_id:"bih-24", nombre:"Luka Menalo",           pos:"DEL", eq:"bih"},
  {datos_id:"bih-25", nombre:"Smail Prevljak",        pos:"DEL", eq:"bih"},
  {datos_id:"bih-26", nombre:"Nail Omerović",         pos:"DEL", eq:"bih"},
];

async function main() {
  // ── 1. Insertar equipos ───────────────────────────────────────────────────
  console.log("Insertando 48 equipos...");
  const equiposPayload = EQUIPOS_RAW.map(e => ({
    nombre: e.nombre,
    nombre_corto: e.codigo.toUpperCase(),
    codigo_fifa: e.codigo,
    grupo: e.grupo,
    activo: true,
  }));

  // Upsert por codigo_fifa para que sea idempotente
  const equiposRes = await api("/equipos?on_conflict=codigo_fifa", "POST", equiposPayload);
  if (!Array.isArray(equiposRes)) {
    console.error("Error insertando equipos:", equiposRes);
    process.exit(1);
  }
  console.log(`  ${equiposRes.length} equipos insertados/actualizados.`);

  // ── 2. Obtener mapa codigo → UUID ─────────────────────────────────────────
  const equiposDB = await api("/equipos?select=id,codigo_fifa");
  const eqMap = {};
  equiposDB.forEach(e => eqMap[e.codigo_fifa] = e.id);
  console.log(`  Mapa de equipos: ${Object.keys(eqMap).length} entradas.`);

  // ── 3. Insertar jugadores ─────────────────────────────────────────────────
  console.log(`\nInsertando ${JUGADORES_OFICIALES.length} jugadores...`);
  const jugPayload = JUGADORES_OFICIALES.map(j => ({
    nombre: j.nombre,
    nombre_corto: j.datos_id,  // guardamos el ID de datos.js aquí para la migración de picks_killer
    posicion: j.pos,
    equipo_id: eqMap[j.eq],
    activo: true,
  }));

  const faltantes = jugPayload.filter(j => !j.equipo_id);
  if (faltantes.length) {
    console.error("Equipos no encontrados:", faltantes.map(j=>j.nombre));
    process.exit(1);
  }

  // Upsert por nombre+equipo_id
  const jugRes = await api("/jugadores?on_conflict=nombre,equipo_id", "POST", jugPayload);
  if (!Array.isArray(jugRes)) {
    console.error("Error insertando jugadores:", jugRes);
    process.exit(1);
  }
  console.log(`  ${jugRes.length} jugadores insertados/actualizados.`);

  // Resumen por equipo
  const porEquipo = {};
  jugRes.forEach(j => {
    const eq = Object.keys(eqMap).find(k => eqMap[k] === j.equipo_id) || j.equipo_id;
    porEquipo[eq] = (porEquipo[eq] || 0) + 1;
  });
  Object.entries(porEquipo).forEach(([eq,n]) => console.log(`    ${eq}: ${n} jugadores`));

  console.log("\n✅ Carga completa.");
}

main().catch(e => { console.error(e); process.exit(1); });
