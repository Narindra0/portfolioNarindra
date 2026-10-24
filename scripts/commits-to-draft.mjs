/* Flux C — brouillon de post à partir des commits réels.

   Pour chaque fiche qui porte un dépôt GitHub, on lit les commits parus depuis le
   watermark « Dernier commit vu », on les fait condenser en un post LinkedIn par Gemini,
   et on écrit le résultat dans « Brouillon de la semaine ».

   Ce script ne publie rien et n'arme rien : il ne touche ni « Texte du post »,
   ni « Statut LinkedIn », ni « Prêt à publier ». Le scan est automatique,
   la publication ne l'est pas.

   Usage :
     NOTION_TOKEN=… REPO_SCAN_TOKEN=… GEMINI_API_KEY=… node scripts/commits-to-draft.mjs
     … node scripts/commits-to-draft.mjs --dry              appelle Gemini, n'écrit pas
     … node scripts/commits-to-draft.mjs --dry Meshway      une seule fiche
   Fenêtre du premier passage (fiche sans watermark) : 7 jours, puis la période
   réellement couverte par les commits suivants.
 */
import { readFileSync, existsSync } from 'node:fs';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const GH_TOKEN = process.env.REPO_SCAN_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const DS = process.env.NOTION_DS || '78e87c8c-4916-4d46-8cd2-00b0bcd471fa';
const MODE = process.argv.includes('--dry') ? 'dry' : 'write';
const CIBLE = process.argv.slice(2).find((a) => !a.startsWith('--'));
const PREMIERE_FENETRE_JOURS = 7;
const MAX_COMMITS_PAR_FICHE = 60;
const MAX_CARACTERES_COMMITS = 3500;

if (!NOTION_TOKEN || !GH_TOKEN) {
  console.error('NOTION_TOKEN et REPO_SCAN_TOKEN sont requis');
  process.exit(1);
}
if (!GEMINI_KEY) { console.error('GEMINI_API_KEY manquant'); process.exit(1); }

const NH = { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' };
const GH = {
  Authorization: `Bearer ${GH_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'portfolio-sync-flux-c'
};

const txt = (p, n) => (p[n]?.rich_text || []).map((t) => t.plain_text).join('');
const titre = (p) => (p['Nom du projet']?.title || []).map((t) => t.plain_text).join('');
const un = (p, n) => p[n]?.select?.name || '';
const urlDe = (p, n) => (p[n]?.url || '').replace(/\.git\/?$/, '');

/* ————————————————————————————————————————————————————— masking
   Le dépôt portfolio est PUBLIC : chaque log de GitHub Actions est consultable par
   n'importe qui. Ce script manipule des dépôts privés et des fiches non publiées —
   noms de projet, messages de commit, contenu du brouillon : rien de tout cela ne doit
   sortir du run. En CI on n'affiche donc qu'un identifiant de fin de page Notion ;
   la matière se lit dans Notion, pas dans le journal. Local = tout visible.
   Forcer la sortie complète dans Actions : FLUX_C_MONTRER=1 (déconseillé). */
const MASQUE = process.env.GITHUB_ACTIONS === 'true' && !process.env.FLUX_C_MONTRER;
const show = MASQUE ? false : Boolean(process.env.FLUX_C_SHOW);
const dispo = (nom, id) => (MASQUE ? `fiche …${id.slice(-6)}` : nom.padEnd(20));

/* Le même texte, réduit à une ligne de compte rendu quand il ne doit pas être lisible. */
function apercu(s) {
  if (!show) return '';
  return ' | ' + s.replace(/\s+/g, ' ').slice(0, 220) + (s.length > 220 ? '…' : '');
}

/* ————————————————————————————————————————————————— Notion */
async function notion(path, init = {}) {
  const r = await fetch(`https://api.notion.com${path}`, { ...init, headers: NH });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${r.status} ${b?.code || ''} :: ${b?.message || ''}`);
  return b;
}

async function toutesLesFiches() {
  const out = [];
  let curseur;
  do {
    const q = await notion(`/v1/data_sources/${DS}/query`, {
      method: 'POST',
      body: JSON.stringify(curseur ? { page_size: 100, start_cursor: curseur } : { page_size: 100 })
    });
    out.push(...(q.results || []));
    curseur = q.has_more ? q.next_cursor : undefined;
  } while (curseur);
  return out;
}

/* ————————————————————————————————————————————————— GitHub */
const DEPOT = /github\.com\/([^/\s]+)\/([^/\s#?]+)/;

function depotDe(p) {
  const brut = p['Lien GitHub']?.url || '';
  const m = DEPOT.exec(brut);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, ''), label: `${m[1]}/${m[2].replace(/\.git$/, '')}` };
}

async function commits(owner, repo, depuisIso) {
  const u = new URL(`https://api.github.com/repos/${owner}/${repo}/commits`);
  u.searchParams.set('per_page', '100');
  if (depuisIso) u.searchParams.set('since', depuisIso);
  const r = await fetch(u, { headers: GH });
  if (r.status === 404) return { erreur: 'dépôt introuvable (jeton limité à certains dépôts ?)' };
  /* 403 sur un dépôt privé = le jeton n'a que « Metadata : read-only ». Les commits
     demandent « Contents : read-only ». Le watermark n'est pas poussé dans ce cas :
     la période reste entière et sera reprise dès que la permission est accordée. */
  if (!r.ok) {
    return { erreur: r.status === 403
      ? 'HTTP 403 — commits illisibles : accorder « Contents : read-only » à REPO_SCAN_TOKEN'
      : `HTTP ${r.status}` };
  }
  const liste = await r.json();
  /* « since » est inclusif côté GitHub : on re-filtre strictement après le watermark
     pour ne jamais resservir le commit déjà publié la fois précédente. */
  const seuil = depuisIso ? Date.parse(depuisIso) : 0;
  const nouveaux = liste.filter((c) => Date.parse(c.commit?.committer?.date || c.commit?.author?.date || 0) > seuil);
  return { liste: nouveaux };
}

/* Message complet, mais court : sujet + 2 lignes de corps, plafonné par fiche. */
function resumeCommits(liste) {
  const chrono = [...liste].reverse();          // API = du plus récent ; on veut du plus ancien
  const lignes = [];
  let taille = 0;
  for (const c of chrono) {
    const msg = (c.commit.message || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const d = (c.commit.committer?.date || c.commit.author?.date || '').slice(0, 10);
    let ligne = `- ${d} ${c.sha.slice(0, 7)} ${msg[0]}`;
    if (msg[1]) ligne += ` — ${msg.slice(1, 3).join(' ')}`;
    if (ligne.length > 240) ligne = ligne.slice(0, 237) + '…';
    if (taille + ligne.length > MAX_CARACTERES_COMMITS) {
      lignes.push(`- … ${chrono.length - lignes.length} commits de plus sur la période`);
      break;
    }
    lignes.push(ligne);
    taille += ligne.length;
    if (lignes.length >= MAX_COMMITS_PAR_FICHE) break;
  }
  return { texte: lignes.join('\n'), nombre: liste.length };
}

/* ————————————————————————————————————————————————— Gemini */
const SYSTEME = `Tu écris pour Narindra Ranjalahy, développeur fullstack et fondateur à Antananarivo (Madagascar), un post LinkedIn « ce que j'ai construit cette semaine ».

Règles absolues :
1. N'utilise QUE les messages de commits fournis. N'invente aucune fonctionnalité, aucun chiffre, aucun client, aucune date, aucun résultat, aucune technologie. Un commit non conventionnel (« wip », « fix », « update ») sans information lisible doit être tu, pas deviné.
2. Ne cite jamais un nom de fichier, un hash de commit, un nom de branche ou un terme technique obscur. Traduis le travail en ce que l'utilisateur du produit voit ou peut faire.
3. Écris à la première personne du singulier, en français, ton concret. Narindra travaille seul : jamais « nous », « notre équipe », « l'équipe ». Le « on » de généralité (« quand on gère des milliers de références ») reste autorisé.
4. Structure : une accroche qui donne envie (constat ou tension, pas le nom du projet suivi de sa définition), puis 2 à 3 paragraphes courts, puis un appel à l'action avec le lien fourni, puis 3 à 5 hashtags sur la dernière ligne.
5. Maximum 1 300 caractères espaces compris, une ligne vide entre les blocs, pas de puces ni de titres, deux émojis maximum s'ils apportent quelque chose.
6. Réponds UNIQUEMENT avec le texte final du post : pas de commentaire, pas de guillemets, pas de bloc de code, et ne dis jamais que le texte ou le projet vient d'une IA.`;

async function rediger({ nom, categorie, lien, resume }) {
  const u = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent`;
  const corps = {
    contents: [{
      role: 'user',
      parts: [{
        text: `Projet : ${nom}\nCatégorie : ${categorie || '(non renseignée)'}\n`
          + `Lien à mettre dans l'appel à l'action : ${lien || '(aucun lien : termine sans lien)'}\n\n`
          + `Commits de la période (${resume.nombre}) :\n${resume.texte}\n\n`
          + `Écris le post LinkedIn de cette semaine pour ${nom}.`
      }]
    }],
    systemInstruction: { parts: [{ text: SYSTEME }] },
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 4000,
      responseModalities: ['TEXT'],
      thinkingConfig: { thinking_level: 'low', include_thoughts: false }
    }
  };
  const r = await fetch(u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify(corps)
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Gemini ${r.status} :: ${d?.error?.message || JSON.stringify(d).slice(0, 200)}`);
  const texte = (d?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('').trim();
  if (!texte) throw new Error('Gemini : réponse vide');
  return texte;
}

/* ————————————————————————————————————————————————— écriture */
async function ecrireFiche(pageId, brouillon, dateCommit) {
  await notion(`/v1/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      properties: {
        'Brouillon de la semaine': { rich_text: [{ text: { content: brouillon } }] },
        'Dernier commit vu': { date: { start: dateCommit } }
      }
    })
  });
}

/* ————————————————————————————————————————————————— principal */
const fiches = await toutesLesFiches();
let ecrits = 0, sauts = 0, bloques = 0;
console.log(`${fiches.length} fiches lues | mode ${MODE === 'dry' ? 'SEC (rien n\'est écrit dans Notion)' : 'écriture'}`);

for (const f of fiches) {
  const p = f.properties;
  const nom = titre(p);
  if (CIBLE && nom !== CIBLE) continue;
  const depot = depotDe(p);
  if (!depot) { sauts++; continue; }

  /* Fiche en cours de publication par le flux A : on ne remplace pas sa matière. */
  if (un(p, 'Statut LinkedIn') === 'À publier') {
    console.log(`  ~ ${dispo(nom, f.id)} en cours de publication (Statut LinkedIn = À publier) -> ignorée`);
    bloques++; continue;
  }

  const watermark = p['Dernier commit vu']?.date?.start || '';
  /* Un watermark écrit « 2026-10-17 » (saisie manuelle dans Notion) est accepté :
     GitHub le lit comme le début de la journée, les commits du jour sont donc proposés
     une fois de plus — c'est ce que cherche celui qui remplit la date à la main. */
  const depuis = watermark
    ? watermark
    : new Date(Date.now() - PREMIERE_FENETRE_JOURS * 86400_000).toISOString();

  const { liste, erreur } = await commits(depot.owner, depot.repo, depuis);
  if (erreur) {
    console.log(`  ! ${dispo(nom, f.id)}${MASQUE ? '' : ' ' + depot.label} -> ${erreur}`);
    bloques++; continue;
  }
  if (!liste.length) { sauts++; continue; }

  const resume = resumeCommits(liste);
  const dateMax = liste.reduce((m, c) => {
    const d = c.commit?.committer?.date || c.commit?.author?.date || m;
    return d > m ? d : m;
  }, depuis);

  const type = un(p, 'Type de lien') || 'Visiter';
  const lien = type === 'GitHub' ? urlDe(p, 'Lien GitHub')
    : type === 'Aucun' ? '' : (urlDe(p, 'Lien Démo') || urlDe(p, 'Lien GitHub'));

  let brouillon;
  try {
    brouillon = await rediger({ nom, categorie: un(p, 'Catégorie'), lien, resume });
  } catch (e) {
    console.log(`  ! ${dispo(nom, f.id)} Gemini : ${String(e.message).slice(0, 160)}`);
    bloques++; continue;
  }

  const entete = `${MASQUE ? dispo(nom, f.id) : nom} — ${resume.nombre} commit(s) du ${depuis.slice(0, 10)} au ${dateMax.slice(0, 10)}`;
  if (MODE === 'write') await ecrireFiche(f.id, brouillon, dateMax);
  console.log(`  ${MODE === 'write' ? '+' : '•'} ${entete}`);
  console.log(`      ${brouillon.length} caractères${MODE === 'write' ? ' -> Notion écrit' : ''}${apercu(brouillon)}`);
  if (show) console.log(brouillon.replace(/^/gm, '      | '));
  ecrits++;
}

console.log(`\n${ecrits} brouillon(s) | ${sauts} fiche(s) sans commit nouveau | ${bloques} signalée(s)`);
