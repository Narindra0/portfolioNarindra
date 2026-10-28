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
     - il ne liste un projet que s'il a un lien public à montrer, sauf `--sans-lien`.

   Usages :
     node scripts/cv.mjs                          -> affiche le Markdown sur stdout, rien n'est écrit
     node scripts/cv.mjs --ecrire                 -> écrit cv/cv.md et cv/cv.html
     node scripts/cv.mjs --cible "Développeur fullstack, mission data"
     node scripts/cv.mjs --max 6                  -> nombre de projets affichés (défaut 8)
     node scripts/cv.mjs --sans-lien              -> garde les projets sans URL publique
     node scripts/cv.mjs --sec                    -> n'affiche que le rapport (manquants, tri)

   Variables : NOTION_TOKEN / NOTION_TOKEN_FILE / NOTION_DS (mêmes que le flux A).
   Le dossier cv/ est ignoré par git : un CV porte des coordonnées personnelles, il n'a
   rien à faire dans un dépôt public ni sur le site.
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  const corps = phrase(txt(p, "Description") || txt(p, "Mission"), 230);
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

  /* Tri : activité récente d'abord (un CV se lit du haut), puis création la plus récente. */
  avecLien.sort((a, b) => (b.fin || b.debut || "").localeCompare(a.fin || a.debut || ""));
  const max = Number(opt("max", 8));
  const retenus = avecLien.slice(0, max);

  /* Le stack se compte sur TOUTES les fiches publiées, pas seulement celles qu'on affiche :
     huit projets ne racontent pas dix-huit technologies. Ce sont les noms du select Notion,
     donc la liste vérifiée, pas des mots collés par un modèle. */
  const freq = new Map();
  for (const f of publies) for (const t of f.technologies) freq.set(t, (freq.get(t) || 0) + 1);
  const stack = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14).map(([t]) => t);

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

  const L = [];
  L.push(`# ${majuscule(nom) || "Nom à compléter"}`);
  const ligne2 = [majuscule(suivi("titre professionnel", titreProfil)), ville].filter(Boolean).join(" — ");
  if (ligne2) L.push(ligne2);
  if (opt("cible", "")) L.push(`\n**${opt("cible")}**`);
  if (contact.length) {
    L.push("");
    L.push(contact.map((c) => `[${c.cle}](${c.valeur})`).join(" · "));
  } else manquants.push("contact (email, téléphone, liens)");

  if (statut) { L.push("\n## En poste aujourd'hui", "", majuscule(statut.replace(/\s+/g, " "))); }

  if (savoirFaire.length) {
    L.push("\n## Ce que je sais faire, prouvé par ce qui tourne", "");
    for (const s of savoirFaire) L.push(`- ${s}`);
  }

  if (retenus.length) {
    L.push("\n## Projets en exploitation", "");
    L.push(`*Sélection parmi ${publies.length} projets publiés, classés par activité récente.*`);
    /* Un bloc par projet plutôt qu'une liste à puces imbriquées : le nom devient un
       sous-titre, le lecteur saute de projet en projet, et le convertisseur HTML n'a pas à
       gérer deux niveaux de liste. */
    for (const f of retenus) {
      const periode = [lisible(f.debut), lisible(f.fin)].filter(Boolean).join(" → ");
      const meta = [f.role, f.categorie, periode].filter(Boolean).join(" · ");
      L.push("", `### ${f.nom}`);
      if (meta) L.push(`*${meta}*`);
      if (f.corps) L.push(f.corps);
      const technos = f.technologies.slice(0, 6).join(" · ");
      const liens = [f.lien && `[${domaine(f.lien)}](${f.lien})`, f.github && `[code : ${domaine(f.github)}](${f.github})`].filter(Boolean);
      const pied = [technos && `**${technos}**`, ...liens].filter(Boolean);
      if (pied.length) L.push(pied.join(" — "));
    }
  }

  if (stack.length) {
    /* Le compte est celui des fiches relues, pas de celles affichées : la liste ci-dessous
       est calculée sur les 14, un titre qui dirait « sur ces projets » serait faux. */
    L.push(`\n## Technologies relevées sur les ${publies.length} projets publiés`, "", stack.join(" · "));
  }

  /* Rubriques du bas : elles ne sortent que si le profil les remplit. */
  const blocs = [
    ["Études", "Études / diplôme"],
    ["Expérience en entreprise", "Expérience en entreprise"],
    ["Langues", "Langues et niveau"],
    ["Mobilité", "Mobilité"],
    ["Prétention", "Prétention"],
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

  const jourCV = dateDuJour(dateService);
  if (jourCV) L.push(`\nAntananarivo, le ${jourCV}`);

  /* La provenance ne va PAS dans le CV : un document qu'on envoie ne se justifie pas
     d'avoir été généré. Elle est imprimée dans le rapport, et le CV se termine sur sa
     dernière rubrique. */
  const markdown = L.join("\n") + "\n";

  const rapport = [
    `${tous.length} fiches lues dans la base, ${publies.length} avec « Statut Portfolio = Ajouté », ${avecLien.length} avec un lien public, ${retenus.length} retenues (--max ${max}).`,
    sansLien ? `${sansLien} projet(s) publié(s) sans URL publique écartés (--sans-lien pour les garder).` : "",
    aCompleter.length ? `Rubriques absentes faute de source : ${aCompleter.join(", ")}.` : "Toutes les rubriques personnelles ont une source remplie.",
    contact.length ? "" : "Contact absent : le CV n'a ni email ni téléphone — à écrire dans data/profil-candidature.md, rubrique Contact.",
    manquants.length ? `Également absent faute de source : ${manquants.join(", ")}.` : "",
    `Aucun nombre, diplôme ou société n'a été ajouté par le programme (date du service : ${dateService || "indisponible"}).`,
  ].filter(Boolean);

  if (flag("sec")) { console.log(rapport.join("\n")); return; }
  console.log(markdown);
  console.log("\n--- rapport ---\n" + rapport.join("\n"));

  if (!flag("ecrire")) { console.log("\nRien n'a été écrit : ajoutez --ecrire pour produire cv/cv.md et cv/cv.html."); return; }
  mkdirSync(DOSSIER, { recursive: true });
  writeFileSync(join(DOSSIER, "cv.md"), markdown);
  writeFileSync(join(DOSSIER, "cv.html"), html(markdown, { nom, ligne2, contact, rapport }));
  console.log(`\nÉcrit : ${join(DOSSIER, "cv.md")}\nÉcrit : ${join(DOSSIER, "cv.html")}  (Ctrl+P → « Enregistrer en PDF », format A4)`);
  console.log("Rappel : le dossier cv/ est ignoré par git, un CV n'a rien à faire dans un dépôt public.");
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
    if (/^# /.test(l)) corps.push(`<h1>${inline(l.slice(2))}</h1>`);
    else if (/^### /.test(l)) corps.push(`<h3>${inline(l.slice(4))}</h3>`);
    else if (/^## /.test(l)) corps.push(`<h2>${inline(l.slice(3))}</h2>`);
    else if (/^---+$/.test(l.trim())) corps.push("<hr>");
    else if (l.trim()) corps.push(`<p>${inline(l)}</p>`);
  }
  if (liste) corps.push("</ul>");
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CV — ${esc(meta.nom || "")}</title>
<style>
  @page { size: A4; margin: 14mm 15mm; }
  :root { --encre: #14181d; --doux: #4b5560; --filet: #d7dbe0; --accent: #1f5c8b; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 180mm; padding: 10mm 6mm; color: var(--encre);
    font: 10.5pt/1.5 "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  h1 { font-size: 20pt; margin: 0 0 1mm; letter-spacing: .2mm; }
  h2 { font-size: 11.5pt; margin: 6mm 0 1.5mm; padding-bottom: 1mm; color: var(--accent);
    border-bottom: .3mm solid var(--filet); text-transform: uppercase; letter-spacing: .35mm; }
  /* Le nom du projet est un sous-titre, pas une puce : il reste collé à sa première ligne
     quand la page se coupe (break-after: avoid), sinon un titre orphelin clôt la page. */
  h3 { font-size: 11pt; margin: 4mm 0 0; color: var(--encre); break-after: avoid; }
  h3 + p em { color: var(--doux); font-size: 9.5pt; }
  p { margin: 1.2mm 0; }
  ul { margin: 1.5mm 0 0; padding-left: 5mm; }
  li { margin: 0 0 2.2mm; }
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
