/* Mini-programme de CV : il régénère un CV à partir de ce qui est VRAI, c'est-à-dire de
   deux sources seulement — `data/profil-candidature.md` (les faits personnels que tu as
   écrits toi-même, plus `data/profil-prive.md` pour les coordonnées, hors version) et la
   base Notion « Projets » (ce qui tourne, avec ses technologies).

   Ce qu'il ne fait PAS, et c'est le coeur du programme :
     - il n'écrit aucune rubrique dont la source dit « à compléter » : études, expérience,
       langues, mobilité, prétention et contact restent ABSENTS tant que le fichier ne les
       porte pas. Une ligne vide sur un CV se remplit à la main, pas par supposition ;
     - il n'invente aucun chiffre : le seul nombre qui apparaît (combien de projets, combien
       de technologies) est compté dans les lignes réellement lues, jamais fourni par un
       modèle ;
     - il ne liste un projet que s'il a un lien public à montrer, sauf `--sans-lien` ;
     - il ne liste pas un lien qui ne répond pas : chaque URL est demandée en réel pendant
       la génération, une réponse >= 400 écarte la fiche (mesuré le 28/10 : BusNaka 404) ;
     - il ne montre pas toutes les fiches : une note transparente (matière, mots-clés,
       fraîcheur, preuve, recouvrement avec `--cible`) décide de ce qui est affiché, et le
       rapport imprime la note de chacune.

   Format : les titres de rubriques reprennent les mots qu'un lecteur de CV automatique
   (ATS) recherche — Profil, Compétences, Projets, Formation, Langues — une colonne, aucune
   image, des dates en « mois année », et les URL écrites en clair dans le texte et pas
   seulement dans le lien. `cv.txt` est la même matière sans mise en forme, pour les
   portails qui n'acceptent que du brut.

   Usages :
     node scripts/cv.mjs                          -> affiche le Markdown sur stdout, rien n'est écrit
     node scripts/cv.mjs --ecrire                 -> écrit cv/cv.md, cv/cv.txt et cv/cv.html
     node scripts/cv.mjs --ecrire --pdf           -> + le PDF A4, imprimé par le navigateur local
     node scripts/cv.mjs --ecrire --pdf --une-page -> le même PDF, ajusté pour tenir sur UNE page
       (le programme imprime, compte les pages, serre la typographie jusqu'au plancher de
       lisibilité, puis rend une fiche à la fois tant que ça déborde — c'est `npm run cv:pdf`)
     node scripts/cv.mjs --cible "Développeur fullstack, mission data"
     node scripts/cv.mjs --max 6                  -> nombre de projets affichés (défaut 6)
     node scripts/cv.mjs --sans-lien              -> garde les projets sans URL publique
     node scripts/cv.mjs --sec                    -> n'affiche que le rapport (manquants, tri)

   Variables : NOTION_TOKEN / NOTION_TOKEN_FILE / NOTION_DS (mêmes que le flux A), et trois
   chemins modifiables pour les essais — CV_PROFIL, CV_PRIVE, CV_DOSSIER.
   Deux choses ne montent jamais dans le dépôt : le dossier cv/, et les coordonnées de
   data/profil-prive.md. Le dépôt est public (`private: false` mesuré sur l'API GitHub) et le
   site est servi depuis ce dépôt : un email versionné se retrouve en ligne au premier push.
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DS = process.env.NOTION_DS || "78e87c8c-4916-4d46-8cd2-00b0bcd471fa";
/* Le profil reste la source unique ; CV_PROFIL permet de tester une variante (ou de
   préparer un CV pour une cible précise) sans toucher au fichier autorisé du dépôt. */
const PROFIL = process.env.CV_PROFIL || join(RACINE, "data", "profil-candidature.md");
/* Le dépôt est public (`private: false` mesuré sur l'API GitHub), et le site est servi depuis
   ce même dépôt : un email ou un téléphone écrit dans data/profil-candidature.md se retrouve
   en ligne dès le push. Les coordonnées vivent donc dans data/profil-prive.md, hors version,
   que le programme recolle sur la rubrique Contact avant de construire le document. Côté
   flux E, rien ne change : les lettres n'ont jamais eu besoin d'une adresse. */
const PRIVE = process.env.CV_PRIVE || join(RACINE, "data", "profil-prive.md");
/* CV_DOSSIER permet de tester une variante (profil rempli, palier forcé) sans écraser le CV
   réel dans cv/ — la boucle d'ajustement imprime plusieurs fois, elle écrase ses propres
   fichiers à chaque essai, un essai de test ne doit pas laisser sa copie derrière lui. */
const DOSSIER = process.env.CV_DOSSIER || join(RACINE, "cv");

const args = process.argv.slice(2);
const opt = (nom, defaut) => {
  const i = args.indexOf(`--${nom}`);
  return i === -1 ? defaut : (args[i + 1] ?? "").replace(/^"|"$/g, "");
};
const flag = (nom) => args.includes(`--${nom}`);

function jeton() {
  if (process.env.NOTION_TOKEN) return process.env.NOTION_TOKEN.trim();
  const candidats = [process.env.NOTION_TOKEN_FILE, join(RACINE, ".dev", "notion_token")].filter(Boolean);
  for (const chemin of candidats) if (existsSync(chemin)) return readFileSync(chemin, "utf8").trim();
  throw new Error("Jeton Notion introuvable : NOTION_TOKEN, NOTION_TOKEN_FILE ou .dev/notion_token.");
}

const entetes = () => ({
  Authorization: `Bearer ${jeton()}`,
  "Notion-Version": "2025-09-03",
  "Content-Type": "application/json",
});

/* L'horloge de ce poste est réglée sur un autre fuseau et elle est en retard : une date de
   génération lue sur `new Date()` serait fausse. On garde l'en-tête `Date` renvoyé par le
   service, qui est la seule heure certaine de la chaîne. */
let dateService = "";
async function notion(chemin, init = {}) {
  const r = await fetch(`https://api.notion.com${chemin}`, { ...init, headers: entetes() });
  if (!dateService) dateService = r.headers.get("date") || "";
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Notion ${r.status} ${b?.code || ""} :: ${b?.message || ""}`);
  return b;
}

const txt = (p, n) => (p[n]?.rich_text || []).map((t) => t.plain_text).join("").trim();
const sel = (p, n) => p[n]?.select?.name || "";
const multi = (p, n) => (p[n]?.multi_select || []).map((o) => o.name);
const urlDe = (p, n) => p[n]?.url || "";
const jour = (p, n) => p[n]?.date?.start || "";

/* Une phrase entière plutôt qu'une coupe au mot près (même règle que la carte POSTCRAFT). */
function phrase(s, max) {
  const plat = String(s || "").replace(/\s+/g, " ").trim();
  if (!plat) return "";
  const fin = plat.search(/[.!?](\s|$)/);
  if (fin > -1 && fin + 1 <= max) return plat.slice(0, fin + 1);
  if (plat.length <= max) return plat;
  const coupe = plat.slice(0, max);
  const mot = coupe.lastIndexOf(" ");
  return (mot > 40 ? coupe.slice(0, mot) : coupe).replace(/[,;:.\-]$/, "") + "…";
}

/* Une, deux phrases maximum, jamais une coupe au milieu d'un mot : c'est la matière qui fait
   qu'une fiche a l'air d'un projet ou d'une idée. La limite haute est là pour la page A4, pas
   pour la langue ; une seule phrase plus longue que la limite retombe sur `phrase`. */
function passage(s, max) {
  const plat = String(s || "").replace(/\s+/g, " ").trim();
  if (!plat) return "";
  const phrases = plat.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [plat];
  let out = phrases[0].trim();
  if (phrases[1] && (out + " " + phrases[1].trim()).length <= max) out += " " + phrases[1].trim();
  return out.length <= max ? out : phrase(out, max);
}

/* — Liens : un lien mort sur un CV est une promesse non tenue, et la verification ne vaut
     rien si elle n'a pas lieu au moment ou le document se construit. Chaque URL affichee
     est donc demandee en reel pendant la generation : reponse < 400 apres redirections,
     une erreur reseau (nom inconnu, delai) comptant mort.
     Mesure du 28/10 sur les 12 URL du CV : 11 a 200, et le lien BusNaka
     https://narindra.pythonanywhere.com/ en 404 — la fiche sort du document, et le rapport
     le dit au lieu de la masquer. — */
async function sonde(url) {
  if (!url) return { ok: false, code: "aucune URL" };
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Mozilla/5.0 (verification de lien, CV)" },
    });
    return { ok: r.status < 400, code: r.status };
  } catch (e) {
    return { ok: false, code: e.name === "TimeoutError" ? "delai depasse" : e.cause?.code || e.message };
  }
}

/* — Selection : un CV se lit en trente secondes, les 14 fiches n'y tiennent pas, et la plus
     faible ferait baisser les autres. Le classement est une regle ecrite ici, pas un gout :
     matiere (longueur de la description reellement lue), mots-cles (nombre de technologies
     Notion), fraicheur (derniere activite vue), preuve (deux liens vivants mieux qu'un),
     recouvrement avec --cible quand elle est donnee. Chaque composante est normalisee sur
     les fiches candidates, et la note de chacune est imprimee dans le rapport : la selection
     se verifie, elle ne se devine pas. — */
const SANS_VIDEUR = new Set(["pour", "avec", "dans", "les", "des", "une", "sur", "par", "and", "the", "est", "que", "qui", "plus", "sans", "leur", "vous", "nous", "poste", "projet", "projets", "recherche", "developpeur", "developper", "fullstack", "stack", "mission"]);
const mots = (s) => [...new Set(String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9+#.]+/).filter((m) => m.length >= 4 && !SANS_VIDEUR.has(m)))];
const normalisateur = (valeurs) => {
  const min = Math.min(...valeurs), max = Math.max(...valeurs);
  return (v) => (max === min ? 1 : (v - min) / (max - min));
};

/* — Source 1 : le profil. On lit des rubriques, pas tout le fichier : une phrase de garde
     écrite pour Gemini n'a rien à faire sur un CV. — */
function rubriques(md) {
  const sorties = {};
  let courant = null;
  let derniere = -1;
  for (const ligne of md.split(/\r?\n/)) {
    const t = ligne.trim();
    if (t.startsWith("## ")) { courant = t.slice(3).trim(); sorties[courant] = []; derniere = -1; continue; }
    if (!courant) continue;
    if (t.startsWith("- ")) { sorties[courant].push(t.slice(2)); derniere = sorties[courant].length - 1; continue; }
    /* Une puce qui poursuit sa phrase sur la ligne suivante (c'est le cas du « Statut » et
       de trois puces de « Ce que je sais faire ») : sans cette règle le CV lirait la phrase
       coupée net, sans la suite. */
    if (t && ligne.startsWith(" ") && derniere >= 0) sorties[courant][derniere] += " " + t;
  }
  return sorties;
}
const MANQUANT = /à compléter/i;
const champ = (rub, section, cle) => {
  const ligne = (rub[section] || []).find((l) => l.toLowerCase().startsWith(cle.toLowerCase()));
  if (!ligne) return "";
  const valeur = ligne.slice(cle.length).replace(/^\s*:\s*/, "").trim();
  return MANQUANT.test(valeur) ? "" : valeur;
};
const trouvee = (rub, mot) => {
  /* La cle du fichier garde sa majuscule (« Contact », « Ce que je sais faire ») : comparer
     sans baisser le motif ne trouve jamais rien, et le CV perd la rubrique en silence. */
  const cle = Object.keys(rub).find((k) => k.toLowerCase().includes(String(mot).toLowerCase()));
  return cle ? (rub[cle] || []).filter((l) => !MANQUANT.test(l)) : [];
};
const cleDe = (l) => { const i = l.indexOf(":"); return i === -1 ? "" : l.slice(0, i).trim().toLowerCase(); };
/* Recolle le fichier hors version sur le profil public : une puce du privé remplace la puce
   du public qui porte la même étiquette (« Email », « Téléphone »), et s'ajoute si elle
   n'existe pas encore ; une rubrique absente du public est ajoutée telle quelle. Remplacer
   plutôt qu'ajouter est ce qui permet d'écrire « Email : à compléter » dans le dépôt sans
   voir deux lignes de contact dans le CV. */
function recolle(rub, privees) {
  let n = 0;
  for (const [section, lignes] of Object.entries(privees)) {
    const cle = Object.keys(rub).find((k) => {
      const a = k.toLowerCase(), b = section.toLowerCase();
      return a.includes(b) || b.includes(a);
    }) || section;
    rub[cle] = rub[cle] || [];
    for (const l of lignes) {
      const e = cleDe(l);
      const j = e ? rub[cle].findIndex((x) => cleDe(x) === e) : -1;
      if (j >= 0) { if (rub[cle][j] !== l) { rub[cle][j] = l; n++; } }
      else { rub[cle].push(l); n++; }
    }
  }
  return n;
}


/* — Source 2 : la base Projets. — */
async function fiches() {
  const lignes = [];
  let curseur = null;
  do {
    const r = await notion(`/v1/data_sources/${DS}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, ...(curseur ? { start_cursor: curseur } : {}) }),
    });
    for (const page of r.results || []) lignes.push({ id: page.id, p: page.properties });
    curseur = r.has_more ? r.next_cursor : null;
  } while (curseur);
  return lignes;
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const lisible = (d) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(d || ""));
  return m ? `${MOIS[Number(m[2]) - 1]} ${m[1]}` : "";
};
const MOIS_COURTS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/* Ligne de date du pied, à la française : « 28 octobre 2026 » depuis l'en-tête HTTP du
   service (l'horloge de ce poste est en retard et dans un autre fuseau, voir plus haut).
   L'en-tête HTTP est en anglais : la table est donc la sienne, et la sortie la nôtre. */
const dateDuJour = (enteteHttp) => {
  const m = /^\w+, (\d{1,2}) ([A-Za-z]{3,}) (\d{4})/.exec(String(enteteHttp || ""));
  if (!m) return "";
  /* Trois captures : jour = m[1], mois = m[2], année = m[3]. Compter un groupe de trop a
   * donné « 28 2026 undefined » sur le premier essai — la ligne se lisait donc à l'œil. */
  const index = MOIS_COURTS.indexOf(m[2].slice(0, 3).toLowerCase());
  return index === -1 ? `${m[1]} ${m[2]} ${m[3]}` : `${m[1]} ${MOIS[index]} ${m[3]}`;
};

function projet(f) {
  const p = f.p;
  /* Un lien de dépôt saisi avec le suffixe « .git » se colle tel quel dans Notion : dans un
     navigateur, l'URL ne s'ouvre pas. On le retire à la lecture, pour l'affichage et la cible. */
  const propre = (u) => String(u || "").replace(/\.git\/?$/i, "");
  const lien = propre(urlDe(p, "Lien Démo")) || propre(urlDe(p, "Lien GitHub"));
  const second = propre(urlDe(p, "Lien GitHub"));
  const matiere = txt(p, "Description") || txt(p, "Mission");
  const corps = passage(matiere, 300);
  return {
    nom: (p["Nom du projet"]?.title || []).map((t) => t.plain_text).join("").trim(),
    role: phrase(txt(p, "Rôle"), 90),
    categorie: sel(p, "Catégorie"),
    technologies: multi(p, "Technologies"),
    corps,
    /* La matière entière reste sous la main : la longueur affichée se décide à l'impression
       (une page ou deux), pas à la lecture de la base — sinon la note de sélection
       changerait selon le format demandé, et elle cesserait de mesurer les fiches. */
    matiere,
    lien,
    github: second && second !== lien ? second : "",
    debut: jour(p, "Date de création"),
    fin: jour(p, "Dernier commit vu"),
    statut: sel(p, "Statut Portfolio"),
  };
}

/* — Les paliers de mise en page, du plus aéré au plus serré, dans l'ordre où la boucle
   d'ajustement « une page » les essaie. Ce que chaque palier change et rien d'autre :
     budget   longueur maximale d'une description de projet (en caractères)
     technos  technologies affichées par fiche
     pile     true = la liste complète des compétences ; false = celles des fiches affichées
              seulement, parce qu'en une page vingt mots-clés dont la moitié ne porte aucun
              projet, c'est du remplissage pour un ATS et du bruit pour un humain
     css      marges d'impression, corps de texte, interligne, tailles de titres, blancs
   Le premier palier est le rendu « normal » à deux pages ; un CV demandé en une page part du
   deuxième et n'ouvre le suivant que si l'impression a mesuré un débordement. Rognier le
   contenu vient en dernier, après le plus serré des paliers. — */
const PALIERS = [
  {
    nom: "normal", budget: 300, technos: 6, pile: true,
    css: { page: "14mm 15mm", maxl: "186mm", pad: "6mm 4mm", corps: "10pt", inter: "1.42", h1: "19pt", h2: "11pt", h3: "10.5pt", m2: "4.5mm 0 1.5mm", m3: "3mm", mli: "1.4mm", meta: "9pt", mp: "1mm 0", m2ul: "1.5mm 0 0" },
  },
  {
    nom: "dense", budget: 200, technos: 5, pile: false,
    css: { page: "11mm 12mm", maxl: "188mm", pad: "5mm 3mm", corps: "9.4pt", inter: "1.3", h1: "17pt", h2: "10pt", h3: "9.8pt", m2: "2.6mm 0 1mm", m3: "1.6mm", mli: ".7mm", meta: "8.4pt", mp: ".6mm 0", m2ul: "1mm 0 0" },
  },
  {
    nom: "serré", budget: 175, technos: 4, pile: false,
    css: { page: "9mm 10mm", maxl: "190mm", pad: "4mm 2mm", corps: "8.9pt", inter: "1.24", h1: "15.5pt", h2: "9.5pt", h3: "9.2pt", m2: "2mm 0 .8mm", m3: "1.2mm", mli: ".5mm", meta: "8pt", mp: ".5mm 0", m2ul: ".8mm 0 0" },
  },
  {
    nom: "extrême", budget: 150, technos: 3, pile: false,
    css: { page: "8mm 9mm", maxl: "192mm", pad: "3mm 2mm", corps: "8.4pt", inter: "1.18", h1: "14.5pt", h2: "9pt", h3: "8.7pt", m2: "1.6mm 0 .6mm", m3: "1mm", mli: ".4mm", meta: "7.6pt", mp: ".4mm 0", m2ul: ".6mm 0 0" },
  },
];

async function main() {
  if (!existsSync(PROFIL)) throw new Error(`Profil introuvable : ${PROFIL}`);
  const rub = rubriques(readFileSync(PROFIL, "utf8"));
  /* Le contact privé n'est pas dans le dépôt : il s'ajoute ici, et nulle part ailleurs. */
  const privees = existsSync(PRIVE) ? rubriques(readFileSync(PRIVE, "utf8")) : null;
  const recollees = privees ? recolle(rub, privees) : 0;
  const manquants = [];
  const suivi = (cle, v) => { if (!v) manquants.push(cle); return v; };

  const tous = (await fiches()).map(projet);
  const publies = tous.filter((f) => f.statut === "Ajouté");
  const avecLien = flag("sans-lien") ? publies : publies.filter((f) => f.lien);
  const sansLien = publies.length - avecLien.length;

  /* Chaque lien est sondé avant d'engager le document. */
  const etats = await Promise.all(avecLien.map(async (f) => ({ lien: await sonde(f.lien), github: f.github ? await sonde(f.github) : null })));
  const vivants = [];
  const mortes = [];
  avecLien.forEach((f, i) => {
    const e = etats[i];
    if (e.lien.ok && (e.github === null || e.github.ok)) vivants.push(Object.assign(f, { etats: e }));
    else mortes.push({ f, e });
  });

  const cible = opt("cible", "");
  const motsCible = mots(cible);
  const dateDe = (f) => Date.parse(f.fin || f.debut || "") || 0;
  const nCar = normalisateur(vivants.map((f) => f.corps.length));
  const nTech = normalisateur(vivants.map((f) => f.technologies.length));
  const nJour = normalisateur(vivants.map(dateDe));
  for (const f of vivants) {
    /* `matiere` est le nom de la matière brute de la fiche : la composante de la note
       s'appelle scoreMatiere, sinon l'Object.assign écrase le texte dont le rendu a besoin
       et le CV se construit à partir d'un nombre. */
    const scoreMatiere = nCar(f.corps.length);
    const cles = nTech(f.technologies.length);
    const fraicheur = nJour(dateDe(f));
    const preuve = f.etats.github && f.etats.github.ok ? 1 : 0.6;
    const texte = `${f.technologies.join(" ")} ${f.categorie} ${f.role} ${f.corps}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const recouvre = motsCible.length ? motsCible.filter((m) => texte.includes(m)).length / motsCible.length : 0.5;
    Object.assign(f, { scoreMatiere, cles, fraicheur, preuve, recouvre });
    f.note = 0.3 * scoreMatiere + 0.25 * cles + 0.25 * fraicheur + 0.1 * preuve + 0.1 * recouvre;
  }
  vivants.sort((a, b) => b.note - a.note);
  /* Plafond de fiches affichées : six par défaut. En mode une page, ce n'est qu'un point de
     départ — la boucle d'ajustement, à la fin, retire les moins bien notées jusqu'à tenir. */
  const max = Number(opt("max", 6));

  /* Le stack se compte sur TOUTES les fiches publiées, pas seulement celles qu'on affiche :
     cinq projets ne racontent pas dix-huit technologies. Ce sont les noms du select Notion,
     donc la liste vérifiée, pas des mots collés par un modèle. */
  const freq = new Map();
  for (const f of publies) for (const t of f.technologies) freq.set(t, (freq.get(t) || 0) + 1);
  const stack = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, Number(opt("stack", 24))).map(([t]) => t);

  /* Avertissements sur la matière : le programme ne réécrit pas une source, il signale ce
     qui la rendrait mauvaise à lire. Trois règles mesurables, aucune opinion.
     « la description ne répète pas le nom du projet » n'en est pas une : une fiche dit
     « Application web de… », et c'est très bien. Ce qui cloche, c'est un nom de produit qui
     n'est pas celui de la fiche — d'où la liste des mots génériques qui ouvrent une phrase. */
  const OUVRANTS = /^(application|plateforme|bot|syst[eè]me|programme|solution|biblioth[eè]que|outil|service|site|logiciel|module|interface|extension|script|moteur|jeu|web|mobile|ce|cette|notre|mon)$/i;
  const avertissements = [];
  for (const f of vivants) {
    const premier = (f.corps || "").split(/[^A-Za-zÀ-ÿ'’-]+/)[0] || "";
    if (premier && !OUVRANTS.test(premier) && !f.corps.toLowerCase().includes(f.nom.toLowerCase()))
      avertissements.push(`${f.nom} : sa description s'ouvre sur « ${premier}… », qui n'est ni son nom ni un mot générique. Le lecteur croira à un autre produit.`);
    if (/\bnous\b/i.test(f.corps)) avertissements.push(`${f.nom} : sa description dit « nous », alors que le profil interdit le « nous » (travail solo).`);
    if (!f.technologies.length) avertissements.push(`${f.nom} : aucune technologie dans la fiche, rien à faire peser côté mots-clés.`);
  }
  /* Contradiction entre les deux sources : le profil dit « je travaille sur X » au présent,
     et la fiche X date de plus d'un an. L'un des deux se corrige — ce n'est pas au programme
     de trancher, mais le CV ne peut pas afficher Pass'io en tête et sa date de 2025. */
  const il_y_a_un_an = Date.parse(dateService || "") - 365 * 864e5;
  /* Lu directement à la source ici : la constante `statut` n'existe pas encore à cette
     ligne, et « Cannot access before initialization » est une erreur qui ne s'invente pas. */
  for (const mot of mots(champ(rub, "Identité", "Statut"))) {
    const f = vivants.find((x) => mots(x.nom).includes(mot));
    if (f && dateDe(f) && dateDe(f) < il_y_a_un_an)
      avertissements.push(`${f.nom} : le profil te dit dessus au présent, mais sa fiche porte une dernière activité en ${lisible(f.fin || f.debut)} : corrige la date, ou le classement écartera le projet phare.`);
  }

  const nom = champ(rub, "Identité", "Nom");
  const titreProfil = champ(rub, "Identité", "Titre que j'assume");
  const ville = champ(rub, "Identité", "Ville, fuseau");
  const statut = champ(rub, "Identité", "Statut");
  if (!titreProfil) manquants.push("titre professionnel");
  const contact = trouvee(rub, "Contact").map((l) => {
    const i = l.indexOf(":");
    return i === -1 ? null : { cle: l.slice(0, i).trim(), valeur: l.slice(i + 1).trim() };
  }).filter(Boolean);

  /* Deux des puces du profil sont des consignes écrites pour Gemini (« le script les lit
     dans le champ Technologies », « ne sont pas listés ici ») : ce sont des gardes, pas des
     compétences, et un lecteur de CV les lirait comme un Reste de prompt. */
  const savoirFaire = trouvee(rub, "sais faire").filter((l) => !/le script|pas listés ici|volontairement/i.test(l));

  /* Un renvoi à « la base Projets » est une note de travail : le lecteur n'a pas d'accès à
     ton Notion, et une parenthèse qu'il ne peut pas ouvrir affaiblit la phrase qui la porte. */
  if (/voir la base|base Projets/i.test(champ(rub, "Identité", "Statut")))
    avertissements.push("Profil : « (voir la base Projets) » est un renvoi interne à ton Notion, à retirer de data/profil-candidature.md, le lecteur ne peut pas l'ouvrir.");

  /* Rubriques du bas : elles ne sortent que si le profil les remplit. Le titre imprimé est
     celui qu'un ATS cherche (« Formation », « Expérience professionnelle », « Langues »),
     pas le libellé de notre fichier source. « Prétention » ne va pas dans le CV : un chiffre
     de salaire se négocie dans un échange, il ne se lit pas dans un document qui part en
     cent exemplaires — elle reste dans le profil et dans la lettre. */
  const blocs = [
    ["Formation", "Études / diplôme"],
    ["Expérience professionnelle", "Expérience en entreprise"],
    ["Langues", "Langues et niveau"],
    ["Mobilité", "Mobilité"],
  ];
  const aCompleter = [];
  const personnelles = [];
  for (const [titreCV, cleProfil] of blocs) {
    const ligne = Object.values(rub).flat().find((l) => l.toLowerCase().startsWith(cleProfil.toLowerCase()));
    /* La valeur commence APRÈS le premier « : » de la ligne, pas après la clé cherchée :
       le profil écrit « Expérience en entreprise (société, poste, période) : … », et découper
       à la longueur de la clé recollerait le libellé entre parenthèses dans le CV. */
    const deuxpoints = ligne ? ligne.indexOf(":") : -1;
    const valeur_ligne = deuxpoints === -1 ? "" : ligne.slice(deuxpoints + 1).trim();
    if (valeur_ligne && !MANQUANT.test(valeur_ligne)) personnelles.push([titreCV, valeur_ligne]);
    else aCompleter.push(cleProfil);
  }

  /* Ordre de lecture : un recruteur cherche d'abord l'expérience, et la formation vient
     après tout le reste. Quand le profil ne porte pas d'expérience, les projets la portent
     et rien ne bouge. */
  const avantProjets = personnelles.filter(([t]) => t === "Expérience professionnelle");
  const apresProjets = personnelles.filter(([t]) => t !== "Expérience professionnelle");

  if (!titreProfil) manquants.push("titre professionnel");
  if (!contact.length) manquants.push("contact (email, téléphone, liens)");
  const jourCV = dateDuJour(dateService);

  /* — Le document, construit pour un palier de mise en page donné. C'est la boucle
     d'ajustement plus bas qui choisit le palier et le nombre de fiches : le rendu imprimé
     décide de ce qui tient sur la page, pas un chiffre choisi la veille.
     Les titres de rubriques sont choisis pour un lecteur automatique : « Profil »,
     « Compétences », « Projets », « Formation », « Langues » sont les mots qu'un ATS
     cherche ; « Ce que je sais faire, prouvé par ce qui tourne » se lit très bien par un
     humain et se fait ignorer par une machine. Deuxième règle ATS : l'URL est écrite en
     clair dans le texte, pas planquée derrière un libellé — un parseur lit ce qui
     s'affiche, pas seulement l'attribut href. — */
  const construis = (n, pal = PALIERS[0]) => {
    const retenus = vivants.slice(0, n).sort((a, b) => dateDe(b) - dateDe(a));
    const L = [];
    L.push(`# ${majuscule(nom) || "Nom à compléter"}`);
    const ligne2 = [majuscule(titreProfil), ville].filter(Boolean).join(" · ");
    if (ligne2) L.push(ligne2);
    if (contact.length) {
      L.push("");
      L.push(contact.map((c) => {
        const v = c.valeur;
        const ecrite = /^https?:\/\//i.test(v) ? `[${domaine(v)}](${v})` : /@/.test(v) ? `[${v}](mailto:${v})` : v;
        return `${c.cle} : ${ecrite}`;
      }).join(" · "));
    }
    if (cible) L.push("", `**Objet : ${cible}**`);

    if (statut || savoirFaire.length) {
      L.push("", "## Profil", "");
      if (statut) L.push(majuscule(statut.replace(/\s+/g, " ")), "");
      for (const s of savoirFaire) L.push(`- ${s}`);
    }

    /* Compétences : la pile complète au palier normal, celles des fiches affichées seulement
       dans les paliers serrés (voir le commentaire de PALIERS). */
    const pile = pal.pile ? stack : [...new Set(retenus.flatMap((f) => f.technologies))];
    if (pile.length) L.push("", "## Compétences", "", pile.join(" · "));

    for (const [titreCV, valeur] of avantProjets) L.push("", `## ${titreCV}`, "", valeur);

    if (retenus.length) {
      L.push("", "## Projets", "");
      /* Phrase lisible par un humain : « vérifiés à la génération » se dit dans un rapport de
         programme, pas dans un document qui se signe. */
      L.push(`${retenus.length} projets présentés sur ${publies.length} publiés et consultables en ligne, retenus pour leur activité récente et la matière qu'ils apportent.`);
      for (const f of retenus) {
        const periode = [lisible(f.debut), lisible(f.fin)].filter(Boolean).join(" – ");
        const meta = [f.role, f.categorie, periode].filter(Boolean).join(" · ");
        const corps = passage(f.matiere, pal.budget);
        L.push("", `### ${f.nom}`);
        if (meta) L.push(`*${meta}*`);
        if (corps) L.push(corps);
        const technos = f.technologies.slice(0, pal.technos).join(" · ");
        const liens = [f.lien && `[${domaine(f.lien)}](${f.lien})`, f.github && `[Code : ${domaine(f.github)}](${f.github})`].filter(Boolean);
        const pied = [technos && `**${technos}**`, ...liens].filter(Boolean);
        if (pied.length) L.push(pied.join(" · "));
      }
    }

    for (const [titreCV, valeur] of apresProjets) L.push("", `## ${titreCV}`, "", valeur);

    /* Pas de « Antananarivo, le 28 octobre 2026 » en pied de CV : c'est une convention de
       lettre, et une ville suivie d'une date isolée se fait lire par un parseur comme une
       expérience sans intitulé. La date de génération reste dans le rapport.
       Et le document repasse par `sansTiretLong` : le tiret long est la signature d'un texte
       de machine, il n'entre pas dans un document qui se signe, même quand une source Notion
       en porte un. */
    const { texte, remplaces } = sansTiretLong(L.join("\n") + "\n");
    return { markdown: texte, ligne2, retenus, tirets: remplaces };
  };

  let n = max;
  /* Le premier essai se fait toujours au palier le plus aéré, y compris en mode « une page » :
     si le CV tient serré sans qu'on le lui demande, autant garder la version lisible. Ce
     n'est pas le drapeau qui décrète la densité, c'est le nombre de pages mesuré. — */
  let pal = 0;
  let { markdown, ligne2, retenus, tirets } = construis(n, PALIERS[pal]);

  const detailNote = (f) => `${f.nom} ${f.note.toFixed(2)} (matière ${Math.round(f.scoreMatiere * 100)}, ${f.technologies.length} technos, ${lisible(f.fin || f.debut) || "sans date"})`;
  /* Le rapport se lit sur le document FINAL : la boucle d'ajustement retire des fiches, un
     rapport figé avant l'impression annoncerait des projets qui ne sont plus dans le PDF. */
  const rapportDe = (ret) => [
    `${tous.length} fiches lues dans la base, ${publies.length} avec « Statut Portfolio = Ajouté », ${avecLien.length} avec un lien public, ${vivants.length} dont le lien répond, ${ret.length} retenues (${PALIERS[pal].nom}, ${n} fiches affichées).`,
    mortes.length ? `Écartées, lien mort mesuré à la génération : ${mortes.map((m) => `${m.f.nom} (${domaine(m.f.lien)} → ${m.e.lien.code})`).join(", ")}.` : "Tous les liens affichés répondent.",
    sansLien ? `${sansLien} projet(s) publié(s) sans URL publique écartés (--sans-lien pour les garder) : le CV ne montre que ce qu'un lecteur peut ouvrir.` : "",
    vivants.length > ret.length ? `Non affichées, classées après : ${vivants.slice(ret.length).map((f) => f.nom).join(", ")}.` : "",
    `Notes de sélection : ${vivants.map(detailNote).join(" · ")}.`,
    avertissements.length ? `À corriger dans Notion, le programme ne réécrit aucune source :\n  - ${avertissements.join("\n  - ")}` : "",
    aCompleter.length ? `Rubriques absentes faute de source : ${aCompleter.join(", ")}.` : "Toutes les rubriques personnelles ont une source remplie.",
    contact.length ? "" : "Contact absent : le CV n'a ni email ni téléphone, et sans l'un des deux un ATS ne peut même pas identifier le candidat. À écrire dans data/profil-prive.md (hors dépôt, le dépôt est public), rubrique Contact.",
    privees ? `Contact relu dans ${relative(RACINE, PRIVE)} : ${contact.length} ligne(s) affichée(s), dont ${recollees} venue(s) du fichier hors version.`
      : `Attention : ${relative(RACINE, PRIVE)} est absent, le CV ne peut pas afficher d'email ni de téléphone (ils ne vivent pas dans le dépôt public).`,
    manquants.length ? `Également absent faute de source : ${manquants.join(", ")}.` : "",
    tirets ? `${tirets} tiret(s) long(s) retiré(s) des sources, le document n'en porte aucun.` : "Aucun tiret long dans le document, ni écrit par le programme ni repris des sources.",
    `Aucun nombre, diplôme ou société n'a été ajouté par le programme (généré le ${jourCV || "date indisponible"}${cible ? `, cible : « ${cible} »` : ", aucune cible : --cible augmente le poids des fiches qui y correspondent"}).`,
  ].filter(Boolean);

  if (flag("sec")) { console.log(rapportDe(retenus).join("\n")); return; }

  if (!flag("ecrire")) {
    console.log(markdown);
    console.log("\n--- rapport ---\n" + rapportDe(retenus).join("\n"));
    console.log("\nRien n'a été écrit : ajoutez --ecrire pour produire cv/cv.md, cv/cv.txt et cv/cv.html (--pdf pour le A4).");
    return;
  }

  mkdirSync(DOSSIER, { recursive: true });
  const ecris = (md, lg, p) => {
    writeFileSync(join(DOSSIER, "cv.md"), md);
    /* Le même contenu sans aucune mise en forme : certains portails n'avalent que du texte
       brut, et c'est le format qui ne peut pas se parser de travers. */
    writeFileSync(join(DOSSIER, "cv.txt"), brut(md));
    writeFileSync(join(DOSSIER, "cv.html"), html(md, { nom, ligne2: lg, contact, palier: p }));
  };

  /* — Ajustement à la page : le programme ne croit pas tenir sur une page, il le mesure. Il
     imprime, lit le nombre de pages du PDF, et en cas de débordement il serre la typographie
     jusqu'au PLANCHER de lisibilité ; au-delà, ce n'est plus la police qui paye, c'est une
     fiche rendue (la moins bien notée), jusqu'à trois projets — en dessous, le document n'est
     plus un CV et il vaut mieux deux pages. Dernier serrage seulement quand il ne reste rien
     à rendre : 8,4 pt sur six fiches, ça se lit, mais une fiche de moins se lit mieux.
     C'est la seule façon honnête de promettre « une page » : le jour où tu remplis email,
     études et langues, le document grandit, et la boucle serre ou rend une fiche au lieu de
     déborder sur la page suivante. — */
  const PLANCHER = PALIERS.findIndex((p) => p.nom === "serré");
  const essais = [];
  let pdf = { raison: "impression non demandée" };
  ecris(markdown, ligne2, PALIERS[pal]);
  if (flag("pdf")) {
    pdf = imprimeEnPdf(DOSSIER, nom);
    while (flag("une-page") && pdf.pages > 1) {
      essais.push(`${PALIERS[pal].nom}/${n} fiches → ${pdf.pages} pages`);
      if (pal < PLANCHER) pal += 1;
      else if (n > 3) n -= 1;
      else if (pal < PALIERS.length - 1) pal += 1;
      else break;
      ({ markdown, ligne2, retenus, tirets } = construis(n, PALIERS[pal]));
      ecris(markdown, ligne2, PALIERS[pal]);
      pdf = imprimeEnPdf(DOSSIER, nom);
    }
  }

  console.log(markdown);
  console.log("\n--- rapport ---\n" + rapportDe(retenus).join("\n"));
  console.log(`\nÉcrit : ${["cv.md", "cv.txt", "cv.html"].map((f) => join(DOSSIER, f)).join("\nÉcrit : ")}`);
  if (essais.length) {
    /* On ne nomme que les fiches rendues PAR la boucle : celles déjà écartées par --max
       n'ont rien à voir avec la mise en page. */
    const rendues = vivants.slice(n, max).map((f) => f.nom);
    console.log(`   ajusté pour tenir sur une page : ${essais.join(" · ")} → ${PALIERS[pal].nom}/${n} fiches → ${pdf.pages} page${pdf.pages > 1 ? "s" : ""}`
      + (rendues.length ? `, fiches retirées par l'ajustement : ${rendues.join(", ")}` : ""));
  } else if (flag("une-page") && pdf.pages) {
    console.log(`   une page tenue dès le premier essai : ${PALIERS[pal].nom}/${n} fiches → ${pdf.pages} page`);
  }
  if (!flag("pdf")) {
    console.log(flag("une-page")
      ? "Le « une page » n'est pas mesuré sans --pdf : l'ajustement se joue à l'impression. relance avec --ecrire --pdf --une-page."
      : "Ctrl+P sur cv/cv.html → « Enregistrer en PDF », format A4 (ou ajoute --pdf pour l'imprimer ici).");
  } else {
    console.log(pdf.sortie
      ? `Écrit : ${pdf.sortie}\n   ${pdf.pages} page${pdf.pages > 1 ? "s" : ""}, ${pdf.format}, ${pdf.texte ? "texte sélectionnable (parseable par un ATS)" : "ATTENTION : aucun texte vectoriel détecté"}`
      : `PDF non produit : ${pdf.raison}\nCtrl+P sur cv/cv.html → « Enregistrer en PDF » donne le même A4.`);
  }
  console.log("Rappel : le dossier cv/ est ignoré par git, un CV n'a rien à faire dans un dépôt public.");
}

/* Markdown -> texte brut : les marqueurs de mise en forme tombent, le contenu reste dans le
   même ordre. Les URL gardent leur forme lisible (le texte du lien était déjà l'URL). */
const brut = (md) => String(md)
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, u) => (/^https?:/.test(u) && t === domaine(u) ? u : t))
  .replace(/\*\*([^*]+)\*\*/g, "$1")
  .replace(/\*([^*]+)\*/g, "$1")
  .replace(/`([^`]+)`/g, "$1")
  .replace(/^## (.+)$/gm, (m, t) => t.toUpperCase())
  .replace(/^#{1,3} /gm, "")
  .replace(/\s+\n/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim() + "\n";

/* Impression A4 par le navigateur local, en mode sans interface : 0 €, 0 dépendance à
   installer, et le PDF obtenu est celui que le navigateur produirait au Ctrl+P de l'humain.
   Le nom du fichier porte le nom du candidat — un ATS garde « CV.pdf » sans savoir à qui il
   va. Retourne le chemin écrit, ou la raison pour laquelle il n'y est pas arrivé. */
const NAVIGATEURS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];
function imprimeEnPdf(dossier, nom) {
  const navigateur = NAVIGATEURS.find((c) => existsSync(c));
  if (!navigateur) return { raison: "ni Chrome ni Edge trouvé à un emplacement standard" };
  const sortie = join(dossier, `CV-${String(nom || "candidat").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}.pdf`);
  const r = spawnSync(navigateur, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--print-to-pdf=${resolve(sortie)}`, "--no-pdf-header-footer",
    pathToFileURL(join(dossier, "cv.html")).href,
  ], { encoding: "utf8", timeout: 120000 });
  if (!existsSync(sortie)) return { raison: `le navigateur n'a rien écrit (${(r.stderr || "").trim().slice(0, 160) || `code ${r.status}`})` };
  /* Le nombre de pages et la MediaBox se lisent dans le fichier : c'est la preuve que le
     @page A4 est honoré, pas l'espoir qu'il le soit. Et c'est ce compte qui pilote la
     boucle d'ajustement « une page » ci-dessus. */
  const binaire = readFileSync(sortie).toString("latin1");
  const pages = (binaire.match(/\/Type\s*\/Page[^s]/g) || []).length;
  const boite = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/.exec(binaire);
  const format = boite ? `${Math.round((Number(boite[1]) / 72) * 25.4)} × ${Math.round((Number(boite[2]) / 72) * 25.4)} mm` : "format inconnu";
  const texte = /ToUnicode/.test(binaire);
  return { sortie, pages, format, texte };
}

const domaine = (u) => {
  const brut = String(u || "").replace(/^https?:\/\//, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  const [hote, ...chemin] = brut.split("/");
  const plateforme = /^(github|gitlab|bitbucket)\.com$/i.test(hote);
  return plateforme && chemin.length ? `${hote}/${chemin.join("/")}` : hote;
};

/* Mise en forme, pas rédaction : une phrase du profil commence par « je », elle se lit mieux
   en tête de rubrique avec sa majuscule. Aucun mot n'est ajouté ni retiré. */
const majuscule = (s) => String(s || "").replace(/^(\p{L})/u, (m) => m.toUpperCase());

/* Le tiret long « — » est la marque de fabrique d'un texte écrit par une machine : un humain
   qui rédige un CV fait une phrase, ou met une virgule. Le programme ne l'emploie donc
   nulle part, et il le retire aussi des sources (une Description Notion peut en porter un).
   Deux cas, jamais de suppression sèche qui collerait deux mots : l'incise devient une virgule,
   le tiret isolé devient un trait d'union simple. Le « – » des plages de dates (août 2026 –
   octobre 2026) n'est pas le même caractère et reste. Retourne le texte nettoyé et le nombre
   de remplacements, pour que le rapport puisse le dire plutôt que le promettre. */
function sansTiretLong(s) {
  const avant = String(s ?? "");
  const apres = avant
    .replace(/[ \t]+—[ \t]+/g, ", ")
    .replace(/[ \t]*—[ \t]*/g, " - ");
  return { texte: apres, remplaces: (avant.match(/—/g) || []).length };
}

/* Échappement : le texte vient de Notion, un « < » isolé ne doit pas casser la page. */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* Markdown -> HTML : le CV reste un fichier texte relisible et diffable, la page n'est que
   sa mise en page A4. Le converti est fait ici, volontairement : pas de dépendance à
   installer, et une grammaire limitée à ce que le générateur produit réellement. */
function html(md, meta) {
  const lignes = md.split("\n");
  const corps = [];
  let liste = false;
  let section = false;
  const fermeSection = (l) => {
    if (section && (/^# |^## /.test(l) || /^---+$/.test(l.trim()))) { corps.push("</section>"); section = false; }
  };
  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  for (const l of lignes) {
    if (/^- /.test(l.trim())) {
      if (!liste) { corps.push("<ul>"); liste = true; }
      corps.push(`<li>${inline(l.trim().slice(2))}</li>`);
      continue;
    }
    if (liste) { corps.push("</ul>"); liste = false; }
    fermeSection(l);
    /* Un projet = un bloc solidaire. Sans cette enveloppe, une page peut se couper entre le
       nom et sa première ligne, ou laisser trois paragraphes orphelins en bas de page. */
    if (/^# /.test(l)) corps.push(`<h1>${inline(l.slice(2))}</h1>`);
    else if (/^### /.test(l)) {
      if (section) { corps.push("</section>"); }
      section = true;
      corps.push(`<section class="projet"><h3>${inline(l.slice(4))}</h3>`);
    }
    else if (/^## /.test(l)) corps.push(`<h2>${inline(l.slice(3))}</h2>`);
    else if (/^---+$/.test(l.trim())) corps.push("<hr>");
    else if (l.trim()) corps.push(`<p>${inline(l)}</p>`);
  }
  if (liste) corps.push("</ul>");
  if (section) corps.push("</section>");
  /* Une seule structure pour tous les paliers : la densité ne touche que les blancs, le corps
     de texte et la longueur des descriptions, jamais l'ordre ni les titres de rubriques — un
     CV qui change de plan selon le bouton choisi se relit mal et se parse encore plus mal. */
  const t = (meta.palier || PALIERS[0]).css;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="author" content="${esc(meta.nom || "")}">
<meta name="description" content="CV de ${esc(meta.ligne2 || "")}">
<title>CV de ${esc(meta.nom || "")}</title>
<style>
  @page { size: A4; margin: ${t.page}; }
  :root { --encre: #14181d; --doux: #4b5560; --filet: #d7dbe0; --accent: #1f5c8b; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: ${t.maxl}; padding: ${t.pad}; color: var(--encre);
    font: ${t.corps}/${t.inter} "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  h1 { font-size: ${t.h1}; margin: 0 0 1mm; }
  h2 { font-size: ${t.h2}; margin: ${t.m2}; padding-bottom: .8mm; color: var(--accent);
    border-bottom: .3mm solid var(--filet); text-transform: uppercase; }
  /* Pas de letter-spacing sur les titres : le nom du candidat en porte un, lui se lit bien.
     Mesuré le 28/10 sur le PDF imprimé, un interlettre de 0,35 mm fait découper « PROFIL » en
     « P RO F I L » à l'extraction du texte. Or un ATS matche les mots de rubrique (« Profil »,
     « Expérience », « Formation », « Langues ») sur le texte extrait : un titre espacé, c'est
     une rubrique qu'il ne voit pas. La majuscule et le filet suffisent à l'air du document. */
  /* Le nom du projet est un sous-titre, pas une puce : il reste collé à sa première ligne
     quand la page se coupe (break-after: avoid), sinon un titre orphelin clôt la page. */
  h3 { font-size: ${t.h3}; margin: 0; color: var(--encre); break-after: avoid; }
  /* Le projet est un bloc solidaire : jamais coupé entre deux pages, l'espace vient du
     bloc, pas du titre. */
  .projet { break-inside: avoid; margin-top: ${t.m3}; }
  h3 + p em { color: var(--doux); font-size: ${t.meta}; }
  p { margin: ${t.mp}; orphans: 2; widows: 2; }
  ul { margin: ${t.m2ul} 0 0; padding-left: 5mm; }
  li { margin: 0 0 ${t.mli}; }
  a { color: var(--accent); text-decoration: none; }
  em { color: var(--doux); font-style: normal; font-size: ${t.meta}; }
  hr { border: 0; border-top: .3mm solid var(--filet); margin: 5mm 0 2mm; }
  hr + p { color: var(--doux); font-size: 8.5pt; }
  h1 + p { color: var(--doux); }
  li > em:first-child { display: inline; }
  @media print {
    body { max-width: none; padding: 0; }
    h2 { break-after: avoid-page; }
    li { break-inside: avoid; }
    a { color: var(--encre); }
  }
</style>
</head>
<body>
<main>
${corps.join("\n")}
</main>
</body>
</html>
`;
}

main().catch((e) => { console.error("ERREUR :", e.message); process.exit(1); });
