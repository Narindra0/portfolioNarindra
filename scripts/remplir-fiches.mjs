/* Flux D — remplir les fiches qui n'ont pas de matière.

   Le goulot d'étranglement du flux A n'est pas la plomberie, c'est le contenu : une fiche
   n'est publiable qu'à partir de 60 caractères de matière (Accroche + Description + Mission),
   d'un lien, et du statut « Ajouté » posé par le flux B. Ce script lit le dépôt GitHub de
   chaque fiche muette — description, sujets, README, langues, date — et fait rédiger par
   Gemini de quoi remplir une carte.

   Ce qu'il écrit : Accroche, Description, Mission, Rôle, Fonctionnalités, Catégorie,
   Technologies, Date de création — et UNIQUEMENT quand le champ est vide. Il ne remplace
   jamais un texte déjà en place.

   Ce à quoi il ne touche pas : « Texte du post », « Statut LinkedIn », « Prêt à publier »,
   « ID du post LinkedIn », « URL du post », « Visuel du post », « Brouillon de la semaine »,
   « Dernier commit vu ». Rien ici n'arme ni ne publie sur LinkedIn.
   Une seule exception sur les statuts : « Statut Portfolio » passe de « Brouillon » à
   « À ajouter » quand la fiche est désormais complète ET que le dépôt est public — sans ça,
   une fiche remplie resterait hors du site donc hors du réservoir pour toujours. Le flux B
   décide ensuite, et l'armement LinkedIn reste la main du flux A.

   Anti-invention : le modèle ne reçoit QUE le texte du dépôt ; les technologies sont
   confrontées aux options réelles du champ (un nom inconnu créerait une option Notion, donc
   on le jette) ; la catégorie doit exister dans le select ; « Date de création » vient de
   l'API GitHub, pas de la génération.

   Usage :
     NOTION_TOKEN=… REPO_SCAN_TOKEN=… GEMINI_API_KEY=… node scripts/remplir-fiches.mjs
     … --ecrire                 applique les propositions dans Notion
     … --ecrire Meshway         une seule fiche, par son titre
     … --max=4                  nombre de fiches remplies au plus par passage
   Sans --ecrire, le script s'arrête avant Notion : il montre ce qu'il écrirait.
*/
import { execFileSync } from 'node:child_process';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const DS = process.env.NOTION_DS || '78e87c8c-4916-4d46-8cd2-00b0bcd471fa';
const PROPRIETAIRE = process.env.GITHUB_OWNER || 'Narindra0';
const MODE = process.argv.includes('--ecrire') ? 'ecrire' : 'sec';
const CIBLE = process.argv.slice(2).find((a) => !a.startsWith('--'));

function borne(n, min, max) { return Math.min(max, Math.max(min, n)); }
const MAX = borne(Number((process.argv.find((a) => a.startsWith('--max=')) || '').split('=')[1]) || 4, 1, 12);
/* Le nombre d'appels Gemini est la seule ressource qui se consomme : on plafonne aussi les
   dépôts lis, sinon un passage « 4 fiches remplies » peut taper 40 dépôts pour les rejeter. */
const MAX_DEPOTS_LUS = borne(MAX * 3, 3, 30);
/* En dessous de cette matière, la fiche ne peut pas produire de carte : c'est la cible. */
const SEUIL_MATIERE = 60;
const MAX_README = 3500;

if (!NOTION_TOKEN) { console.error('NOTION_TOKEN manquant'); process.exit(1); }
if (!GEMINI_KEY) { console.error('GEMINI_API_KEY manquant'); process.exit(1); }

/* Le jeton GitHub : le secret REPO_SCAN_TOKEN en Actions, le jeton du magasin git en local.
   Il n'est jamais imprimé. */
const GH_TOKEN = process.env.REPO_SCAN_TOKEN || (() => {
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
    });
    return (out.match(/^password=(.*)$/m) || [])[1]?.trim() || '';
  } catch { return ''; }
})();
if (!GH_TOKEN) { console.error('REPO_SCAN_TOKEN manquant (et aucun jeton dans le magasin git)'); process.exit(1); }

const NH = { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' };
const GH = { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'portfolio-flux-d-remplir-fiches' };

/* Le dépôt portfolio est PUBLIC : chaque log de GitHub Actions est lisible par n'importe qui.
   Ce script fait transiter des README de dépôts privés et des textes non publiés, donc en CI
   on n'affiche qu'une fin d'identifiant Notion. Local = tout visible.
   Forcer l'affichage en Actions : FLUX_D_MONTRER=1 (déconseillé). */
const MASQUE = process.env.GITHUB_ACTIONS === 'true' && !process.env.FLUX_D_MONTRER;
const dispo = (nom, id) => (MASQUE ? `fiche …${id.slice(-6)}` : nom.padEnd(20));

const txt = (p, n) => (p[n]?.rich_text || []).map((t) => t.plain_text).join('').trim();
const titre = (p) => (p['Nom du projet']?.title || []).map((t) => t.plain_text).join('').trim();
const un = (p, n) => p[n]?.select?.name || '';
const multi = (p, n) => (p[n]?.multi_select || []).map((o) => o.name);
const urlDe = (p, n) => p[n]?.url || '';
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

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
      method: 'POST', body: JSON.stringify(curseur ? { page_size: 100, start_cursor: curseur } : { page_size: 100 })
    });
    out.push(...(q.results || []));
    curseur = q.has_more ? q.next_cursor : undefined;
  } while (curseur);
  return out;
}

/* Les options viennent du schéma, jamais d'un souvenir : « unknown option name » est créé
   silencieusement à l'écriture par l'API Notion. On ne propose donc au modèle QUE la liste
   réelle, et toute réponse hors liste est jetée plutôt que normalisée. */
async function optionsReelles() {
  const d = await notion(`/v1/data_sources/${DS}`);
  const p = d.properties || {};
  const map = (nom) => Object.fromEntries((p[nom]?.[p[nom].type]?.options || []).map((o) => [norm(o.name), o.name]));
  return {
    categorie: map('Catégorie'),
    technologies: map('Technologies'),
    categoriesBrutes: (p['Catégorie']?.select?.options || []).map((o) => o.name),
    technosBrutes: (p['Technologies']?.multi_select?.options || []).map((o) => o.name)
  };
}

/* ————————————————————————————————————————————————— GitHub */
const DEPOT = /github\.com\/([^/\s]+)\/([^/\s#?]+)/;

/* Le lien GitHub d'abord ; sur certaines fiches le dépôt n'est noté que dans « Lien Démo ». */
function depotDe(p) {
  for (const champ of ['Lien GitHub', 'Lien Démo']) {
    const m = DEPOT.exec(urlDe(p, champ));
    if (m) {
      const repo = m[2].replace(/\.git$/, '');
      return { owner: m[1], repo, label: `${m[1]}/${repo}` };
    }
  }
  return null;
}

async function vers(route) {
  const r = await fetch(`https://api.github.com${route}`, { headers: GH });
  if (r.status === 404) return { erreur: 'dépôt introuvable (jeton limité à certains dépôts ?)' };
  if (!r.ok) return { erreur: `HTTP ${r.status}` };
  return { json: await r.json() };
}

/* Coupe sur un mot : tronquer « pour éviter l' » et le passer au modèle lui fait recopier
   la coupure — la puce tronquée s'est retrouvée dans une proposition réelle le 26/10. */
function coupe(s, n) {
  const t = String(s).trim();
  if (t.length <= n) return t;
  const point = t.lastIndexOf(' ', n);
  return (point > n * 0.6 ? t.slice(0, point) : t.slice(0, n)).replace(/[,;:\s-]+$/, '') + '…';
}

/* Un README de dépôt perso est fait de badges, de captures et d'installations. On ne garde
   que le texte : puces et phrases, sans code, sans images, sans tableaux, plafonné. */
function readmeUtile(brut) {
  const lignes = String(brut).replace(/\r/g, '').split('\n');
  const garde = [];
  let dansCode = false;
  let taille = 0;
  for (const l of lignes) {
    const t = l.trim();
    if (t.startsWith('```')) { dansCode = !dansCode; continue; }
    if (dansCode || !t) continue;
    if (/^(!\[|\[!|<img|<a |<p|<div|\||https?:\/\/\S+$)/i.test(t)) continue;
    if (/^(license|licence|copyright|acknowledg|contact|merci)/i.test(t.replace(/^#+\s*/, ''))) continue;
    const propre = coupe(t.replace(/^#+\s*/, '').replace(/^[-*]\s+/, '• ').replace(/[*_`]/g, ''), 220);
    if (propre.length < 2) continue;
    garde.push(propre);
    taille += propre.length;
    if (taille > MAX_README) break;
  }
  return garde.join('\n');
}

const pucesDe = (brut) => String(brut).split('\n')
  .map((l) => l.trim())
  .filter((l) => /^[-*]\s+\S/.test(l))
  .map((l) => coupe(l.replace(/^[-*]\s+/, '').replace(/[*_`]/g, ''), 170))
  .filter((l) => l.length > 12)
  .slice(0, 12);

/* ————————————————————————————————————————————————— Gemini */
const SYSTEME = (o) => `Tu remplis la fiche projet du portfolio de Narindra Ranjalahy, développeur fullstack et fondateur à Antananarivo (Madagascar). Tu ne connais le projet QUE par le texte du dépôt fourni dans le message.

Règles absolues :
1. N'invente rien : aucun chiffre, client, date, prix, technologie, fonctionnalité, domaine métier ou résultat qui n'apparaît pas dans le texte du dépôt. Une information absente s'écrit une chaîne vide, jamais devinée.
2. N'attribue aucune discipline (design UI/UX, stratégie produit, DevOps, marketing, chef de projet) si le dépôt ne la nomme pas.
3. Écris en français correct, avec tous les accents ; les noms de technologies restent tels quels (Next.js, REST API).
4. Narindra travaille seul : jamais « nous », « notre équipe », « l'équipe ».
5. « accroche » : 40 à 160 caractères, une phrase qui donne envie (constat, tension, usage), qui ne recopie pas la description et ne commence pas par « NOM_DU_PROJET est… ».
6. « description » : 100 à 420 caractères, ce que le produit fait pour son utilisateur. Pas de vocabulaire de dépôt (« repo », « commit », « branche »).
7. « mission » : 40 à 200 caractères, le problème que le projet règle. Vide si le dépôt ne le dit pas.
8. « role » : un groupe nominal qui décrit ce que Narindra a fait sur ce projet d'après le dépôt (« Conception et développement de… », « Intégration de… »). Jamais son prénom, jamais « il a », jamais de sujet. 40 à 160 caractères, sinon vide.
9. « fonctionnalites » : 2 à 4 puces de 120 caractères maximum, chacune tirée d'une ligne du README et écrivant une phrase COMPLÈTE (jamais coupée en plein mot). Tableau vide si le README n'a pas de puces.
10. « technologies » : uniquement des noms repris à l'identique dans cette liste, et seulement si le dépôt les mentionne : ${o.technosBrutes.join(' | ')}.
11. « categorie » : uniquement une valeur reprise à l'identique dans cette liste, sinon chaîne vide : ${o.categoriesBrutes.join(' | ')}.
12. Réponds STRICTEMENT par cet objet JSON, sans bloc de code ni commentaire :
{"accroche":"","description":"","mission":"","role":"","fonctionnalites":[],"technologies":[],"categorie":""}`;

async function rediger(contexte, o) {
  const corps = {
    /* `{ type: 'text' }` est refusé par l'API (400 « Unknown name "type" ») : une partie
       texte se donne simplement par son champ `text`, comme dans le flux C. */
    contents: [{ role: 'user', parts: [{ text: contexte }] }],
    systemInstruction: { parts: [{ text: SYSTEME(o) }] },
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 4000,
      responseMimeType: 'application/json',
      responseModalities: ['TEXT'],
      thinkingConfig: { thinking_level: 'low', include_thoughts: false }
    }
  };
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify(corps)
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Gemini ${r.status} :: ${d?.error?.message || JSON.stringify(d).slice(0, 160)}`);
  const brut = (d?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('');
  /* Une réponse encadrée ou précédée d'une phrase reste exploitable : on extrait l'objet. */
  const debut = brut.indexOf('{'), fin = brut.lastIndexOf('}');
  if (debut < 0 || fin <= debut) throw new Error('Gemini : aucune structure JSON dans la réponse');
  try { return JSON.parse(brut.slice(debut, fin + 1)); }
  catch { throw new Error('Gemini : JSON illisible'); }
}

/* ————————————————————————————————————————————————— validation */
const uneLigne = (s) => String(s || '').replace(/\s+/g, ' ').trim().replace(/^["«']+|["«']+$/g, '').trim();

/* Une génération qui repart en anglais est le seul défaut visible à l'œil nu sans relire
   chaque phrase : trois mots anglais suffisent à rejeter le texte. Les accents absents
   n'y changent rien (une fiche peut être écrite sans é), c'est le mot qui tranche. */
function enFrancais(s) {
  return !/\b(the|and|for|with|this|that|from|your)\b/i.test(s);
}

/* Ce qui est déjà écrit ne sera jamais remplacé : « existantes » porte les champs remplis. */
function valider(j, o, existantes, meta, langues) {
  const sortie = {}, gardes = [];

  const accroche = uneLigne(j.accroche);
  if (accroche && !existantes.accroche) {
    if (accroche.length >= 30 && accroche.length <= 200 && enFrancais(accroche)) sortie['Accroche'] = accroche;
    else gardes.push(`accroche rejetée (${accroche.length} caractère(s)${enFrancais(accroche) ? '' : ', texte anglais'})`);
  }

  const description = uneLigne(j.description);
  if (description && !existantes.description) {
    if (description.length >= 90 && description.length <= 460 && enFrancais(description)) sortie['Description'] = description;
    else gardes.push(`description rejetée (${description.length} caractère(s)${enFrancais(description) ? '' : ', texte anglais'})`);
  }

  const mission = uneLigne(j.mission);
  if (mission && !existantes.mission && mission.length <= 220 && enFrancais(mission)) sortie['Mission'] = mission;

  const role = uneLigne(j.role);
  if (role && !existantes.role && role.length <= 180 && enFrancais(role)) sortie['Rôle'] = role;

  const puces = (Array.isArray(j.fonctionnalites) ? j.fonctionnalites : [])
    .map((s) => uneLigne(s)).filter((s) => s.length >= 12 && s.length <= 130 && enFrancais(s)).slice(0, 4);
  /* UN seul bloc avec des « \n » : plusieurs blocs rich_text s'affichent collés, et les
     puces doivent rester lisibles une fois reprises dans la carte. */
  if (puces.length && !existantes.fonctionnalites) sortie['Fonctionnalités'] = puces.join('\n');

  const horsListe = (Array.isArray(j.technologies) ? j.technologies : []).filter((t) => !o.technologies[norm(t)]);
  if (horsListe.length) gardes.push(`technologies hors liste du champ, jetées : ${horsListe.slice(0, 3).join(', ')}`);
  const tech = [...new Set((j.technologies || []).map((t) => o.technologies[norm(t)]).filter(Boolean))].slice(0, 6);
  if (tech.length && !existantes.technologies) sortie['Technologies'] = tech;

  const cat = o.categorie[norm(j.categorie)];
  if (cat && !existantes.categorie) sortie['Catégorie'] = cat;
  else if (j.categorie && !cat) gardes.push(`catégorie « ${uneLigne(j.categorie)} » absente du select, ignorée`);

  /* La date vient de l'API GitHub, pas du modèle : rien à vérifier d'autre que son format. */
  const date = String(meta?.created_at || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !existantes.date) sortie['Date de création'] = date;

  return { sortie, gardes, langues };
}

/* Entrée dans le réservoir. Une fiche laissée en « Brouillon » par la découverte l'est presque
   toujours pour une seule raison : sa description GitHub faisait moins de 40 caractères, donc
   pas de carte possible. La matière vient d'être écrite : si le dépôt est public et que la
   fiche a désormais une catégorie et 60 caractères de matière, on la remet dans le circuit —
   c'est la cause d'exclusion qui est levée, pas la règle qu'on contourne.
   Le motif est affiché dans les deux cas : un log qui dit « remplie » sans dire pourquoi elle
   n'y entre pas laisse le lecteur croire à un bug.
   « À ajouter » ne publie rien sur LinkedIn : le flux B pose « Ajouté » sur le site, et
   l'armement reste décidé par notion-to-postcraft --armer. */
function entreeReservoir(p, sortie, meta, matiere) {
  const statut = un(p, 'Statut Portfolio');
  if (statut !== 'Brouillon') return '';                       // déjà dans le circuit (ou « Erreur »)
  const apres = matiere + (sortie['Accroche']?.length || 0)
    + (sortie['Description']?.length || 0) + (sortie['Mission']?.length || 0);
  const categorie = sortie['Catégorie'] || un(p, 'Catégorie');
  if (meta?.private) return 'dépôt privé : le site publierait un lien que ses visiteurs ne peuvent pas ouvrir';
  if (!categorie) return `aucune catégorie retenue (matière ${apres} car.) : la fiche attend un choix de catégorie`;
  if (apres < SEUIL_MATIERE) return `matière encore courte (${apres} caractères) : la carte refuserait la fiche`;
  sortie['Statut Portfolio'] = 'À ajouter';
  if (!un(p, 'Type de lien') && urlDe(p, 'Lien GitHub')) sortie['Type de lien'] = 'GitHub';
  return '';
}

/* ————————————————————————————————————————————————— écriture */
async function appliquer(pageId, champs) {
  const props = {};
  const SELECTS = new Set(['Catégorie', 'Statut Portfolio', 'Type de lien']);
  for (const [nom, valeur] of Object.entries(champs)) {
    if (SELECTS.has(nom)) props[nom] = { select: { name: valeur } };
    else if (nom === 'Technologies') props[nom] = { multi_select: valeur.map((name) => ({ name })) };
    else if (nom === 'Date de création') props[nom] = { date: { start: valeur } };
    else props[nom] = { rich_text: [{ text: { content: valeur } }] };
  }
  await notion(`/v1/pages/${pageId}`, { method: 'PATCH', body: JSON.stringify({ properties: props }) });
  return Object.keys(props);
}

/* ————————————————————————————————————————————————— principal */
const reglages = await optionsReelles();
const fiches = await toutesLesFiches();
let lues = 0, remplies = 0, ignorees = 0, signalees = 0;
console.log(`${fiches.length} fiches lues | ${MAX} fiche(s) remplie(s) au plus, ${MAX_DEPOTS_LUS} dépôt(s) lus au plus | mode ${MODE === 'ecrire' ? 'ÉCRITURE dans les champs vides' : 'SEC : rien n\'est écrit, on montre les propositions'}`);

for (const f of fiches) {
  if (remplies >= MAX || lues >= MAX_DEPOTS_LUS) break;
  const p = f.properties;
  const nom = titre(p);
  if (!nom || (CIBLE && nom !== CIBLE)) continue;

  const matiere = txt(p, 'Accroche').length + txt(p, 'Description').length + txt(p, 'Mission').length;
  if (matiere >= SEUIL_MATIERE) continue;

  /* En cours de publication ou déjà postée : sa matière a servi, on n'y touche plus. */
  const statut = un(p, 'Statut LinkedIn');
  if (statut === 'À publier' || statut === 'Publié') { ignorees++; continue; }

  const depot = depotDe(p);
  if (!depot) { signalees++; continue; }
  if (depot.owner.toLowerCase() !== PROPRIETAIRE.toLowerCase()) {
    console.log(`  ~ ${dispo(nom, f.id)} dépôt d'un autre compte -> ignoré`);
    signalees++; continue;
  }

  lues++;
  const meta = await vers(`/repos/${depot.owner}/${depot.repo}`);
  if (meta.erreur) { console.log(`  ! ${dispo(nom, f.id)} depot : ${meta.erreur}`); signalees++; continue; }
  const rd = await vers(`/repos/${depot.owner}/${depot.repo}/readme`);
  const lg = await vers(`/repos/${depot.owner}/${depot.repo}/languages`);
  const readme = rd.json ? Buffer.from(rd.json.content, 'base64').toString('utf8') : '';
  const corps = readmeUtile(readme);
  const puces = pucesDe(readme);
  const langues = Object.entries(lg.json || {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);

  /* Ni README ni description = rien à rédiger sans inventer. C'est la bonne réponse, pas un échec. */
  if (!corps && !(meta.json?.description || '').trim()) {
    console.log(`  ~ ${dispo(nom, f.id)} ni README ni description -> on ne remplit pas`);
    signalees++; continue;
  }

  const contexte = [
    `Projet : ${nom}`,
    `Dépôt : ${depot.label} (créé le ${String(meta.json?.created_at || '').slice(0, 10)} ; langages détectés par GitHub : ${langues.join(', ') || 'aucun'})`,
    `Description du dépôt : ${meta.json?.description || '(aucune)'}`,
    `Sujets du dépôt : ${(meta.json?.topics || []).slice(0, 8).join(', ') || '(aucun)'}`,
    '',
    'README, texte utile :',
    corps || '(README vide ou absent)',
    '',
    puces.length ? `Puces du README : ${puces.join(' || ')}` : 'Puces du README : (aucune)',
    '',
    'Remplis la fiche selon tes règles. Toute information absente du texte ci-dessus doit rester une chaîne vide.'
  ].join('\n');

  let proposition;
  try { proposition = await rediger(contexte, reglages); }
  catch (e) { console.log(`  ! ${dispo(nom, f.id)} Gemini : ${String(e.message).slice(0, 150)}`); signalees++; continue; }

  const existantes = {
    accroche: Boolean(txt(p, 'Accroche')),
    description: Boolean(txt(p, 'Description')),
    mission: Boolean(txt(p, 'Mission')),
    role: Boolean(txt(p, 'Rôle')),
    fonctionnalites: Boolean(txt(p, 'Fonctionnalités')),
    technologies: multi(p, 'Technologies').length > 0,
    categorie: Boolean(un(p, 'Catégorie')),
    date: Boolean(p['Date de création']?.date?.start)
  };

  const { sortie, gardes } = valider(proposition, reglages, existantes, meta.json, langues);
  gardes.forEach((g) => console.log(`      (garde) ${g}`));
  if (!Object.keys(sortie).length) {
    console.log(`  ~ ${dispo(nom, f.id)} rien à retenir : le dépôt ne donne pas assez de matière fiable`);
    signalees++; continue;
  }

  const motif = entreeReservoir(p, sortie, meta.json, matiere);
  if (motif) console.log(`      (réservoir) ${motif}`);

  if (MODE === 'ecrire') await appliquer(f.id, sortie);
  remplies++;
  const cles = Object.keys(sortie);
  console.log(`  ${MODE === 'ecrire' ? '+' : '•'} ${dispo(nom, f.id)} ${cles.length} champ(s) ${MODE === 'ecrire' ? 'écrit(s)' : 'proposé(s)'} : ${cles.join(', ')}`);
  if (!MASQUE) {
    for (const [k, v] of Object.entries(sortie)) {
      const texte = (Array.isArray(v) ? v.join(' | ') : String(v)).replace(/\n/g, ' ⏎ ');
      /* Affichage seulement : ce qui part dans Notion n'est jamais coupé. La marque « … » dit
         clairement que la ligne continue, sinon on croirait à un texte tronqué dans la fiche. */
      console.log(`      ${k} : ${texte.slice(0, 400)}${texte.length > 400 ? ' […affiché tronqué, Notion reçoit les ' + texte.length + ' caractères]' : ''}`);
    }
  }
}

console.log(`\n${remplies} fiche(s) ${MODE === 'ecrire' ? 'remplie(s)' : 'documentée(s) en aperçu'} | ${lues} dépôt(s) lus | ${ignorees} fiche(s) en cours de publication | ${signalees} signalée(s)`);
console.log('Rien n\'est armé ni publié ici : une fiche ne devient publiable que quand le flux B la passe à « Ajouté ».');
