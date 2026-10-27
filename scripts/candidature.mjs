/* Flux E — dossier de candidature à partir d'une annonce.

   Pour chaque ligne de la base « Candidatures » en statut `À traiter`, on lit l'annonce :
   d'abord son lien (extraction du texte visible de la page), et si le lien est muré
   (anti-robot, connexion obligatoire), le texte que le user a collé dans « Texte de l'offre ».
   Puis Gemini rédige, à partir de ces deux seules sources — l'annonce, et ce que Narindra a
   réellement construit (profil-candidature.md + les fiches de la base Projets) :
     « Lettre », « Pourquoi moi », « Ce que l'annonce demande », « Questions d'entretien »,
     « Projets mis en avant ».
   Le script ne poste, n'envoie et ne maille RIEN. L'envoi reste un geste humain, et c'est
   voulu : une candidature engage son auteur, pas son automate.

   Usage :
     NOTION_TOKEN=… GEMINI_API_KEY=… node scripts/candidature.mjs                    sec
     … node scripts/candidature.mjs --ecrire [--max=4] [Intitulé]                     écriture
     … node scripts/candidature.mjs --sonde https://…                                  lit une page, n'appelle ni Notion ni Gemini
     … node scripts/candidature.mjs --liste                                            file d'attente, sans écriture ni appel modèle

   Les variables d'environnement attendues sont posées en secrets GitHub Actions ; en local
   le jeton Notion se lit dans .dev/notion_token et celui de GitHub dans le magasin git.
 */
import { readFileSync, existsSync } from 'node:fs';

const NOTION_TOKEN = process.env.NOTION_TOKEN
  || (existsSync(new URL('../.dev/notion_token', import.meta.url))
    ? readFileSync(new URL('../.dev/notion_token', import.meta.url), 'utf8').trim() : '');
const GEMINI_KEY = process.env.GEMINI_API_KEY
  || (existsSync(new URL('../.dev/gemini_key', import.meta.url))
    ? readFileSync(new URL('../.dev/gemini_key', import.meta.url), 'utf8').trim() : '');
const DS_PROJETS = process.env.NOTION_DS || '78e87c8c-4916-4d46-8cd2-00b0bcd471fa';
/* La base Candidatures est une deuxième source de données : en CI elle vient de la variable de
   dépôt `vars.NOTION_CAND_DS`, et en local du fichier ignoré par Git `.dev/candidatures_ds`
   (posé par .dev/posant-schema-candidatures.mjs). Jamais d'id en dur dans le code versionné :
   tant qu'aucune des deux n'existe, le script refuse de tourner au lieu de deviner. */
const DS_CAND = process.env.NOTION_CAND_DS
  || (existsSync(new URL('../.dev/candidatures_ds', import.meta.url))
    ? readFileSync(new URL('../.dev/candidatures_ds', import.meta.url), 'utf8').trim() : '');

const MODE = process.argv.includes('--ecrire') ? 'ecrire' : 'sec';
const SONDE = (process.argv.find((a) => a.startsWith('--sonde=')) || '').split('=').slice(1).join('=')
  || ((process.argv.includes('--sonde') ? process.argv[process.argv.indexOf('--sonde') + 1] : '') || '');
const LISTE = process.argv.includes('--liste');
/* `--essai=<lien d'annonce>` : la chaîne complète — lecture de la page, Gemini, validation —
   SANS la base Candidatures et sans aucune écriture. Elle sert à tester le flux avant que la
   base existe, et à juger un dossier avant de le demander pour de vrai. */
const ESSAI = (process.argv.find((a) => a.startsWith('--essai=')) || '').split('=').slice(1).join('=');
const CIBLE = process.argv.slice(2).find((a) => !a.startsWith('--') && !/^https?:/i.test(a)) || '';
const borne = (n, min, max) => Math.min(max, Math.max(min, parseInt(n, 10) || min));
const MAX_FICHES = borne((process.argv.find((a) => a.startsWith('--max=')) || '').split('=')[1] || 4, 1, 12);

/* Plafonds de longueur : LinkedIn / les formulaires coupent, et un texte trop long trahi
   par une phrase inachevée fait plus de tort qu'un texte court. */
const LIMITS = { lettre: 1600, pourquoi: 900, checklist: 700, questions: 900, competences: 300, projets: 200 };
const MAX_CARACTERES_ANNONCE = 7000;
const MAX_CARACTERES_MATIERE = 6000;

/* L'appel est en FIN de fichier, pas ici : les constantes du module (MURS, COLONNES, limites)
   ne sont pas encore initialisées à cette ligne, et `principal_sonde()` appelait
   `lireAnnonce()` trop tôt — « Cannot access 'MURS' before initialization » mesuré le 27/10.
   Les déclarations de fonction sont hoistées, les `const` ne le sont pas. */

/* ————————————————————————————————————————————— outils */

const NH = { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' };

async function notion(path, init = {}) {
  const r = await fetch(`https://api.notion.com${path}`, { ...init, headers: NH });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${r.status} ${b?.code || ''} :: ${b?.message || ''}`);
  return b;
}

async function fichesDe(DS) {
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

const txt = (p, n) => (p[n]?.rich_text || []).map((t) => t.plain_text).join('');
const titreDe = (p, n) => (p[n]?.title || []).map((t) => t.plain_text).join('').trim();
const un = (p, n) => p[n]?.select?.name || '';
const urlDe = (p, n) => p[n]?.url || '';
const multisel = (p, n) => (p[n]?.multi_select || []).map((o) => o.name);

/* Le dépôt portfolio est PUBLIC : tout journal de GitHub Actions est lisible par n'importe
   qui. Une annonce contient le nom d'un recruteur, son mail, le salaire, et le texte de la
   candidature qui va être envoyée au nom du user. En CI on n'affiche donc qu'un identifiant
   de fin de page ; la matière se lit dans Notion. Local = tout visible. */
const MASQUE = process.env.GITHUB_ACTIONS === 'true' && !process.env.FLUX_E_MONTRER;
const dispo = (nom, id) => (MASQUE ? `dossier …${id.slice(-6)}` : nom.padEnd(24));

/* ————————————————————————————————————— lecture d'une annonce */

const MURS = [
  'just a moment', 'checking your browser', 'verify you are human', 'verifying you are human',
  'enable javascript', 'enable java script', 'are you a robot', 'unusual traffic',
  'access denied', 'captcha', 'log in to continue', 'sign in to continue',
  'create a free account to continue', 'you need to log in', 'connexion requise',
];

function htmlVersTexte(html) {
  let s = String(html)
    .replace(/<head[\s\S]*?<\/head>/i, (m) => {
      const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(m);
      return t ? `\n${t[1].replace(/<[^>]+>/g, ' ')}\n` : '';
    })
    .replace(/<(script|style|noscript|svg|template|iframe|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  /* Les sauts de ligne viennent des blocs, pas des <br> seuls : sans eux tout le texte de
     l'annonce arrive sur une ligne et devient illisible pour le modèle. */
  s = s
    .replace(/<\/(p|div|li|ul|section|article|header|footer|tr|h[1-6])>/gi, '\n')
    .replace(/<(br|hr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decode(s)
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0 ]+/g, ' ').trim())
    .filter((l) => l && !/^(cookie|accepter les cookies|tout accepter|gérer vos préférences|se déconnecter|cgv|mentions légales|politique de confidentialité)/i.test(l))
    .filter((l) => !(l.length <= 3 && !/[0-9]/.test(l)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decode(s) {
  const ent = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&egrave;': 'è', '&eacute;': 'é', '&agrave;': 'à', '&ccedil;': 'ç' };
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, (m) => ent[m.toLowerCase()] ?? m);
}

/* Le plus gros bloc utile d'une page : une annonce est rarement noyée, elle est le bloc long
   du milieu. On garde tout si un seul bloc domine, sinon on concatène les blocs longs. */
function corpsAnnonce(texte) {
  const blocs = texte.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const longs = blocs.filter((b) => b.length >= 120);
  const choisi = longs.length ? longs.join('\n\n') : blocs.join('\n\n');
  return choisi.slice(0, MAX_CARACTERES_ANNONCE);
}

/* Les mots qui signalent un descriptif de poste. Une page qui ne les contient pas est une
   liste d'offres, un menu ou un mur : mieux vaut refuser que rédiger une lettre de motivation
   à partir d'un bandeau de navigation (mesuré le 27/10 sur une page de recherche Welcome to
   the Jungle : 7 000 caractères lus, tous du menu). */
const SIGNAUX_OFFRE = [
  'description', 'missions', 'profil recherché', 'profil', 'exigences', 'compétences',
  'responsabilit', 'qualifications', 'requirements', 'about the job', 'what you', 'experience',
  'poste', 'employmentType', 'jobPosting',
];

/* Le balisage standard des ATS : `application/ld+json` en `JobPosting`. Greenhouse, Lever,
   Workable, SmartRecruiters, Welcome to the Jungle l'exposent. C'est la voie propre : le
   texte du poste y est séparé du menu, et l'entreprise, le lieu, le contrat, le salaire et la
   date de fin y sont DES DONNÉES, pas une déduction du modèle. */
function jobPostingDe(html) {
  const bruts = [...String(html).matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const objets = [];
  for (const b of bruts) {
    let d;
    try { d = JSON.parse(decode(b.trim())); } catch { continue; }
    for (const o of Array.isArray(d) ? d : [d]) {
      if (o && Array.isArray(o['@graph'])) objets.push(...o['@graph'].filter(Boolean));
      else if (o) objets.push(o);
    }
  }
  return objets.find((o) => /jobposting/i.test(String(o?.['@type'] || ''))) || null;
}

const texteDe = (v) => (Array.isArray(v) ? v.map(texteDe).join(', ')
  : typeof v === 'string' ? v
    : v?.text !== undefined ? texteDe(v.text)
      : v?.name !== undefined ? texteDe(v.name)
        : v?.title !== undefined ? texteDe(v.title) : '');

function salaireDe(o) {
  const s = o?.baseSalary;
  if (!s) return '';
  const devise = s.currency || '';
  const m = s.value?.minAmount, M = s.value?.maxAmount;
  const unit = String(s.unitText || s.value?.unitText || '').replace(/_/g, ' ');
  const montants = m && M ? `${m} – ${M}` : (m || M || '');
  if (!montants && !devise) return '';
  return [montants, devise, unit].filter(Boolean).join(' ');
}

/* Le lieu d'un JobPosting est un tableau de `Place`, chacun avec un `address` de type
   PostalAddress (mesuré sur Lever le 27/10 : trois villes, le champ était vide faute de
   descendre à `addressLocality`). On les rejoint par « / » comme le fait la page elle-même. */
function lieuDe(l) {
  const tab = Array.isArray(l) ? l : [l];
  return tab
    .map((x) => {
      if (typeof x === 'string') return x;
      const a = x?.address;
      if (a) return [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(', ');
      return texteDe(x);
    })
    .filter(Boolean)
    .join(' / ');
}

function structureDe(jp) {
  return {
    entreprise: texteDe(jp.hiringOrganization).slice(0, 120),
    localisation: [lieuDe(jp.jobLocation), texteDe(jp.jobLocationText)].filter(Boolean).join(' — ').slice(0, 200),
    salaire: salaireDe(jp).slice(0, 120),
    /* EmploymentType est codé en anglais côté ATS (« FULL_TIME ») ; on ne le traduit pas au
       risque d'inventer un contrat, on le recopie : la select « Format » ne recevra que ce qui
       correspond déjà à une option existante. */
    format: String(jp.employmentType || '').replace(/_/g, ' ').slice(0, 60),
    dateLimite: String(jp.validThrough || '').slice(0, 10),
  };
}

async function lireAnnonce(url) {
  let r;
  try {
    r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    return { erreur: `page inaccessible (${e.name === 'TimeoutError' ? 'délai 20 s' : e.message})` };
  }
  if (!r.ok) return { erreur: `HTTP ${r.status}` };
  const type = r.headers.get('content-type') || '';
  if (!/html|text\/plain/i.test(type)) return { erreur: `format non lisible (${type.split(';')[0] || 'inconnu'})` };
  const html = await r.text();

  /* 1) la voie structurée d'abord : une page peut employer le mot « captcha » dans son texte
     (un FAQ, un libellé de formulaire) tout en exposant un JobPosting parfaitement lisible.
     Le test de mur ne s'applique donc qu'au repli non structuré. Mesuré le 27/10 : la version
     initiale faisait échouer les trois ATS testés pour ce motif. */
  const jp = jobPostingDe(html);
  if (jp) {
    const desc = htmlVersTexte(String(jp.description || ''));
    if (desc.length >= 150) {
      const titre = texteDe(jp.title) || (htmlVersTexte(html).split('\n')[0] || '').slice(0, 120);
      return {
        texte: `${titre}\n\n${desc}`.slice(0, MAX_CARACTERES_ANNONCE),
        titre, structure: structureDe(jp), methode: 'JSON-LD JobPosting',
      };
    }
  }

  /* 2) repli : le texte visible de la page. Le test de mur n'intervient qu'ici, et seulement
     quand RIEN n'a pu être lu : une page d'offre tout à fait lisible embarque du reCAPTCHA
     (Greenhouse en met un sur son formulaire de réponse), et le mot « captcha » dans le HTML
     n'a jamais empêché de lire une annonce. Inverser ces deux ordres faisait échouer les trois
     ATS testés le 27/10. */
  const visible = htmlVersTexte(html);
  const corps = visible.length >= 400 ? corpsAnnonce(visible) : '';
  const signaux = SIGNAUX_OFFRE.filter((s) => corps.toLowerCase().includes(s.toLowerCase()));
  if (corps && signaux.length >= 2) {
    return { texte: corps, titre: (visible.split('\n')[0] || '').slice(0, 120), methode: 'texte visible de la page' };
  }

  /* ni JobPosting, ni texte exploitable : on nomme la cause la plus précise disponible. */
  const bas = (visible + ' ' + html).toLowerCase();
  const mur = MURS.find((m) => bas.includes(m));
  if (mur) return { erreur: `mur anti-robot ou connexion obligatoire (« ${mur} ») : coller le texte de l'annonce dans « Texte de l'offre »` };
  if (!corps) return { erreur: `page trop courte (${visible.length} caractères lisibles) : le descriptif du poste n'est pas dans le HTML, coller son texte dans « Texte de l'offre »` };
  return { erreur: `aucun descriptif d'offre reconnu (liste d'offres, ou application qui charge le texte en JavaScript) : ouvrir l'annonce, copier son texte dans « Texte de l'offre »` };
}

/* ————————————————————————————————————————————— matière vraie */

async function matiereProjets() {
  const fiches = await fichesDe(DS_PROJETS);
  /* Uniquement ce qui est publié sur le site : `Statut Portfolio = Ajouté` est la preuve que
     la fiche a été relue et que son lien répond. Une fiche en Brouillon peut décrire un dépôt
     privé : l'écrire dans une lettre serait promettre un lien que le recruteur ne verra pas. */
  const publies = fiches.filter((f) => un(f.properties, 'Statut Portfolio') === 'Ajouté');
  const lignes = [];
  for (const f of publies) {
    const p = f.properties;
    const nom = titreDe(p, 'Nom du projet');
    const accroche = txt(p, 'Accroche').split('\n')[0].trim();
    const description = txt(p, 'Description').replace(/\s+/g, ' ').slice(0, 260);
    const technos = multisel(p, 'Technologies').join(', ');
    const cat = un(p, 'Catégorie');
    const lien = urlDe(p, 'Lien Démo') || urlDe(p, 'Lien GitHub');
    lignes.push([
      `${nom}${cat ? ` — ${cat}` : ''}`,
      accroche && `accroche : ${accroche.slice(0, 140)}`,
      description && `${description}`,
      technos && `technos : ${technos}`,
      lien && `lien : ${lien}`,
    ].filter(Boolean).join('\n'));
  }
  let texte = lignes.join('\n\n');
  if (texte.length > MAX_CARACTERES_MATIERE) texte = texte.slice(0, MAX_CARACTERES_MATIERE) + '\n… (liste tronquée)';
  return { texte, nombre: publies.length };
}

/* ————————————————————————————————————————————— Gemini */

const SYSTEME = `Tu prépares le dossier de candidature de Narindra Ranjalahy, développeur fullstack et fondateur à Antananarivo (Madagascar), à partir de deux documents : l'annonce, et sa matière réelle (profil + projets en production).

Règles absolues :
1. N'utiliser QUE ce qui est écrit dans l'annonce et dans la matière. N'inventer aucun employeur, aucune diplôme, aucune date, aucun effectif, aucun chiffre, aucun client, aucune technologie. Une matière qui porte « à compléter » est une information ABSENTE : on n'en parle pas, on ne la remplit pas.
2. Ne jamais dire qu'il a travaillé pour une entreprise tierce : sa matière ne liste que ses propres projets.
3. Répondre à l'annonce, pas à un modèle : chaque point du « Pourquoi moi » doit reprendre une exigence écrite dans l'annonce et y opposer un projet ou une compétence précise de la matière.
4. Français, première personne du singulier, ton sobre et concret. Jamais « nous » ni « notre équipe ». Pas de « passionné », « dynamique », « force de proposition », « rigoureux » sans preuve.
5. Les hashtags, les formules de politesse alambiquées et les phrases d'accroche marketing sont interdits. Une lettre commence par pourquoi cette annonce, continue par ce qui répond, finit par la suite proposée (un échange, une démo).
6. Si l'annonce est en anglais, rédiger en anglais ; sinon en français.
7. Les noms de projets et les liens se citent tels qu'ils sont dans la matière, sans les raccourcir ni les reformuler.
8. Répondre UNIQUEMENT par un objet JSON, sans bloc de code, sans commentaire, avec exactement ces clés :
{"lettre":"...","pourquoi":"...","checklist":"...","competences":"...","questions":"...","projets":"...","entreprise":"...","localisation":"...","salaire":"...","format":"..."}
9. « lettre » : 2 à 4 paragraphes courts, 1 200 à 1 600 caractères espaces compris, sans titre ni formule d'appel.
10. « pourquoi » : 3 à 5 puces, une par exigence de l'annonce, chacune = l'exigence en 4 mots puis la preuve. Une ligne par puce, commencée par « - ».
11. « checklist » : ce que l'annonce demande d'avoir ou de faire pour postuler, sous forme de puces courtes (document, compétence, réponse obligatoire, date). Une ligne par puce, commencée par « - ». Rien en dehors de l'annonce.
12. « competences » : les technologies et compétences que L'ANNONCE demande, séparées par des virgules ; ne citer que les mots qui apparaissent dans l'annonce.
13. « questions » : 4 à 6 questions d'entretien probables pour ce poste, une par ligne commencée par « - », puis sur la même ligne une réponse d'une phrase appuyée sur la matière.
14. « projets » : les 2 à 4 projets de la matière qui servent cette candidature, séparés par des virgules. Uniquement des noms qui existent dans la matière.
15. « entreprise », « localisation », « salaire », « format » : recopier ce que L'ANNONCE dit, mot pour mot ; valeur vide « » si l'annonce ne le dit pas. Ne jamais déduire.`;

/* Le premier objet JSON complet d'une réponse, en équilibrant les accolades et en sautant les
   chaînes entre guillemets. « Du premier { au dernier } » casse dès que le modèle rend deux
   objets ou ajoute une ligne après : mesuré le 27/10 sur Gemini (`responseMimeType: json`
   n'empêche pas une réponse en deux objets) — « Unexpected non-whitespace character after JSON
   at position 3610 ». */
function premierObjet(texte) {
  const debut = String(texte).indexOf('{');
  if (debut < 0) return null;
  let profondeur = 0, dans = false, echappe = false;
  for (let i = debut; i < texte.length; i++) {
    const c = texte[i];
    if (dans) {
      if (echappe) echappe = false;
      else if (c === '\\') echappe = true;
      else if (c === '"') dans = false;
      continue;
    }
    if (c === '"') dans = true;
    else if (c === '{') profondeur++;
    else if (c === '}') {
      profondeur--;
      if (profondeur === 0) return texte.slice(debut, i + 1);
    }
  }
  return null;
}

async function rediger({ annonce, matiere, intitule, source, consigne = '' }) {
  const u = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';
  const corps = {
    contents: [{
      role: 'user',
      parts: [{
        text: `DOSSIER : ${intitule || "(intitulé non renseigné : déduis-le de l'annonce)"}\nSource : ${source}\n\n`
          + `=== MATIÈRE (seule source des faits sur Narindra) ===\n${matiere}\n\n`
          + `=== ANNONCE ===\n${annonce}\n\n`
          + `Rédige le dossier de candidature pour cette annonce.${consigne ? `\n\nCONSIGNE DE RETOUCHE : ${consigne}` : ''}`
      }]
    }],
    systemInstruction: { parts: [{ text: SYSTEME }] },
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 6000,
      responseMimeType: 'application/json',
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
  const brut = (d?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('').trim();
  if (!brut) throw new Error('Gemini : réponse vide');
  const objet = premierObjet(brut);
  if (!objet) throw new Error(`Gemini : pas d'objet JSON complet dans la réponse (${brut.length} car., début ${JSON.stringify(brut.slice(0, 80))})`);
  try { return JSON.parse(objet); }
  catch (e) { throw new Error(`Gemini : JSON illisible (${e.message})`); }
}

/* ————————————————————————————————————————————— validation

   Le garde-fou qui distingue ce flux d'une génération decorative : un nombre écrit dans une
   candidature doit exiter quelque part dans la matière ou l'annonce. Les chiffres sont ce
   qu'un recruteur vérifie en premier (« 8 ans d'expérience », « 40 clients »), et un modèle
   en invente volontiers. On ne contrôle que les nombres ≥ 10 (les petits sont des articles,
   des numéros de phrase), et on refuse le champ entier plutôt que de le corriger à l'aveugle. */
const NOMBRE = /\b(\d{2,})\b/g;
const mots = (s) => new Set((String(s).match(NOMBRE) || []).map((n) => n.replace(/\D/g, '')));

function chiffresHorsSource(texte, sources) {
  const autorises = mots(sources);
  const vus = new Set();
  for (const n of (String(texte).match(NOMBRE) || [])) if (!autorises.has(n)) vus.add(n);
  return [...vus];
}

function nettoie(s) {
  return String(s ?? '')
    .replace(/\r/g, '')
    .replace(/^\s*```.*$/gim, '')
    .replace(/^(Lettre|Lettre)\s*:\s*/i, '')
    .replace(/\[([^\]\n]{0,40})\]/g, '$1')      /* les crochets de gabarit ne doivent pas survivre */
    .trim();
}

/* Coupe à la fin de phrase la plus proche en dessous du plafond, jamais en pleine ligne :
   un paragraphe trahi par une phrase inachevée abîme la candidature plus qu'un argument en
   moins. Les puces sont traitées ligne par ligne (une puce tronquée part à la poubelle). */
function coupePhrase(s, n) {
  if (s.length <= n) return s;
  const lignes = s.split('\n');
  const garde = [];
  let taille = 0;
  for (const l of lignes) {
    const cout = l.length + 1;
    if (taille + cout > n) {
      /* la dernière ligne peut être raccourcie si elle est longue : coupe à la phrase */
      const place = n - taille;
      if (place > 60) {
        const troncee = l.slice(0, place);
        const fin = Math.max(troncee.lastIndexOf('. '), troncee.lastIndexOf('! '), troncee.lastIndexOf('? '), troncee.lastIndexOf('.'));
        if (fin > place * 0.5) garde.push(troncee.slice(0, fin + 1));
      }
      break;
    }
    garde.push(l);
    taille += cout;
  }
  return garde.join('\n').trim();
}

/* Deux familles de refus :
   - ce qui touche à la VÉRITÉ (chiffre inventé, « nous », projet qui n'existe pas, « à
     compléter » recopié) : le dossier est refusé, aucun rafistolage ne le sauve ;
   - ce qui touche à la LONGUEUR : une seule relance avec la mesure sous les yeux, puis coupe
     propre si le modèle ne tient pas la consigne. Refuser pour 125 caractères de trop jetait
     un dossier juste (mesuré le 27/10 : lettre 1 725 / plafond 1 600). */
/* La langue d'un texte, par comptage de mots outillés. Règle ajoutée après mesure du 27/10 :
   sur une annonce Greenhouse entièrement anglaise, Gemini a rendu une lettre en français —
   consigne pourtant écrite dans le prompt système. Un recruteur qui poste en anglais attend
   une réponse en anglais, et la consigne ne suffit pas : c'est le contrôle qui l'impose. */
const ANG = /\b(the|and|for|with|this|that|from|your|you|are|will|have|our|we|experience|work|team|building|strong|knowledge)\b/gi;
const FRA = /\b(le|la|les|et|pour|avec|ce|cette|vos|nous|est|sont|dans|une|des|travail|équipe|expérience|qui|que|sur|aux)\b/gi;
const langueDe = (s) => ((String(s).match(ANG) || []).length > (String(s).match(FRA) || []).length ? 'anglais' : 'français');

function valider(objet, sources, attend = '') {
  const coupes = [];
  const champ = (cle, limite, obligatoire = true, dansLaLangue = false) => {
    const v = nettoie(objet?.[cle]);
    if (!v) return obligatoire ? { erreur: `${cle} : absent de la réponse du modèle` } : { valeur: '' };
    if (/à compléter/i.test(v)) return { erreur: `${cle} : le modèle recopie un « à compléter »` };
    if (/\b(nous|notre équipe|l'équipe)\b/i.test(v) && langueDe(v) === 'français') return { erreur: `${cle} : « nous » alors qu'il travaille seul` };
    if (dansLaLangue && attend && langueDe(v) !== attend) {
      return { erreur: `${cle} : rédigé en ${langueDe(v)} alors que l'annonce est en ${attend}` };
    }
    const h = chiffresHorsSource(v, sources);
    if (h.length) return { erreur: `${cle} : chiffre(s) introuvable(s) dans l'annonce et la matière (${h.slice(0, 4).join(', ')})` };
    if (v.length > limite) {
      const c = coupePhrase(v, limite);
      if (c.length < limite * 0.5) return { erreur: `${cle} : ${v.length} caractères, et la coupe propre tomberait sous la moitié du texte` };
      coupes.push(`${cle} ${v.length} → ${c.length}`);
      return { valeur: c };
    }
    return { valeur: v };
  };
  const sortie = {};
  const erreurs = [];
  for (const [cle, lim, ob, langue] of [
    ['lettre', LIMITS.lettre, true, true], ['pourquoi', LIMITS.pourquoi, true, true], ['checklist', LIMITS.checklist, true, false],
    ['competences', LIMITS.competences, false, false], ['questions', LIMITS.questions, true, true], ['projets', LIMITS.projets, true, false],
    ['entreprise', 120, false, false], ['localisation', 120, false, false], ['salaire', 120, false, false], ['format', 60, false, false],
  ]) {
    const r = champ(cle, lim, ob, langue);
    if (r.erreur) erreurs.push(r.erreur); else sortie[cle] = r.valeur;
  }
  /* Les noms de projets doivent exister dans la matière : un modèle qui écrit « Passio ERP »
     à la place de « Pass'io » envoie une candidature vers un projet introuvable. */
  if (sortie.projets) {
    const matiere = sources.toLowerCase();
    for (const n of sortie.projets.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (!matiere.includes(n.toLowerCase())) erreurs.push(`projets : « ${n} » n'existe pas dans la matière`);
    }
  }
  return { sortie, erreurs, coupes };
}

/* ————————————————————————————————————————————— écriture Notion

   Un champ rich_text multiligne s'écrit en UN SEUL bloc contenant des \n : plusieurs blocs
   sont stockés séparément et tout lecteur qui les recolle sans séparateur fabrique une ligne
   unique (bug vécu sur la base Projets). */
const COLONNES = {
  lettre: 'Lettre', pourquoi: 'Pourquoi moi', checklist: "Ce que l'annonce demande",
  competences: 'Compétences demandées', questions: "Questions d'entretien", projets: 'Projets mis en avant',
};

/* Ce que le script écrit, plus ce qu'il lit : la base doit les porter, sinon la colonne
   existerait sous un autre nom et le PATCH échouerait fiche par fiche, en cours de run. */
const COLONNES_ATTENDUES = [
  "Intitulé", "Entreprise", "Lien de l'offre", "Texte de l'offre", "Statut", "Localisation",
  "Salaire indiqué", "Note du script", "Traitée le",
  ...Object.values(COLONNES),
];

/* Les options réelles d'une select, lues dans le schéma. Écrire une option que la liste ne
   porte pas la fait exister dans Notion sans demander avis : la base Projets l'a déjà payé.
   Ici « Format » est la seule select que le modèle peut remplir, donc on la filtre. */
const cleNormalise = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
async function optionsDe(DS, colonne) {
  const d = await notion(`/v1/data_sources/${DS}`);
  const p = d.properties?.[colonne];
  if (!p) return { existe: false, options: [] };
  const liste = p?.select?.options || p?.multi_select?.options || [];
  return { existe: true, options: liste.map((o) => o.name) };
}

function propertiesPourEcrire(sortie, deja, note, optionsFormat) {
  const props = {};
  const riche = (nom, valeur) => {
    if (!valeur) return;
    props[nom] = { rich_text: [{ text: { content: valeur } }] };
  };
  for (const [cle, nom] of Object.entries(COLONNES)) riche(nom, sortie[cle]);
  /* Entreprise / localisation / salaire : une information que le user a tapée à la main passe
     avant ce que le modèle a déduit de la page. On ne remplit que le vide. */
  seulOuVide(riche, 'Entreprise', sortie.entreprise, deja.Entreprise);
  seulOuVide(riche, 'Localisation', sortie.localisation, deja.Localisation);
  seulOuVide(riche, 'Salaire indiqué', sortie.salaire, deja['Salaire indiqué']);
  /* « Format » est une select : écriture seulement si la valeur du modèle retombe sur une
     option existante (casse et accents tolérés), sinon elle reste vide. */
  if (!deja.Format && sortie.format) {
    const correspondant = optionsFormat.find((o) => cleNormalise(o) === cleNormalise(sortie.format));
    if (correspondant) props['Format'] = { select: { name: correspondant } };
  }
  riche('Note du script', note);
  props['Statut'] = { select: { name: 'Dossier prêt' } };
  props['Traitée le'] = { date: { start: new Date().toISOString().slice(0, 10) } };
  return props;
}

const seulOuVide = (ecris, nom, valeur, dejaEcrit) => { if (valeur && !dejaEcrit) ecris(nom, valeur); };

async function ecrireCandidature(pageId, props) {
  await notion(`/v1/pages/${pageId}`, { method: 'PATCH', body: JSON.stringify({ properties: props }) });
}

/* Génération + validation, avec UNE retouche quand seuls les plafonds de longueur sont
   dépassés. Le modèle écrit volontiers 1 700 caractères quand on lui en demande 1 600 : la
   coupe propre sauve le dossier mais rogne un argument, donc on redemande d'abord une version
   plus courte en donnant la mesure exacte. Les refus de véracité (chiffre inventé, « nous »,
   projet inexistant) ne se rejouent pas : relancer serait tenter sa chance contre la règle. */
async function redigerEtValider({ annonce, matiere, intitule, source }) {
  const sources = `${annonce}\n${matiere}`;
  const attend = langueDe(annonce);
  const objet = await rediger({ annonce, matiere, intitule, source });
  const premier = valider(objet, sources, attend);
  /* Deux familles déclenchent la retouche : les plafonds dépassés, et la langue — une consigne
     du prompt système que le modèle n'a pas suivie (mesuré). Les refus de véracité ne se
     rejouent pas : relancer serait tenter sa chance contre la règle. */
  const aRetoucher = premier.coupes.length > 0
    || (premier.erreurs.length > 0 && premier.erreurs.every((e) => /rédigé en/.test(e)));
  if (!aRetoucher) return premier;
  const consigne = (premier.erreurs.length ? `Langue : l'annonce est écrite en ${attend}, rédige la lettre, le « pourquoi » et les questions d'entretien EN ${attend}. ` : '')
    + (premier.coupes.length ? `Certains champs dépassent le plafond et ont dû être coupés : ${premier.coupes.join(', ')}. ` : '')
    + `Réécris l'objet JSON complet, mêmes règles et mêmes faits, chaque champ sous son plafond : phrase plus courte, une puce de moins si nécessaire. Ne supprime pas la fin de la lettre, elle propose la suite.`;
  const second = valider(await rediger({ annonce, matiere, intitule, source, consigne }), sources, attend);
  const meilleur = second.erreurs.length === 0 && second.coupes.length <= premier.coupes.length ? second : premier;
  return meilleur;
}

/* ————————————————————————————————————————————— sonde (aucune écriture, aucun modèle) */

async function principal_sonde() {
  const r = await lireAnnonce(SONDE);
  console.log(`sonde : ${SONDE}`);
  if (r.erreur) { console.log(`! ${r.erreur}`); process.exit(2); }
  console.log(`+ texte lu : ${r.texte.length} caractères | voie : ${r.methode}`);
  console.log(`  ligne 1 : ${r.titre}`);
  if (r.structure) console.log(`  structure : ${JSON.stringify(r.structure)}`);
  console.log((r.texte || '').split('\n').slice(0, 12).map((l) => `  | ${l.slice(0, 110)}`).join('\n'));
}

/* ————————————————————————————————————————————— essai (aucune écriture, aucune base) */

async function principal_essai() {
  if (!GEMINI_KEY) { console.error('GEMINI_API_KEY manquant'); process.exit(1); }
  const r = await lireAnnonce(ESSAI);
  if (r.erreur) { console.log(`! ${r.erreur}`); process.exit(2); }
  console.log(`annonce : ${r.texte.length} caractères lus (${r.methode})${r.structure ? ' | ' + JSON.stringify(r.structure) : ''}`);
  const matiereDoc = readFileSync(new URL('../data/profil-candidature.md', import.meta.url), 'utf8');
  const matiere = await matiereProjets();
  const contexte = `${matiereDoc.trim()}\n\n## PROJETS EN PRODUCTION (${matiere.nombre})\n${matiere.texte}`;
  const { sortie, erreurs, coupes } = await redigerEtValider({ annonce: r.texte, matiere: contexte, intitule: r.titre, source: r.methode });
  if (erreurs.length) console.log(`\n! dossier refusé par la validation :\n  - ${erreurs.join('\n  - ')}`);
  if (coupes.length) console.log(`\n~ coupe appliquée (plafond) : ${coupes.join(', ')}`);
  for (const [k, v] of Object.entries(sortie)) {
    if (v) console.log(`\n--- ${k} (${v.length} car.) ---\n${v}`);
  }
  console.log(`\n${erreurs.length ? 'REFUSÉ' : 'VALIDÉ'} | rien n'est écrit : mode essai`);
}

/* ————————————————————————————————————————————— principal */

async function principal() {
  if (!NOTION_TOKEN) { console.error('NOTION_TOKEN manquant'); process.exit(1); }
  if (!DS_CAND) { console.error('NOTION_CAND_DS manquant : donner l\'identifiant de la source de données « Candidatures »'); process.exit(1); }
  if (!SONDE && !LISTE && !GEMINI_KEY) { console.error('GEMINI_API_KEY manquant'); process.exit(1); }

  const fiches = await fichesDe(DS_CAND);

  if (LISTE) {
    console.log(`${fiches.length} ligne(s) dans la base Candidatures :`);
    for (const f of fiches) {
      const p = f.properties;
      console.log(`  ${dispo(titreDe(p, 'Intitulé'), f.id)} ${un(p, 'Statut') || '(sans statut)'} | lien ${urlDe(p, "Lien de l'offre") ? 'oui' : 'non'} | texte ${txt(p, "Texte de l'offre").length} car.`);
    }
    return;
  }

  const matiereDoc = readFileSync(new URL('../data/profil-candidature.md', import.meta.url), 'utf8');
  const matiere = await matiereProjets();
  const contexte = `${matiereDoc.trim()}\n\n## PROJETS EN PRODUCTION (${matiere.nombre})\n${matiere.texte}`;
  console.log(`Matière : profil (${matiereDoc.length} car.) + ${matiere.nombre} projet(s) publié(s) (${matiere.texte.length} car.)`);

  /* Le schéma de la base, lu une fois : écrire une option de select que la liste ne porte pas
     la créerait en silence dans Notion. Si « Dossier prêt » manque, on refuse de tourner au
     lieu de polluer la base du user. */
  const schema = await notion(`/v1/data_sources/${DS_CAND}`);
  const optionsColonne = (n) => {
    const d = schema.properties?.[n];
    if (!d) return null;
    return (d.select?.options || d.multi_select?.options || []).map((o) => o.name);
  };
  const optionsFormat = optionsColonne('Format') || [];
  const statuts = optionsColonne('Statut');
  const colonnesManquantes = COLONNES_ATTENDUES.filter((n) => !schema.properties?.[n]);
  if (colonnesManquantes.length) {
    console.error(`! colonnes absentes de la base Candidatures : ${colonnesManquantes.join(', ')}`);
    console.error("  elles doivent être posées d'abord : le script ne crée pas le schéma à la place de la base");
    process.exit(1);
  }
  if (!statuts) { console.error('! colonne « Statut » (select) absente de la base'); process.exit(1); }
  for (const s of ['À traiter', 'Dossier prêt']) {
    if (!statuts.includes(s)) { console.error(`! option « ${s} » absente de la select « Statut » : la poser dans Notion avant de tourner`); process.exit(1); }
  }

  const aTraiter = fiches.filter((f) => {
    const p = f.properties;
    if (CIBLE && titreDe(p, 'Intitulé') !== CIBLE && !f.id.endsWith(CIBLE)) return false;
    return un(p, 'Statut') === 'À traiter' || (CIBLE && (titreDe(p, 'Intitulé') === CIBLE || f.id.endsWith(CIBLE)));
  });
  console.log(`${aTraiter.length} dossier(s) à traiter | mode ${MODE === 'ecrire' ? 'ÉCRITURE' : 'SEC (rien n\'est écrit dans Notion)'}`);

  let prets = 0, refuses = 0, signales = 0;
  for (const f of aTraiter.slice(0, MAX_FICHES)) {
    const p = f.properties;
    let nom = titreDe(p, 'Intitulé');
    const lien = urlDe(p, "Lien de l'offre");
    const colle = txt(p, "Texte de l'offre");

    /* Source de l'annonce : le lien d'abord, le texte collé en repli — et on garde la trace
       de ce qui a servi, parce que « lu sur la page » et « recopié par le user » ne valent
       pas la même confiance. `structure` (JSON-LD de l'ATS) est une DONNÉE, pas une déduction :
       elle passera devant ce que le modèle a écrit pour entreprise / lieu / salaire. */
    let annonce = '';
    let source = '';
    let structure = null;
    let titreLu = '';
    const notes = [];
    if (lien) {
      const r = await lireAnnonce(lien);
      if (r.texte) {
        annonce = r.texte;
        structure = r.structure || null;
        titreLu = (r.titre || '').trim();
        source = `lu sur ${new URL(lien).host} (${r.methode})`;
      } else notes.push(`lien non lisible : ${r.erreur}`);
    }
    if (!annonce && colle) { annonce = colle.slice(0, MAX_CARACTERES_ANNONCE); source = 'texte collé dans la fiche'; }
    if (!annonce) {
      notes.push("aucune annonce lisible : coller le texte dans « Texte de l'offre » ou mettre un lien public");
      if (MODE === 'ecrire') await ecrireCandidature(f.id, { 'Note du script': { rich_text: [{ text: { content: notes.join(' | ') } }] } });
      console.log(`  ! ${dispo(nom, f.id)} ${MASQUE ? '(détails masqués)' : notes.join(' | ')}`);
      signales++;
      continue;
    }

    /* « je colle juste le lien » : si la fiche n'a pas d'Intitulé, celui lu sur la page tient
       lieu de nom, et il est RÉÉCRIT dans la fiche. Sans ça le dossier n'a pas de titre, le
       dispatch par nom ne peut plus le cibler, et la ligne reste vide dans la base. */
    let intituleAAjuster = '';
    if (!nom) {
      intituleAAjuster = titreLu || (colle.split('\n').map((l) => l.trim()).filter(Boolean)[0] || '').slice(0, 120);
      if (intituleAAjuster) { nom = intituleAAjuster; notes.push(`intitulé repris de l'annonce : ${intituleAAjuster}`); }
      else notes.push('la fiche n\'a ni intitulé ni titre lisible : le nommer dans « Intitulé »');
    }

    /* Les deux documents servis au modèle sont les seules sources autorisées ; le contrôle
       des chiffres se fait contre eux, exactement contre ce qui a été donné à lire. */
    let sortie, erreurs, coupes;
    try {
      ({ sortie, erreurs, coupes } = await redigerEtValider({ annonce, matiere: contexte, intitule: nom, source }));
    } catch (e) {
      console.log(`  ! ${dispo(nom, f.id)} Gemini : ${String(e.message).slice(0, 160)}`);
      signales++;
      continue;
    }
    if (erreurs.length) {
      notes.push(`non retenu : ${erreurs.slice(0, 3).join(' ; ')}`);
      if (MODE === 'ecrire') await ecrireCandidature(f.id, { 'Note du script': { rich_text: [{ text: { content: notes.join(' | ') } }] } });
      console.log(`  ! ${dispo(nom, f.id)} ${MASQUE ? 'dossier refusé (voir Notion)' : notes.join(' | ')}`);
      refuses++;
      continue;
    }

    const deja = {
      Entreprise: txt(p, 'Entreprise'),
      Localisation: txt(p, 'Localisation'),
      'Salaire indiqué': txt(p, 'Salaire indiqué'),
      Format: un(p, 'Format'),
    };
    /* Une valeur lue dans le JSON-LD de l'ATS est plus fiable qu'une valeur recopiée par le
       modèle depuis le texte : elle écrase la sienne (mais jamais une saisie du user). */
    if (structure) {
      for (const c of ['entreprise', 'localisation', 'salaire', 'format']) {
        if (structure[c]) sortie[c] = structure[c];
      }
      if (structure.dateLimite) notes.push(`date limite : ${structure.dateLimite}`);
    }
    notes.push(`annonce : ${source}`);
    if (coupes.length) notes.push(`coupe appliquée : ${coupes.join(', ')}`);
    const props = propertiesPourEcrire(sortie, deja, notes.join(' | '), optionsFormat);
    if (intituleAAjuster) props['Intitulé'] = { title: [{ text: { content: intituleAAjuster } }] };
    if (MODE === 'ecrire') await ecrireCandidature(f.id, props);
    prets++;
    console.log(`  ${MODE === 'ecrire' ? '+' : '•'} ${dispo(nom, f.id)} lettre ${sortie.lettre.length} car. | ${sortie.projets.split(',').length} projet(s)`);
    if (!MASQUE) {
      for (const [k, v] of [['Lettre', sortie.lettre], ['Pourquoi moi', sortie.pourquoi], ["Ce que l'annonce demande", sortie.checklist], ["Questions d'entretien", sortie.questions]]) {
        if (v) console.log(`      ${k} : ${v.replace(/\n/g, ' ⏎ ').slice(0, 400)}${v.length > 400 ? ' […affiché tronqué, Notion reçoit ' + v.length + ' caractères]' : ''}`);
      }
    }
  }

  console.log(`\n${prets} dossier(s) ${MODE === 'ecrire' ? 'prêt(s)' : 'serai(en)t prêt(s)'} | ${refuses} refusé(s) par validation | ${signales} signalé(s)`);
  if (MODE === 'sec' && prets) console.log('Relancer avec --ecrire pour écrire dans Notion.');
}

/* ————————————————————————————————————————————— point d'entrée

   En dernier : les `const` du module (MURS, COLONNES, LIMITS…) ne sont initialisées qu'en
   bas de fichier. Les fonctions sont hoistées, pas les constantes — placer l'appel en haut
   donnait « ReferenceError: Cannot access 'MURS' before initialization » (mesuré le 27/10). */
if (SONDE) await principal_sonde();
else if (ESSAI) await principal_essai();
else await principal();
