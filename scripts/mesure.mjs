/* Client de la mesure d'audience LinkedIn (flux G bis).

   Ce que ça règle : LinkedIn ne rend SES statistiques à personne (mesuré le 28/10 :
   memberAnalytics répond 404, socialActions 403, l'accès Partner est refusé). Ce qui se compte,
   c'est le clic sur un lien qu'on possède. La route /go/{slug} du Worker POSTCRAFT lit la
   destination, écrit un clic et redirige : le clic du post LinkedIn arrive donc chez nous avant
   de partir sur GitHub.

   Ce fichier ne parle qu'au Worker (HTTP). Les écritures dans Notion se font dans
   notion-to-postcraft.mjs, qui possède déjà le jeton et la plomberie.

   Usage seul, pour voir les chiffres sans rien écrire :
     node scripts/mesure.mjs --etat
     node scripts/mesure.mjs --etat --slug meshway
   Dans l'automatisation, --armer appelle enregistre() puis pose « Lien mesuré » sur la fiche.

   Variables :
     MESURE_URL     origine du Worker (défaut : POSTCRAFT_URL, puis l'origine workers.dev en
                    production — 127.0.0.1 ne mesure rien puisqu'aucun clic ne peut l'atteindre)
     POSTCRAFT_KEY  clé Bearer de l'API (défaut : .dev.vars du studio, pour un test local)
     JAMAIS de clé dans le dépôt : le dépôt est public.
*/
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCTION = "https://postcraft-linkedin-studio.afatra.workers.dev";

/* En mesure, l'origine de rendu (127.0.0.1 en local) n'est pas l'origine publique : un lien
   /go ne peut être cliqué que s'il est joignable depuis le fil LinkedIn. */
export const ORIGINE_MESURE = process.env.MESURE_URL || (process.env.POSTCRAFT_URL || PRODUCTION);

function cleDepaire(nom) {
  for (const chemin of [join(RACINE, ".dev.vars"), join(RACINE, "..", "linkedin-visual-studio", ".dev.vars")]) {
    if (!existsSync(chemin)) continue;
    const ligne = readFileSync(chemin, "utf8").split(/\r?\n/).find((l) => l.startsWith(`${nom}=`));
    if (!ligne) continue;
    return ligne.slice(nom.length + 1).trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return "";
}

export const cleMesure = () => process.env.POSTCRAFT_KEY || cleDepaire("API_KEY");

/* Le slug est la seule chose visible dans l'URL du post : « meshway », pas « Meshway-App-V2 ».
   Même algorithme que slug() du pont Notion (minuscules, accents retirés, tout ce qui n'est pas
   lettre ou chiffre effacé) : le lien mesuré et le PNG de la carte portent le même nom, donc un
   chiffre dans Notion se retrouve sans avoir à deviner de quelle fiche il vient. */
export function slugDe(nom) {
  return String(nom || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 40) || "projet";
}

export const urlMesuree = (slug, source = "linkedin") =>
  `${ORIGINE_MESURE}/go/${slug}${source ? `?de=${source}` : ""}`;

async function appel(chemin, { cle, method = "GET", corps } = {}) {
  const r = await fetch(`${ORIGINE_MESURE}${chemin}`, {
    method,
    headers: { ...(cle ? { Authorization: `Bearer ${cle}` } : {}), ...(corps ? { "Content-Type": "application/json" } : {}) },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  });
  const texte = await r.text();
  let json = {};
  try { json = JSON.parse(texte); } catch { /* une réponse HTML d'erreur arrive telle quelle */ }
  return { ok: r.ok, status: r.status, json, texte };
}

/* Déclarer une destination. Idempotent : on peut le rappeler à chaque armement, la valeur est
   simplement remplacée. `note` sert à retrouver de quelle fiche vient le slug. */
export async function enregistre({ slug, vers, note = "", cle = cleMesure(), origine = ORIGINE_MESURE }) {
  if (!cle) return { ok: false, status: 0, erreur: "cle absente (POSTCRAFT_KEY)" };
  const r = await appel("/api/mesure/lien", { cle, method: "POST", corps: { slug, vers, note } });
  return { ok: r.ok, status: r.status, erreur: r.ok ? "" : (r.json.error || r.texte.slice(0, 120)), mesure: `${origine}/go/${slug}` };
}

/* Lecture des compteurs. `slug` seul rend la ligne de ce slug ; sans, tout le tableau.
   Cohérence à terme du KV : un clic écrit il y a quelques secondes peut manquer à l'appel ;
   mesuré le 28/10, il apparaît dans la liste après ~40 secondes. Un chiffre sous-évalué de
   quelques clics sur une semaine reste juste au moment de la lecture hebdomadaire. */
export async function lisChiffres({ slug = "", cle = cleMesure() } = {}) {
  if (!cle) return { ok: false, lignes: [], erreur: "cle absente (POSTCRAFT_KEY)" };
  const r = await appel(slug ? `/api/mesure/${encodeURIComponent(slug)}` : "/api/mesure", { cle });
  if (!r.ok) return { ok: false, lignes: [], erreur: r.json.error || r.texte.slice(0, 120), status: r.status };
  const lignes = r.json.lignes || (r.json.slug ? [r.json.slug] : []);
  return { ok: true, lignes: slug ? [r.json] : lignes, totalGeneral: r.json.totalGeneral ?? (r.json.total || 0), jour: r.json.jour };
}

export function tableau({ lignes }) {
  if (!lignes.length) return "Aucun slug mesuré enregistré.";
  const lignesTriees = [...lignes].sort((a, b) => (b.total || 0) - (a.total || 0));
  const tete = `${"slug".padEnd(20)} ${"clics".padStart(5)}  ${"depuis".padEnd(11)} sources`;
  return [tete, "-".repeat(tete.length), ...lignesTriees.map((l) => {
    const sources = Object.entries(l.sources || {}).map(([k, v]) => `${k} ${v}`).join(", ") || "aucune";
    return `${String(l.slug).padEnd(20)} ${String(l.total || 0).padStart(5)}  ${String(l.dernier || "jamais").padEnd(11)} ${sources}`;
  }), `total ${lignes.reduce((n, l) => n + (l.total || 0), 0)} clic(s)`].join("\n");
}

/* --- Mode CLI : node scripts/mesure.mjs --etat [--slug meshway] --- */
const estEntree = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (estEntree && process.argv.includes("--etat")) {
  const i = process.argv.indexOf("--slug");
  const slug = i > 0 ? process.argv[i + 1] : "";
  const r = await lisChiffres({ slug });
  if (!r.ok) { console.log(`Lecture refusée (${r.status || "sans clé"}) : ${r.erreur}`); process.exit(1); }
  console.log(`${ORIGINE_MESURE}\n`);
  console.log(tableau({ lignes: r.lignes }));
}
