/* Flux B, étape « scanner » — repère dans Notion les dépôts GitHub que le portfolio ne connaît pas.

   Parcourt TOUS les dépôts de Narindra0 (publics, et privés si REPO_SCAN_TOKEN est fourni),
   écarte les forks, les archives et les noms listés dans data/discovery-rules.json,
   puis crée une fiche par dépôt manquant, pré-remplie avec ce que GitHub sait :
   nom, description, lien, date de création.

   Publication : un dépôt PUBLIC et correctement décrit part en « À ajouter » (donc sur le site
   dès que la Catégorie est renseignée) ; un dépôt PRIVÉ part en « Brouillon » et ne sortira
   jamais tout seul — c'est ce qui empêche un projet interne d'apparaître sur le portfolio.

   Les logs d'un dépôt public sont visibles par tout le monde : les noms des dépôts privés n'y
   sont donc jamais écrits, seule leur quantité apparaît.

   Usage :
     NOTION_TOKEN=… node scripts/github-discovery.mjs --check    liste ce qui serait créé
     NOTION_TOKEN=… node scripts/github-discovery.mjs --create   crée les fiches
   Variables : REPO_SCAN_TOKEN (jeton fine-grained, Metadata lecture seule — facultatif, sans lui
               seuls les dépôts publics sont vus ; nom obligatoire car GitHub interdit un secret
               commençant par GITHUB_), GITHUB_OWNER, NOTION_DS.
 */
import { readFileSync } from 'node:fs';

const TOKEN = process.env.NOTION_TOKEN;
const PAT = process.env.REPO_SCAN_TOKEN || '';
const OWNER = process.env.GITHUB_OWNER || 'Narindra0';
const DS = process.env.NOTION_DS || '78e87c8c-4916-4d46-8cd2-00b0bcd471fa';
const MODE = process.argv.includes('--create') ? 'create' : 'check';

if (!TOKEN) { console.error('NOTION_TOKEN manquant'); process.exit(1); }
const H = { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' };

const regles = JSON.parse(readFileSync(new URL('../data/discovery-rules.json', import.meta.url), 'utf8'));
const IGNORE = new Set((regles.ignore || []).map((n) => n.toLowerCase()));
const CATEGORIE = (regles.categorieParDefault || '').trim();
const MAX = Number(regles.maxFichesParRun) || 5;

// /user/repos (avec jeton) voit les dépôts privés ; /users/<owner>/repos ne voit que le public.
const GH = { headers: { 'User-Agent': 'portfolio-sync', Accept: 'application/vnd.github+json' } };
if (PAT) GH.headers.Authorization = `Bearer ${PAT}`;
const endpoint = PAT ? '/user/repos?per_page=100&sort=pushed&visibility=all' : `/users/${OWNER}/repos?per_page=100&sort=pushed`;

const repos = [];
for (let page = 1; page <= 5; page += 1) {
  const r = await fetch(`https://api.github.com${endpoint}${endpoint.includes('?') ? '&' : '?'}page=${page}`, GH);
  if (!r.ok) { console.error('GitHub : HTTP', r.status, r.status === 401 ? '(REPO_SCAN_TOKEN invalide ou expiré)' : ''); process.exit(1); }
  const part = await r.json();
  if (!part.length) break;
  repos.push(...part);
  if (part.length < 100) break;
}
const prives = repos.filter((r) => r.private).length;
console.log(`dépôts vus : ${repos.length}${PAT ? ` (dont ${prives} privés, noms non affichés)` : ' (publics seulement — REPO_SCAN_TOKEN absent)'}`);

const connaitre = new Set();
const connaitreNom = new Set();
let cursor;
do {
  const q = await fetch(`https://api.notion.com/v1/data_sources/${DS}/query`, {
    method: 'POST', headers: H,
    body: JSON.stringify(cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 })
  }).then((r) => r.json());
  if (!q.results) { console.error('Notion :', JSON.stringify(q).slice(0, 200)); process.exit(1); }
  (q.results || []).forEach((p) => {
    const g = p.properties['Lien GitHub']?.url || '';
    if (g) connaitre.add(norm(g));
    // Une fiche sans lien GitHub (BusNaka, Noovy, DigiKaratra) doit quand même être reconnue :
    // sinon le scanner créerait un doublon vide à chaque run.
    const nom = (p.properties['Nom du projet']?.title || []).map((t) => t.plain_text).join('');
    if (nom) connaitreNom.add(cle(nom));
  });
  cursor = q.has_more ? q.next_cursor : undefined;
} while (cursor);

function norm(u) { return String(u).replace(/\.git$/, '').replace(/\/$/, '').toLowerCase(); }
function cle(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

const ecartes = { fork: 0, archive: 0, ignore: 0, deja: 0 };
const candidats = [];
for (const r of repos) {
  if (r.fork) { ecartes.fork++; continue; }
  if (r.archived) { ecartes.archive++; continue; }
  if (IGNORE.has(r.name.toLowerCase())) { ecartes.ignore++; continue; }
  if (connaitre.has(norm(r.html_url)) || connaitre.has(norm(r.clone_url)) || connaitreNom.has(cle(r.name))) { ecartes.deja++; continue; }
  candidats.push(r);
}
console.log(`écartés : ${ecartes.deja} déjà en fiche, ${ecartes.ignore} sur la liste d'exclusion, ${ecartes.fork} forks, ${ecartes.archive} archivés`);
console.log(`nouveaux à créer : ${candidats.length}`);

const retenus = candidats.slice(0, MAX);
candidats.slice(MAX).forEach((r) => console.log('   remis à plus tard :', r.private ? 'dépôt privé (nom masqué)' : r.name));

for (const r of retenus) {
  const description = (r.description || '').trim();
  const publiable = !r.private && description.length >= 40 && CATEGORIE !== '';
  const statut = publiable ? 'À ajouter' : 'Brouillon';
  console.log(' -', r.private ? 'dépôt privé (nom masqué dans ce log)' : r.name,
    '|', r.language || 'sans langage', '|', statut,
    '| description', description.length >= 40 ? 'ok' : 'trop courte pour une carte');

  if (MODE === 'check') continue;

  const props = {
    'Nom du projet': { title: rt(r.name) },
    'Description': description ? { rich_text: rt(description) } : { rich_text: [] },
    'Lien GitHub': { url: r.clone_url },
    'Type de lien': { select: { name: 'GitHub' } },
    'Date de création': { date: { start: (r.created_at || '').slice(0, 10) } },
    'Statut Portfolio': { select: { name: statut } },
    'Statut LinkedIn': { select: { name: 'Brouillon' } },
    'Prêt à publier': { checkbox: false }
  };
  if (CATEGORIE) props['Catégorie'] = { select: { name: CATEGORIE } };

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST', headers: H, body: JSON.stringify({ parent: { data_source_id: DS }, properties: props })
  });
  const j = await res.json();
  if (!res.ok) { console.error('   échec de création :', JSON.stringify(j).slice(0, 200)); continue; }
  console.log('   fiche créée :', j.url);
}

if (MODE === 'check' && retenus.length) console.log('\n(mode check : aucune fiche créée)');

function rt(s) { return [{ type: 'text', text: { content: String(s || '').slice(0, 2000) } }]; }
