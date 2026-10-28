/* Mini-programme de CV : il régénère un CV à partir de ce qui est VRAI, c'est-à-dire de
   deux sources seulement — `data/profil-candidature.md` (les faits personnels que tu as
   écrits toi-même) et la base Notion « Projets » (ce qui tourne, avec ses technologies).

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
     node scripts/cv.mjs --cible "Développeur fullstack, mission data"
     node scripts/cv.mjs --max 6                  -> nombre de projets affichés (défaut 6)
     node scripts/cv.mjs --sans-lien              -> garde les projets sans URL publique
     node scripts/cv.mjs --sec                    -> n'affiche que le rapport (manquants, tri)

   Variables : NOTION_TOKEN / NOTION_TOKEN_FILE / NOTION_DS (mêmes que le flux A).
   Le dossier cv/ est ignoré par git : un CV porte des coordonnées personnelles, il n'a
   rien à faire dans un dépôt public ni sur le site.
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DS = process.env.NOTION_DS || "78e87c8c-4916-4d46-8cd2-00b0bcd471fa";
/* Le profil reste la source unique ; CV_PROFIL permet de tester une variante (ou de
   préparer un CV pour une cible précise) sans toucher au fichier autorisé du dépôt. */
const PROFIL = process.env.CV_PROFIL || join(RACINE, "data", "profil-candidature.md");
const DOSSIER = join(RACINE, "cv");

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
  const corps = passage(txt(p, "Description") || txt(p, "Mission"), 300);
  return {
    nom: (p["Nom du projet"]?.title || []).map((t) => t.plain_text).join("").trim(),
    role: phrase(txt(p, "Rôle"), 90),
    categorie: sel(p, "Catégorie"),
    technologies: multi(p, "Technologies"),
    corps,
    lien,
    github: second && second !== lien ? second : "",
    debut: jour(p, "Date de création"),
    fin: jour(p, "Dernier commit vu"),
    statut: sel(p, "Statut Portfolio"),
  };
}

async function main() {
  if (!existsSync(PROFIL)) throw new Error(`Profil introuvable : ${PROFIL}`);
  const rub = rubriques(readFileSync(PROFIL, "utf8"));
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
    const matiere = nCar(f.corps.length);
    const cles = nTech(f.technologies.length);
    const fraicheur = nJour(dateDe(f));
    const preuve = f.etats.github && f.etats.github.ok ? 1 : 0.6;
    const texte = `${f.technologies.join(" ")} ${f.categorie} ${f.role} ${f.corps}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const recouvre = motsCible.length ? motsCible.filter((m) => texte.includes(m)).length / motsCible.length : 0.5;
    Object.assign(f, { matiere, cles, fraicheur, preuve, recouvre });
    f.note = 0.3 * matiere + 0.25 * cles + 0.25 * fraicheur + 0.1 * preuve + 0.1 * recouvre;
  }
  vivants.sort((a, b) => b.note - a.note);
  /* Six, pas quatorze, et pas cinq non plus : mesuré le 28/10, cinq fiches laissent une
     seconde page remplie au quart — un document qui s'arrête au tiers de sa dernière page
     fait inachevé. Six remplissent les deux pages sans les forcer. */
  const max = Number(opt("max", 6));
  const retenus = vivants.slice(0, max);
  /* Le CV se lit du haut : parmi les retenus, le plus récent d'abord, la note ne sert qu'à
     décider qui entre. */
  retenus.sort((a, b) => dateDe(b) - dateDe(a));

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
      avertissements.push(`${f.nom} : sa description s'ouvre sur « ${premier}… », qui n'est ni son nom ni un mot générique — le lecteur croira à un autre produit.`);
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
      avertissements.push(`${f.nom} : le profil te dit dessus au présent, mais sa fiche porte une dernière activité en ${lisible(f.fin || f.debut)} — corrige la date, ou le classement écartera le projet phare.`);
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
    avertissements.push("Profil : « (voir la base Projets) » est un renvoi interne à ton Notion — à retirer de data/profil-candidature.md, le lecteur ne peut pas l'ouvrir.");

  /* — Le document. Les titres de rubriques sont choisis pour un lecteur automatique :
     « Profil », « Compétences », « Projets », « Formation », « Langues » sont les mots
     qu'un ATS cherche ; « Ce que je sais faire, prouvé par ce qui tourne » se lit très bien
     par un humain et se fait ignorer par une machine. Deuxieme regle ATS : l'URL est ecrite
     en clair dans le texte, pas planquee derriere un libelle — un parseur lit ce qui
     s'affiche, pas seulement l'attribut href. — */
  const L = [];
  L.push(`# ${majuscule(nom) || "Nom à compléter"}`);
  const ligne2 = [majuscule(suivi("titre professionnel", titreProfil)), ville].filter(Boolean).join(" — ");
  if (ligne2) L.push(ligne2);
  if (contact.length) {
    L.push("");
    L.push(contact.map((c) => {
      const v = c.valeur;
      const ecrite = /^https?:\/\//i.test(v) ? `[${domaine(v)}](${v})` : /@/.test(v) ? `[${v}](mailto:${v})` : v;
      return `${c.cle} : ${ecrite}`;
    }).join(" · "));
  } else manquants.push("contact (email, téléphone, liens)");
  if (cible) L.push("", `**Objet : ${cible}**`);

  if (statut || savoirFaire.length) {
    L.push("", "## Profil", "");
    if (statut) L.push(majuscule(statut.replace(/\s+/g, " ")), "");
    for (const s of savoirFaire) L.push(`- ${s}`);
  }

  if (stack.length) L.push("", "## Compétences", "", stack.join(" · "));

  if (retenus.length) {
    L.push("", "## Projets", "");
    /* Phrase lisible par un humain : « vérifiés à la génération » se dit dans un rapport de
       programme, pas dans un document qui se signe. */
    L.push(`${retenus.length} projets présentés sur ${publies.length} publiés et consultables en ligne, retenus pour leur activité récente et la matière qu'ils apportent.`);
    /* Un bloc par projet plutôt qu'une liste à puces imbriquées : le nom devient un
       sous-titre, le lecteur saute de projet en projet, et le convertisseur HTML n'a pas à
       gérer deux niveaux de liste. */
    for (const f of retenus) {
      const periode = [lisible(f.debut), lisible(f.fin)].filter(Boolean).join(" – ");
      const meta = [f.role, f.categorie, periode].filter(Boolean).join(" · ");
      L.push("", `### ${f.nom}`);
      if (meta) L.push(`*${meta}*`);
      if (f.corps) L.push(f.corps);
      const technos = f.technologies.slice(0, 6).join(" · ");
      const liens = [f.lien && `[${domaine(f.lien)}](${f.lien})`, f.github && `[Code : ${domaine(f.github)}](${f.github})`].filter(Boolean);
      const pied = [technos && `**${technos}**`, ...liens].filter(Boolean);
      if (pied.length) L.push(pied.join(" — "));
    }
  }

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
  for (const [titreCV, cleProfil] of blocs) {
    const ligne = Object.values(rub).flat().find((l) => l.toLowerCase().startsWith(cleProfil.toLowerCase()));
    /* La valeur commence APRÈS le premier « : » de la ligne, pas après la clé cherchée :
       le profil écrit « Expérience en entreprise (société, poste, période) : … », et découper
       à la longueur de la clé recollerait le libellé entre parenthèses dans le CV. */
    const deuxpoints = ligne ? ligne.indexOf(":") : -1;
    const valeur_ligne = deuxpoints === -1 ? "" : ligne.slice(deuxpoints + 1).trim();
    if (valeur_ligne && !MANQUANT.test(valeur_ligne)) {
      L.push("", `## ${titreCV}`, "", valeur_ligne);
    } else aCompleter.push(cleProfil);
  }

  /* Pas de « Antananarivo, le 28 octobre 2026 » en pied de CV : c'est une convention de
     lettre, et une ville suivie d'une date isolée se fait lire par un parseur comme une
     expérience sans intitulé. La date de génération reste dans le rapport. */
  const jourCV = dateDuJour(dateService);

  /* La provenance ne va PAS dans le CV : un document qu'on envoie ne se justifie pas
     d'avoir été généré. Elle est imprimée dans le rapport, et le CV se termine sur sa
     dernière rubrique. */
  const markdown = L.join("\n") + "\n";

  const detailNote = (f) => `${f.nom} ${f.note.toFixed(2)} (matière ${Math.round(f.matiere * 100)}, ${f.technologies.length} technos, ${lisible(f.fin || f.debut) || "sans date"})`;
  const rapport = [
    `${tous.length} fiches lues dans la base, ${publies.length} avec « Statut Portfolio = Ajouté », ${avecLien.length} avec un lien public, ${vivants.length} dont le lien répond, ${retenus.length} retenues (--max ${max}).`,
    mortes.length ? `Écartées, lien mort mesuré à la génération : ${mortes.map((m) => `${m.f.nom} (${domaine(m.f.lien)} → ${m.e.lien.code})`).join(", ")}.` : "Tous les liens affichés répondent.",
    sansLien ? `${sansLien} projet(s) publié(s) sans URL publique écartés (--sans-lien pour les garder) : le CV ne montre que ce qu'un lecteur peut ouvrir.` : "",
    vivants.length > max ? `Non affichées, classées après : ${vivants.slice(max).map((f) => f.nom).join(", ")}.` : "",
    `Notes de sélection : ${vivants.map(detailNote).join(" · ")}.`,
    avertissements.length ? `À corriger dans Notion, le programme ne réécrit aucune source :\n  - ${avertissements.join("\n  - ")}` : "",
    aCompleter.length ? `Rubriques absentes faute de source : ${aCompleter.join(", ")}.` : "Toutes les rubriques personnelles ont une source remplie.",
    contact.length ? "" : "Contact absent : le CV n'a ni email ni téléphone — sans l'un des deux, un ATS ne peut même pas identifier le candidat. À écrire dans data/profil-candidature.md, rubrique Contact.",
    manquants.length ? `Également absent faute de source : ${manquants.join(", ")}.` : "",
    `Aucun nombre, diplôme ou société n'a été ajouté par le programme (généré le ${jourCV || "date indisponible"}${cible ? `, cible : « ${cible} »` : ", aucune cible : --cible augmente le poids des fiches qui y correspondent"}).`,
  ].filter(Boolean);

  if (flag("sec")) { console.log(rapport.join("\n")); return; }
  console.log(markdown);
  console.log("\n--- rapport ---\n" + rapport.join("\n"));

  if (!flag("ecrire")) { console.log("\nRien n'a été écrit : ajoutez --ecrire pour produire cv/cv.md, cv/cv.txt et cv/cv.html (--pdf pour le A4)."); return; }
  mkdirSync(DOSSIER, { recursive: true });
  const ecrits = [];
  writeFileSync(join(DOSSIER, "cv.md"), markdown); ecrits.push("cv.md");
  /* Le même contenu sans aucune mise en forme : certains portails n'avalent que du texte
     brut, et c'est le format qui ne peut pas se parser de travers. */
  writeFileSync(join(DOSSIER, "cv.txt"), brut(markdown)); ecrits.push("cv.txt");
  writeFileSync(join(DOSSIER, "cv.html"), html(markdown, { nom, ligne2, contact, rapport })); ecrits.push("cv.html");
  console.log(`\nÉcrit : ${ecrits.map((f) => join(DOSSIER, f)).join("\nÉcrit : ")}`);
  if (flag("pdf")) {
    const pdf = imprimeEnPdf(DOSSIER, nom);
    console.log(typeof pdf === "string" ? `Écrit : ${pdf}` : `PDF non produit : ${pdf.raison}\nCtrl+P sur cv/cv.html → « Enregistrer en PDF » donne le même A4.`);
  } else {
    console.log("Ctrl+P sur cv/cv.html → « Enregistrer en PDF », format A4 (ou ajoute --pdf pour l'imprimer ici).");
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
     @page A4 est honoré, pas l'espoir qu'il le soit. */
  const binaire = readFileSync(sortie).toString("latin1");
  const pages = (binaire.match(/\/Type\s*\/Page[^s]/g) || []).length;
  const boite = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/.exec(binaire);
  const format = boite ? `${Math.round((Number(boite[1]) / 72) * 25.4)} × ${Math.round((Number(boite[2]) / 72) * 25.4)} mm` : "format inconnu";
  console.log(`   ${pages} page(s), ${format}${/ToUnicode/.test(binaire) ? ", texte sélectionnable (parseable par un ATS)" : ", ATTENTION : aucun texte vectoriel détecté"}`);
  return sortie;
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
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="author" content="${esc(meta.nom || "")}">
<meta name="description" content="CV — ${esc(meta.ligne2 || "")}">
<title>CV — ${esc(meta.nom || "")}</title>
<style>
  @page { size: A4; margin: 14mm 15mm; }
  :root { --encre: #14181d; --doux: #4b5560; --filet: #d7dbe0; --accent: #1f5c8b; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 180mm; padding: 10mm 6mm; color: var(--encre);
    font: 10pt/1.42 "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  h1 { font-size: 19pt; margin: 0 0 1mm; letter-spacing: .2mm; }
  h2 { font-size: 11pt; margin: 4.5mm 0 1.5mm; padding-bottom: .8mm; color: var(--accent);
    border-bottom: .3mm solid var(--filet); text-transform: uppercase; letter-spacing: .35mm; }
  /* Le nom du projet est un sous-titre, pas une puce : il reste collé à sa première ligne
     quand la page se coupe (break-after: avoid), sinon un titre orphelin clôt la page. */
  h3 { font-size: 10.5pt; margin: 0; color: var(--encre); break-after: avoid; }
  /* Le projet est un bloc solidaire : jamais coupé entre deux pages, l'espace vient du
     bloc, pas du titre. */
  .projet { break-inside: avoid; margin-top: 3mm; }
  h3 + p em { color: var(--doux); font-size: 9pt; }
  p { margin: 1mm 0; orphans: 2; widows: 2; }
  ul { margin: 1.5mm 0 0; padding-left: 5mm; }
  li { margin: 0 0 1.4mm; }
  a { color: var(--accent); text-decoration: none; }
  em { color: var(--doux); font-style: normal; font-size: 9.5pt; }
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
