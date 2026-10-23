/* Flux B — le portfolio se régénère tout seul depuis Notion.
   Deux étapes : découverte (les dépôts GitHub marqués du topic « portfolio » entrent
   en Brouillon dans Notion) puis synthèse (data/projects.json régénéré, poussé,
   Netlify redéploie). Aucun déclencheur push : seul le planning ou une demande
   manuelle lance ce fichier, donc un commit du bot ne relance jamais le workflow.

   Secret requis : NOTION_TOKEN (Réglages → Secrets and variables → Actions → New repository secret).
   Variables optionnelles : GITHUB_OWNER (défaut Narindra0), GITHUB_TOPIC (défaut portfolio),
   NOTION_DS (défaut 78e87c8c-4916-4d46-8cd2-00b0bcd471fa).
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOKEN = process.env.NOTION_TOKEN;
const OWNER = process.env.GITHUB_OWNER || 'Narindra0';
const TOPIC = process.env.GITHUB_TOPIC || 'portfolio';
const DS = process.env.NOTION_DS || '78e87c8c-4916-4d46-8cd2-00b0bcd471fa';
const MODE = process.argv.includes('--create') ? 'create' : 'check';

if (!TOKEN) { console.error('NOTION_TOKEN manquant'); process.exit(1); }
const H = { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' };
const GH = { headers: { 'User-Agent': 'portfolio-sync', Accept: 'application/vnd.github+json' } };

// Un jeton GitHub (optionnel) évite la limite 60 req/h partagée entre les runners.
if (process.env.GITHUB_TOKEN) GH.headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const repos = [];
for (let page = 1; page <= 5; page += 1) {
  const gh = await fetch(`https://api.github.com/users/${OWNER}/repos?per_page=100&page=${page}&sort=pushed`, GH);
  if (!gh.ok) { console.error('GitHub : HTTP', gh.status); process.exit(1); }
  const part = await gh.json();
  if (!part.length) break;
  repos.push(...part);
  if (part.length < 100) break;
}
const marques = repos.filter((r) => !r.fork && (r.topics || []).includes(TOPIC));
console.log(`dépôts publics de ${OWNER} : ${repos.length} | portant le topic « ${TOPIC} » : ${marques.length}`);
const sansTopic = repos.filter((r) => !r.fork && !(r.topics || []).includes(TOPIC));
if (sansTopic.length) console.log(`  (${sansTopic.length} non retenus faute de topic — ajoute-le sur github.com/${OWNER}/<dépôt>/settings → Topics)`);

// Les liens déjà connus de Notion, normalisés pour comparer les dépôts aux fiches.
const known = new Set();
let cursor;
do {
  const q = await fetch(`https://api.notion.com/v1/data_sources/${DS}/query`, {
    method: 'POST', headers: H,
    body: JSON.stringify(cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 })
  }).then((r) => r.json());
  if (!q.results) { console.error('Notion :', JSON.stringify(q).slice(0, 200)); process.exit(1); }
  (q.results || []).forEach((p) => {
    const g = p.properties['Lien GitHub']?.url || '';
    if (g) known.add(norm(g));
  });
  cursor = q.has_more ? q.next_cursor : undefined;
} while (cursor);

function norm(u) { return String(u).replace(/\.git$/, '').replace(/\/$/, '').toLowerCase(); }

const manquants = marques.filter((r) => !known.has(norm(r.html_url)) && !known.has(norm(r.clone_url)));
console.log(`déjà présents dans Notion : ${marques.length - manquants.length} | nouveaux à créer : ${manquants.length}`);
manquants.forEach((r) => console.log(' -', r.name, '|', r.language || 'sans langage', '|', (r.description || 'sans description').slice(0, 70)));

if (MODE === 'check' || !manquants.length) {
  if (manquants.length) console.log('\n(mode check : aucune fiche créée)');
  process.exit(0);
}

const rt = (s) => [{ type: 'text', text: { content: String(s || '').slice(0, 2000) } }];
for (const r of manquants) {
  const body = {
    parent: { data_source_id: DS },
    properties: {
      'Nom du projet': { title: rt(r.name) },
      'Description': r.description ? { rich_text: rt(r.description) } : { rich_text: [] },
      'Lien GitHub': { url: r.clone_url },
      'Type de lien': { select: { name: 'GitHub' } },
      'Date de création': { date: { start: (r.created_at || '').slice(0, 10) } },
      'Statut Portfolio': { select: { name: 'Brouillon' } },
      'Statut LinkedIn': { select: { name: 'Brouillon' } },
      'Prêt à publier': { checkbox: false }
    }
  };
  const res = await fetch('https://api.notion.com/v1/pages', { method: 'POST', headers: H, body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) { console.error('   échec', r.name, JSON.stringify(j).slice(0, 200)); continue; }
  console.log('   fiche Brouillon créée :', r.name, '|', j.url);
}
