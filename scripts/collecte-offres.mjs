/* Flux F — la collecte des offres. Deux plateformes malgaches sont lues chaque matin, les offres
   qui ressemblent au profil de Narindra sont GARÉES dans la base « Candidatures » avec le statut
   `Nouvelle offre`, et rien d'autre ne se passe.

   Ce que ce script ne fait pas, et c'est le contrat :
     - il n'appelle PAS Gemini. Une ligne garée n'est pas un dossier : le contenu n'est rédige que
       quand le user passe la ligne elle-même en `À traiter` (flux E) ;
     - il n'envoie, ne poste, ne maille rien, jamais ;
     - il ne touche pas au statut d'une ligne déjà présente : une offre collectée une fois n'est pas
       re-écrite, et une ligne que le user a déjà triée ne revient pas dans la file.

   Ce qui est mesuré (27/10), donc écrit ici sans le deviner :
     - asako.mg rend ses listes côté serveur : /emploi/s-informatique-digital renvoie 20 cartes,
       /page/2 les 6 restantes (« 26 offres » annonce le compteur de la page). Une carte = une ancre
       href="/annonces/<slug>" dont le titre est dans <div class="font-heading…">, l'entreprise dans
       <div class="mt-0.5 text-sm font-medium">, puis des <span> pour date, ville, secteur, contrat.
       Un seul secteur du menu concerne un profil informatique : s-informatique-digital.
     - portaljob-madagascar.com est une coquille Inertia/Laravel : le HTML de la liste ne contient
       aucune offre. Les offres viennent de POST /api/emploi/annonces, qui exige (les trois, mesurés
       un par un) : un en-tête Referer du site sinon 403 « Access not allowed » ; une paire
       XSRF-TOKEN / portaljob_session obtenue en GET /sanctum/csrf-cookie (204) sinon 419 ; et le
       jeton repris décodé dans x-xsrf-token. La paire tient aussi longtemps que le pot à cookies est
       lu correctement — un `name=name=value` dans le Cookie invalide toute la session (c'est ce qui
       faisait croire que la plateforme refusait les robots). Réponse : 709 offres en secteur 7
       (« Informatique / web »), 12 par page, 60 pages, chaque offre avec annonce_poste,
       annonce_entreprise, annonce_ville, annonce_contrat_txt, date_limite_candidature et
       annonce_desc_poste en texte brut.
     - la page de détail portaljob (/emploi/view/<slug>, vérifié HTTP 200) ne rend rien pour un
       lecteur : pas de JSON-LD, la coquille vide. C'est pour ça que le descriptif lu dans l'API est
       copié dans « Texte de l'offre » : le flux E, lui, refuse le lien et prend le texte collé.
       Celles d'asako se lisent bien (JSON-LD JobPosting), donc aucune copie n'est nécessaire.

   Usage :
     NOTION_TOKEN=… node scripts/collecte-offres.mjs                     sec : ce qui serait garé
     … node scripts/collecte-offres.mjs --ecrire                          écrit les lignes
     … node scripts/collecte-offres.mjs --source=asako --max=8            une seule plateforme
     … node scripts/collecte-offres.mjs --liste                           état de la file, sans lire les sites
*/
import { readFileSync, existsSync } from 'node:fs';

const NOTION_TOKEN = process.env.NOTION_TOKEN
  || (existsSync(new URL('../.dev/notion_token', import.meta.url))
    ? readFileSync(new URL('../.dev/notion_token', import.meta.url), 'utf8').trim() : '');
/* La base Candidatures : même source que le flux E, même façon de la retrouver — variable de dépôt
   en CI, fichier ignoré par Git en local. Aucun id en dur dans le code versionné. */
const DS_CAND = process.env.NOTION_CAND_DS
  || (existsSync(new URL('../.dev/candidatures_ds', import.meta.url))
    ? readFileSync(new URL('../.dev/candidatures_ds', import.meta.url), 'utf8').trim() : '');

const ECRIT = process.argv.includes('--ecrire');
const LISTE = process.argv.includes('--liste');
const borne = (n, min, max) => Math.min(max, Math.max(min, parseInt(n, 10) || min));
const MAX_LIGNES = borne((process.argv.find((a) => a.startsWith('--max=')) || '').split('=')[1] || 25, 1, 60);
const VEUT = (process.argv.find((a) => a.startsWith('--source=')) || '').split('=')[1] || '';
const SOURCES = VEUT ? [VEUT.toLowerCase()] : ['asako', 'portaljob'];

/* Plafonds de politesse et de coût : le créneau doit rester court et les sites ne doivent pas
   sentir un crawler. Mesuré : le secteur informatique d'asako fait 2 pages, portaljob 60 — on ne
   lit que les premières, les offres les plus récentes sont en tête (annonce_date décroissant).
   `PJ_PAGES` est un resserrage pour le premier passage ou une retoupe : la variable d'environnement
   evite de devoir pousser un commit pour lire trois pages de plus un dimanche soir. */
const MAX_PAGES_ASAKO = 5;
const MAX_PAGES_PORTALJOB = borne(process.env.PJ_PAGES || 4, 1, 10);
const PAUSE_MS = 1200;
const MAX_TEXTE_OFFRE = 6000;

/* ————————————————————————————— les critères : les mots de SON profil, pas une recherche générique
   Liste volontairement courte et éditable ici. Le seuil est dur : il faut un mot du profil DANS LE
   TITRE, ou deux mots différents dans le descriptif. Une offre « SUPPORT INFORMATIQUE » lue ce jour
   sur portaljob ne passe pas, une « Développeur full-stack confirmé (PHP/Laravel, TypeScript/Node.js) »
   passe. */
const MOTS_PROFIL = [
  'développeur', 'developpeur', 'developer', 'fullstack', 'full stack', 'full-stack',
  'react', 'node', 'node.js', 'nestjs', 'laravel', 'php', 'symfony', 'django',
  'python', 'javascript', 'typescript', 'java', '.net', 'c#', 'go', 'rust',
  'data engineer', 'data scientist', 'data analyst', 'data analyste', 'ingénieur de données', 'data management',
  'ia', 'intelligence artificielle', 'machine learning', 'deep learning', 'llm', 'gen ai', 'prompt',
  'mobile', 'flutter', 'react native', 'android', 'ios',
  'devops', 'sre', 'cloud', 'aws', 'azure', 'ci/cd', 'intégration continue',
  'backend', 'back-end', 'frontend', 'front-end', 'sql', 'mysql', 'postgres',
  'ingénieur logiciel', 'software engineer', 'programmer', 'programmeur', 'codeur', 'it engineer',
];
/* Exclus, sur le titre : ce ne sont pas des postes de développement, même dans le secteur informatique. */
const EXCLUS_TITRE = ['support', 'helpdesk', 'hotline', 'technicien', 'technicienne', 'commercial',
  'comptable', 'comptabilité', 'formation', 'formateur', 'formatrice', 'stage ouvrier'];
/* Villes acceptées : Antananarivo sous ses trois orthographes vues sur les sites, et tout ce qui est
   télétravail. Mahajanga, Fianarantsoa etc. tombent, sauf mention remote dans le titre. */
const LIEUX_OK = ['antananarivo', 'tananarive', 'tana', 'analamanga', 'remote', 'télétravail', 'teletravail', 'hybride', 'hybrid', 'madagascar'];

const normalise = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ' ');
const attente = (ms = PAUSE_MS) => new Promise((r) => setTimeout(r, ms));
/* Correspondance MOT à MOT, pas en sous-chaîne. Mesuré le 27/10 avec la sous-chaîne : « STAGIAIRE
   UX/UI Designer » passait pour un poste d'IA (le « ia » de stagiaire), et « Designer web UX-UI »
   pour un poste de web. Les mots courts — ia, go, web, java — ne survivent qu'entourés de
   non-alphanumériques, ce que les intitulés réels respectent (« Développeur Web », « Full remote »). */
const motifDe = (mot) => {
  const m = normalise(mot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|[^a-z0-9+#.])' + m + '(?:[^a-z0-9]|$)');
};
const MOTIFS_PROFIL = MOTS_PROFIL.map(motifDe);
const MOTIFS_EXCLUS = EXCLUS_TITRE.map(motifDe);
const MOTIFS_LIEU = LIEUX_OK.map(motifDe);
const trouve = (texte, motifs, mots) => mots.filter((_, i) => motifs[i].test(' ' + normalise(texte) + ' '));

/* Le verdict d'une offre, avec les motifs écrits dans Notion : une ligne garée doit rester
   expliquable six mois plus tard. */
function trancher(offre) {
  const titre = offre.titre || '';
  const exclus = trouve(titre, MOTIFS_EXCLUS, EXCLUS_TITRE);
  if (exclus.length) return { garde: false, motif: 'exclue (' + exclus.join(', ') + ')' };
  const dansTitre = trouve(titre, MOTIFS_PROFIL, MOTS_PROFIL);
  const dansTexte = [...new Set(trouve([offre.desc || '', offre.contrat || '', offre.secteur || ''].join(' '), MOTIFS_PROFIL, MOTS_PROFIL))];
  if (dansTitre.length < 1 && dansTexte.length < 2) return { garde: false, motif: 'aucun mot du profil' };
  const lieu = [offre.ville || '', titre].join(' ');
  if (!MOTIFS_LIEU.some((r) => r.test(' ' + normalise(lieu) + ' '))) {
    return { garde: false, motif: 'hors zone (' + (offre.ville || 'lieu non indiqué') + ')' };
  }
  return {
    garde: true,
    note: `collecte ${offre.source.toLowerCase()} · mots du titre : ${dansTitre.join(', ') || '—'}`
      + ` · mots du descriptif : ${dansTexte.join(', ') || '—'} · lieu : ${offre.ville || 'non indiqué'}`
      + (offre.contrat ? ` · contrat : ${offre.contrat}` : '')
      + (offre.urgent ? ' · annonce marquée urgente' : ''),
  };
}

/* ————————————————————————————————————————————— outils réseau */
const UA = 'NarindraCandidaturesPersonnel/1.0 (outil prive de recherche d\'emploi)';
const htmlVersTexte = (html) => String(html || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  /* Les entités numérique d'abord : un intitulé portaljob lu ce jour rendait « 100 &#37; TÉLÉTRAVAIL »,
     le % passant pour du bruit. » */
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#x27;|&#39;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&#34;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&eacute;|&egrave;/gi, 'e')
  .replace(/\s+/g, ' ').trim();

/* Un pot à cookies comme le tiendrait un navigateur : la valeur seule, sans le nom dupliqué.
   C'est le point qui a coûté quatre sondes : `Cookie: portaljob_session=portaljob_session=eyJ…`
   fait rouvrir une session à chaque requête, donc le jeton XSRF ne correspond jamais. */
class Pot {
  constructor() { this.map = new Map(); }
  amasser(rep) {
    for (const c of rep.headers.getSetCookie?.() || []) {
      const paire = c.split(';')[0];
      const eq = paire.indexOf('=');
      if (eq > 0) this.map.set(paire.slice(0, eq).trim(), paire.slice(eq + 1).trim());
    }
  }
  entete() { return [...this.map].map(([k, v]) => `${k}=${v}`).join('; '); }
  xsrf() { return decodeURIComponent(this.map.get('XSRF-TOKEN') || ''); }
}

/* ————————————————————————————————————————————— asako.mg : listes rendues côté serveur */
const ASA_SECTEUR = 'https://www.asako.mg/emploi/s-informatique-digital';

async function lireAsako() {
  const offres = [];
  for (let page = 1; page <= MAX_PAGES_ASAKO; page++) {
    const url = page === 1 ? ASA_SECTEUR : `${ASA_SECTEUR}/page/${page}`;
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' } });
    if (!r.ok) { console.log(`  asako ${url} -> HTTP ${r.status}, arret de ce compte`); break; }
    const html = await r.text();
    const cartes = [...html.matchAll(/<a\b[^>]*href="(?:https?:\/\/www\.asako\.mg)?(\/annonces\/[^"]+)"[\s\S]*?<\/a>/gi)];
    if (!cartes.length) { console.log(`  asako page ${page} : 0 carte`); break; }
    for (const c of cartes) {
      const brut = c[0];
      const titre = htmlVersTexte((brut.match(/<div class="font-heading[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '');
      const entreprise = htmlVersTexte((brut.match(/<div class="mt-0\.5 text-sm font-medium"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '');
      /* Les spans du bandeau, dans l'ordre du HTML : date, ville, « · », secteur, « · », contrat. */
      const spans = [...brut.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)]
        .map((s) => htmlVersTexte(s[1])).filter((t) => t && t !== '·');
      offrePrenante(offres, {
        source: 'Asako',
        url: 'https://www.asako.mg' + c[1],
        titre, entreprise,
        date: spans[0] || '', ville: spans[1] || '', secteur: spans[2] || '', contrat: spans[3] || '',
        desc: '',
      });
    }
    console.log(`  asako page ${page} : ${cartes.length} carte(s) lue(s)`);
    /* La pagination réelle est dans le HTML : le seul lien /page/N vu est le suivant. S'il n'y en a
       plus, on s'arrete au lieu d'inventer une page vide. */
    if (!html.includes(`/page/${page + 1}`)) break;
    await attente();
  }
  return offres;
}

/* ————————————————————————————————————————— portaljob : Inertia, donc l'API interne */
const PJ = 'https://www.portaljob-madagascar.com';
const PJ_LISTE = `${PJ}/emploi/liste/secteur/informatique-web`;
/* id du secteur lu dans les props `megaMenu.secteurs` de la page ({"id":7,…,"secteur_url":
   "informatique-web"}), pas supposé. Relu à chaque course : si la plateforme remappe ses secteurs,
   on s'adapte au lieu de collecter le mauvais menu. */
async function secteurPortalJob(pot) {
  const r = await fetch(PJ_LISTE, { headers: { 'user-agent': UA, accept: 'text/html' } });
  pot.amasser(r);
  const html = await r.text();
  const m = html.match(/<div[^>]*id="app"[^>]*data-page='([^']*)'/) || html.match(/data-page="([^"]*)"/);
  if (!m) return 0;
  const props = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&')).props || {};
  return (props.megaMenu?.secteurs || []).find((s) => s.secteur_url === 'informatique-web')?.id || 0;
}

async function lirePortalJob() {
  const offres = [];
  const pot = new Pot();
  /* La paire session/jeton se prend là, pas sur la page de liste : /sanctum/csrf-cookie est la voie
     officielle et elle répond 204 en posant les deux cookies. */
  const csrf = await fetch(`${PJ}/sanctum/csrf-cookie`, { headers: { 'user-agent': UA, referer: PJ_LISTE, origin: PJ, accept: '*/*' } });
  pot.amasser(csrf);
  const secteur = await secteurPortalJob(pot);
  if (!secteur) { console.log('  portaljob : secteur « informatique-web » introuvable dans la page, arret'); return offres; }
  for (let page = 1; page <= MAX_PAGES_PORTALJOB; page++) {
    await attente();
    const r = await fetch(`${PJ}/api/emploi/annonces`, {
      method: 'POST',
      headers: {
        'user-agent': UA, 'content-type': 'application/json', accept: 'application/json, text/plain, */*',
        'x-xsrf-token': pot.xsrf(), 'x-requested-with': 'XMLHttpRequest',
        referer: PJ_LISTE, origin: PJ, cookie: pot.entete(),
      },
      body: JSON.stringify({ query: '', ville: '', contrats: [], secteurs: [secteur], niveaux: [], experiences: [], international: 0, page }),
    });
    pot.amasser(r);
    if (!r.ok) { console.log(`  portaljob page ${page} -> HTTP ${r.status} (${(await r.text()).slice(0, 60)}), arret`); break; }
    const j = await r.json();
    const liste = j?.annonces?.data || [];
    if (!liste.length) { console.log(`  portaljob page ${page} : 0 offre`); break; }
    for (const a of liste) {
      offrePrenante(offres, {
        source: 'PortalJob',
        url: `${PJ}/emploi/view/${a.annonce_url}`,
        titre: htmlVersTexte(a.annonce_poste), entreprise: htmlVersTexte(a.annonce_entreprise),
        ville: htmlVersTexte(a.annonce_ville), contrat: htmlVersTexte(a.annonce_contrat_txt || a.annonce_contrat?.type_contrat),
        echeance: a.date_limite_candidature || '', desc: htmlVersTexte(a.annonce_desc_poste).slice(0, MAX_TEXTE_OFFRE),
        urgent: !!a.est_urgente, date: a.annonce_date || '',
      });
    }
    console.log(`  portaljob page ${page} : ${liste.length} offre(s) lue(s) sur ${j?.annonces?.total ?? '?'} du secteur`);
    if (page >= (j?.annonces?.last_page || page)) break;
  }
  return offres;
}

/* Les deux compteurs alimentent la même file, avec les mêmes règles de forme : pas d'offre sans
   titre ni sans lien, et un titre coupé à 300 caractères pour rester lisible dans Notion. */
function offrePrenante(file, o) {
  if (!o.titre || !/^https?:/i.test(o.url)) return;
  o.titre = o.titre.slice(0, 300);
  file.push(o);
}

/* ————————————————————————————————————————————— Notion */
const NH = { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' };
const notion = async (p, init = {}) => {
  const r = await fetch(`https://api.notion.com${p}`, { ...init, headers: NH });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Notion HTTP ${r.status} ${j.code || ''} ${j.message || ''}`.slice(0, 200));
  return j;
};
async function fiches() {
  const out = [];
  let curseur;
  do {
    const j = await notion(`/v1/data_sources/${DS_CAND}/query`, {
      method: 'POST', body: JSON.stringify({ page_size: 100, ...(curseur ? { start_cursor: curseur } : {}) }),
    });
    out.push(...(j.results || []));
    curseur = j.has_more ? j.next_cursor : undefined;
  } while (curseur);
  return out;
}
const titreDe = (p, n) => (p[n]?.title || []).map((t) => t.plain_text).join('').trim();
const txt = (p, n) => (p[n]?.rich_text || []).map((t) => t.plain_text).join('');
const urlDe = (p, n) => p[n]?.url || '';
const selDe = (p, n) => p[n]?.select?.name || '';
/* Le lien normalisé sert de clé anti-doublon : la même offre changée d'orthographe par le site
   (slash final, majuscule, paramètre de tracking) ne doit pas créer deux lignes. */
const cleLien = (u) => String(u || '').toLowerCase().replace(/^http:/, 'https:').replace(/[?#].*$/, '').replace(/\/+$/, '');

/* Les options des selects, relues dans le schéma EN UNE requis. Écrire une option que la liste ne
   porte pas échoue en 400 : on préfère laisser la colonne vide plutôt que de deviner une valeur,
   et le vide se voit — la valeur inventée, non. */
async function optionsDuSchema() {
  const s = await notion(`/v1/data_sources/${DS_CAND}`);
  const des = (colonne) => {
    const p = s.properties?.[colonne];
    return ((p?.select || p?.multi_select)?.options || []).map((o) => o.name);
  };
  return { Statut: des('Statut'), Source: des('Source'), Format: des('Format') };
}

const riche = (s) => {
  const texte = String(s || '').slice(0, MAX_TEXTE_OFFRE);
  const morceaux = [];
  for (let i = 0; i < texte.length; i += 1900) morceaux.push({ type: 'text', text: { content: texte.slice(i, i + 1900) } });
  return morceaux;
};

/* Le contrat portaljob (Free-lance, CDI, CDD, Stage…) ramené à une option qui EXISTE dans la base,
   sinon la colonne reste vide : une valeur inventée est une erreur de donnée, un vide est une
   question posée au user. LA VALEUR DE LA TABLE EST LE NOM EXACT DE L OPTION NOTION — mesuré le
   27/10 : écrire « freelance » (minuscule) pour l option « Freelance / mission » fait echouer le
   test d existence et laisse la colonne vide sans erreur. */
const formatDe = (contrat, options) => {
  const c = normalise(contrat);
  const table = [
    ['Freelance / mission', ['free-lance', 'freelance', 'independant', 'consultant']],
    ['Temps partiel', ['temps partiel', 'mi-temps']],
    ['CDI', ['cdi']],
    ['CDD', ['cdd']],
    ['Stage', ['stage']],
    ['Alternance', ['alternance', 'apprentissage']],
    ['Remote', ['remote', 'teletravail']],
  ];
  for (const [nom, cles] of table) if (cles.some((k) => c.includes(k)) && options.includes(nom)) return nom;
  return '';
};

/* Le dépôt portfolio est PUBLIC : les journaux de GitHub Actions sont lisibles par n'importe qui.
   Un intitulé d'offre et le nom d'une entreprise appartiennent à la recherche d'emploi de Narindra,
   ils n'ont rien à faire dans un journal public. En CI, on ne montre donc qu'un identifiant de fin
   et des compteurs ; le contenu, lui, part bien entier dans Notion. */
const MASQUE = process.env.GITHUB_ACTIONS === 'true' && !process.env.FLUX_F_MONTRER;
const dispo = (o, id = '') => (MASQUE ? `ligne …${(id || o.url).slice(-6)}` : `${o.source.padEnd(9)} ${(o.titre || '').slice(0, 58)}`);

/* ————————————————————————————————————————————— course */
const principal = async () => {
  if (!NOTION_TOKEN) throw new Error('NOTION_TOKEN absent : export local ou secret GitHub Actions');
  if (!DS_CAND) throw new Error('identifiant de la base Candidatures absent : vars.NOTION_CAND_DS (CI) ou .dev/candidatures_ds (local)');

  if (LISTE) {
    const lignes = await fiches();
    const parStatut = {};
    for (const f of lignes) parStatut[selDe(f.properties, 'Statut') || '(vide)'] = (parStatut[selDe(f.properties, 'Statut') || '(vide)'] || 0) + 1;
    console.log(`base Candidatures : ${lignes.length} ligne(s) | ${Object.entries(parStatut).map(([s, n]) => `${s} ${n}`).join(' | ')}`);
    for (const f of lignes.filter((x) => selDe(x.properties, 'Statut') === 'Nouvelle offre')) {
      const p = f.properties;
      const quoi = MASQUE ? 'offre …' + f.id.slice(-6) : titreDe(p, 'Intitulé').slice(0, 52) + ' — ' + txt(p, 'Entreprise');
      /* Source et Format sont des selects : les lire avec le lecteur de rich_text rendait une colonne
         vide et faisait croire qu'elle n'avait pas été écrite. */
      const source = selDe(p, 'Source') || '—';
      const format = selDe(p, 'Format') || '—';
      /* La ville fait partie de l'offre, pas du tuyau : « Antananarivo / NOC Analakely » dans un
         journal public racontent autant l'annonce que son intitulé. Masqué comme le reste. */
      const lieu = MASQUE ? '' : ' | ' + txt(p, 'Localisation').slice(0, 24);
      console.log('  ' + source.padEnd(10) + ' ' + format.padEnd(9) + ' ' + quoi + lieu);
    }
    return;
  }

  console.log(`${ECRIT ? 'ECRITURE' : 'sec (aucune ligne creee)'} — collecte ${SOURCES.join(' + ')}, max ${MAX_LIGNES} lignes, 0 appel modele`);
  const brutes = [];
  if (SOURCES.includes('asako')) brutes.push(...await lireAsako());
  if (SOURCES.includes('portaljob')) brutes.push(...await lirePortalJob());

  const existantes = await fiches();
  const deja = new Set(existantes.map((f) => cleLien(urlDe(f.properties, 'Lien de l\'offre'))).filter(Boolean));
  /* Anti-doublon par intitulé en plus du lien : une même annonce postée sur les deux sites arrive
     avec deux URL différentes (mesuré le 27/10 : « Développeur full-stack confirmé (PHP/Laravel,
     TypeScript/Node.js) » figure sur asako ET sur portaljob). Sans cette clé, la première course
     aurait garé deux lignes pour la même offre. */
  const cleTitre = (s) => normalise(s).replace(/[^a-z0-9]+/g, '');
  const dejaTitres = new Set(existantes.map((f) => cleTitre(titreDe(f.properties, 'Intitulé'))).filter(Boolean));
  const enFile = existantes.filter((f) => ['À traiter', 'Nouvelle offre'].includes(selDe(f.properties, 'Statut'))).length;
  console.log(`\n${brutes.length} offre(s) lue(s) | ${deja.size} lien(s) deja dans la base | ${enFile} ligne(s) deja en file`);

  const gardees = [];
  const ecartees = {};
  const ecarter = (m) => { ecartees[m] = (ecartees[m] || 0) + 1; };
  for (const o of brutes) {
    if (deja.has(cleLien(o.url)) || dejaTitres.has(cleTitre(o.titre))) { ecarter('deja dans la base'); continue; }
    const v = trancher(o);
    if (!v.garde) { ecarter(v.motif); continue; }
    deja.add(cleLien(o.url));
    dejaTitres.add(cleTitre(o.titre));
    gardees.push({ ...o, note: v.note });
  }
  console.log(`${gardees.length} offre(s) retenue(s) :`);
  for (const [m, n] of Object.entries(ecartees)) console.log(`  ecartees — ${m} : ${n}`);

  const aEcrire = gardees.slice(0, MAX_LIGNES);
  if (gardees.length > aEcrire.length) console.log(`  (plafond ${MAX_LIGNES} lignes par course : ${gardees.length - aEcrire.length} offre(s) restent pour demain)`);

  if (!aEcrire.length || !ECRIT) {
    for (const o of aEcrire) console.log(`  ${dispo(o)}\n            ${MASQUE ? '(motifs masques en journal public)' : o.note}`);
    /* Les lieux refusés sont montrés tels quels : la liste des villes acceptées est une décision,
       pas un détail technique, et elle se corrige mieux avec les intitulés sous les yeux. */
    const horsZone = brutes.filter((o) => trancher(o).motif?.startsWith('hors zone'));
    if (horsZone.length && !MASQUE) {
      console.log('\n  offres écartées par la règle de lieu :');
      for (const o of horsZone) console.log(`    ${o.source.padEnd(9)} ${(o.ville || '(aucun lieu)').padEnd(26)} ${o.titre.slice(0, 56)}`);
    }
    if (!ECRIT && aEcrire.length) console.log('\nmode sec : relancer avec --ecrire pour garer ces lignes dans Notion.');
    return;
  }

  const opts = await optionsDuSchema();
  if (!opts.Statut.includes('Nouvelle offre')) throw new Error('l\'option « Nouvelle offre » est absente du select Statut : poser le schéma avant de collecter');

  let creer = 0;
  for (const o of aEcrire) {
    const p = {
      'Intitulé': { title: riche(o.titre) },
      'Statut': { select: { name: 'Nouvelle offre' } },
      'Source': opts.Source.includes(o.source) ? { select: { name: o.source } } : undefined,
      'Entreprise': o.entreprise ? { rich_text: riche(o.entreprise) } : undefined,
      'Lien de l\'offre': { url: o.url },
      'Localisation': o.ville ? { rich_text: riche(o.ville) } : undefined,
      'Note du script': { rich_text: riche(o.note) },
    };
    const format = formatDe(o.contrat || '', opts.Format);
    if (format) p['Format'] = { select: { name: format } };
    /* Le descriptif n'est copié que pour portaljob : sa page de detail ne rend rien pour un lecteur,
       alors que celle d'asako expose un JobPosting complet que le flux E sait lire dans le lien. */
    if (o.desc && o.source === 'PortalJob') p['Texte de l\'offre'] = { rich_text: riche(o.desc) };
    if (/^\d{4}-\d{2}-\d{2}$/.test(o.echeance || '')) p['Échéance'] = { date: { start: o.echeance } };
    for (const k of Object.keys(p)) if (!p[k]) delete p[k];
    const cree = await notion('/v1/pages', { method: 'POST', body: JSON.stringify({ parent: { type: 'data_source_id', data_source_id: DS_CAND }, properties: p }) });
    creer++;
    console.log(`  garée   ${dispo(o, cree.id)}`);
    await attente(250);
  }
  console.log(`\n${creer} ligne(s) garée(s) en statut « Nouvelle offre » — passe ce qui t interesse en « À traiter » pour que le flux E rédige le dossier.`);
};

await principal();
