/* Pont Notion -> POSTCRAFT Studio, et file d'attente automatique des posts LinkedIn.
   Lit une fiche projet de la base Notion (la même que le flux B du portfolio) et fabrique
   soit un visuel unique, soit un carrousel de 3 à 10 slides, prêts à publier sur LinkedIn.

   Quatre usages :
     1. En local, pour préparer/contrôler un visuel :
        node scripts/notion-to-postcraft.mjs --liste
        node scripts/notion-to-postcraft.mjs --projet "Pass'io" --carousel --render
        node scripts/notion-to-postcraft.mjs --projet "Pass'io" --mosaique --render
        node scripts/notion-to-postcraft.mjs --projet "Meshway" --format landscape --out sorties/
     2. Dans l'Action « LinkedIn — visuels » (3 créneaux par semaine, 2 h 30 avant Make) :
        node scripts/notion-to-postcraft.mjs --preparer --mosaique
        -> choisit LA fiche du prochain post, rend sa carte portrait, écrit le PNG sous
           assets/visuels-postcraft/ (le workflow le pousse sur « donnees »), pose l'URL dans
           « Visuel du post » et arme la fiche ; toute autre fiche armée est désarmée.
           Sans --mosaique, une seule carte est rendue ; avec, la fiche est racontée en
           quatre panneaux recollés dans LA MÊME image 1080×1350 — l'API LinkedIn joignable
           depuis Make ne publie qu'un média par post (mesuré sur module_spec : aucun module
           multi-images ni document), donc plusieurs visuels = une composition.
     3. Pour voir la décision sans rien écrire :
        node scripts/notion-to-postcraft.mjs --prochain
        node scripts/notion-to-postcraft.mjs --preparer --sec

   Variables d'environnement :
     NOTION_TOKEN      jeton d'intégration Notion (défaut : fichier NOTION_TOKEN_FILE,
                       puis .dev/notion_token — jamais dans le dépôt)
     NOTION_TOKEN_FILE chemin d'un fichier contenant seulement le jeton
     NOTION_DS         identifiant de la source de données (défaut : base du portfolio)
     POSTCRAFT_URL     origine du studio (défaut : http://127.0.0.1:8791, ou l'URL workers.dev)
     POSTCRAFT_KEY     clé Bearer de l'API (défaut : .dev.vars du studio, pour un test local)
     REPO_BRANCHE      branche où atterrissent les PNG (défaut : donnees)

   Sans --render, l'outil écrit uniquement les JSON de payload : on peut les coller dans le
   studio, ou les envoyer plus tard depuis Make.com vers /api/render.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, isAbsolute } from "node:path";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DS = process.env.NOTION_DS || "78e87c8c-4916-4d46-8cd2-00b0bcd471fa";
const ORIGINE = process.env.POSTCRAFT_URL || "http://127.0.0.1:8791";
const REPO = process.env.REPO_RACINE || "Narindra0/portfolioNarindra";
const BRANCHE_VISUELS = process.env.REPO_BRANCHE || "donnees";
const DOSSIER_VISUELS = "assets/visuels-postcraft";

const args = process.argv.slice(2);
const opt = (nom, defaut) => {
  const i = args.indexOf(`--${nom}`);
  return i === -1 ? defaut : (args[i + 1] ?? "").replace(/^"|"$/g, "");
};
const flag = (nom) => args.includes(`--${nom}`);

function jeton() {
  if (process.env.NOTION_TOKEN) return process.env.NOTION_TOKEN.trim();
  const candidats = [
    process.env.NOTION_TOKEN_FILE,
    join(RACINE, ".dev", "notion_token"),
    join(RACINE, "..", "portfolio", ".dev", "notion_token"),
  ].filter(Boolean);
  for (const chemin of candidats) if (existsSync(chemin)) return readFileSync(chemin, "utf8").trim();
  throw new Error("Jeton Notion introuvable : définissez NOTION_TOKEN ou NOTION_TOKEN_FILE.");
}

/* .dev.vars est un fichier dotenv : KEY="valeur" ou KEY=valeur. Le separateur est le PREMIER
   « = » seulement (une valeur base64 peut finir par « = ») et les guillemets ne font pas
   partie de la valeur — sinon la cle envoyee porte des guillemets et l'API repond 401.
   Dans l'Action, la cle vient du secret POSTCRAFT_KEY : ce repli n'est là que pour un test
   sur ce poste, où le studio garde son .dev.vars à côté du dépôt. */
function cleDepaire(nom) {
  const candidats = [join(RACINE, ".dev.vars"), join(RACINE, "..", "linkedin-visual-studio", ".dev.vars")];
  for (const chemin of candidats) {
    if (!existsSync(chemin)) continue;
    const ligne = readFileSync(chemin, "utf8").split(/\r?\n/).find((l) => l.startsWith(`${nom}=`));
    if (!ligne) continue;
    return ligne.slice(nom.length + 1).trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return "";
}

const entetes = () => ({
  Authorization: `Bearer ${jeton()}`,
  "Notion-Version": "2025-09-03",
  "Content-Type": "application/json",
});

async function notion(path, init = {}) {
  const r = await fetch(`https://api.notion.com${path}`, { ...init, headers: entetes() });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Notion ${r.status} ${b?.code || ""} :: ${b?.message || ""}`);
  return b;
}

/* — Lecture des propriétés, types de l'API 2025-09-03 (mêmes helpers que le flux B). — */
const titre = (p) => (p["Nom du projet"]?.title || []).map((t) => t.plain_text).join("").trim();
const txt = (p, n) => (p[n]?.rich_text || []).map((t) => t.plain_text).join("").trim();
const sel = (p, n) => p[n]?.select?.name || "";
const multi = (p, n) => (p[n]?.multi_select || []).map((o) => o.name);
const url = (p, n) => p[n]?.url || "";
const jour = (p, n) => p[n]?.date?.start || "";

/* Couper à la longueur max ne suffit pas : un « … » posé sur « sans », « et » ou « les »
   laisse lire une phrase cassée en plein élan. On remonte donc jusqu'au dernier mot qui a
   un sens, sans jamais descendre sous 60 % de la place disponible. */
const OUTILS = new Set(["et", "ou", "ni", "the", "a", "à", "au", "aux", "de", "du", "des", "le", "la", "les", "un", "une", "en", "dans", "par", "pour", "sur", "sous", "avec", "sans", "est", "sont", "se", "son", "sa", "ses", "ce", "cet", "cette", "ces", "qui", "que", "comme", "très", "plus", "peu", "tout", "tous", "toutes"]);
/* Le tiret long « — » est la signature d'un texte sorti d'une machine : une carte LinkedIn en
   porte la trace dès la première phrase. La consigne du prompt le dit au modèle, ce remplacement
   le garantit dans la matière lue depuis Notion. Le « – » des plages de dates n'est pas ce
   caractère-là. */
const sansTiretLong = (s) => String(s ?? "")
  .replace(/[ \t]+—[ \t]+/g, ", ")
  .replace(/[ \t]*—[ \t]*/g, " - ");
const nettoyer = (s, max) => {
  const plat = sansTiretLong(s).replace(/\s+/g, " ").trim();
  if (!max || plat.length <= max) return plat;
  /* Une phrase qui déborde de quelques caractères se lit mieux entière qu'avec un « … »
     planté en son milieu : la marge reste petite et le studio renvoie un 422 si ça déborde. */
  const fin = plat.search(/[.!?](\s|$)/);
  if (fin > -1 && fin + 1 <= max + 12) return plat.slice(0, fin + 1);
  const coupe = plat.slice(0, max);
  const mot = coupe.lastIndexOf(" ");
  let texte = (mot > 40 ? coupe.slice(0, mot) : coupe).replace(/[,;:.\-]$/, "");
  const plancher = Math.max(30, Math.round(max * 0.6));
  for (;;) {
    const i = texte.lastIndexOf(" ");
    if (i < plancher || i === -1) break;
    const dernier = texte.slice(i + 1).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (!OUTILS.has(dernier)) break;
    texte = texte.slice(0, i);
  }
  return texte.replace(/[,;:.\-]$/, "") + "…";
};
const phrases = (s) => sansTiretLong(s).replace(/\s+/g, " ").trim().split(/(?<=[.!?]) /).filter(Boolean);
/* Le pied de carte doit dire OÙ aller. « github.com » seul ne veut rien dire : sur les
   plateformes qui hébergent plusieurs projets, on garde le chemin (owner/repo). Mesuré le
   2026-10-26 sur la carte LocalSound-Share, le pied affichait « github.com ». */
const domaine = (u) => {
  const brut = String(u || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const [hote, ...chemin] = brut.split("/");
  const plateforme = /^(github|gitlab|bitbucket)\.com$/i.test(hote);
  return plateforme && chemin.length ? `${hote}/${chemin.join("/").slice(0, 44)}` : hote;
};
const normal = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

/* Le sous-titre et le corps viennent souvent de la même phrase de la Description : affiché
   deux fois, le visuel se répète et le lecteur croit à un bug. On retire donc du corps les
   PHRASES déjà dites — phrase entière, jamais une coupe au mot près, sinon le corps démarre
   sur « des plantations. » et la carte a l'air cassée. La comparaison se fait mot à mot parce
   que le sous-titre est lui-même tronqué par `nettoyer` et suivi d'une ellipse. */
function retireDejaDit(texte, ...dejaDits) {
  const motsDe = (s) => String(s || "").replace(/\s+/g, " ").replace(/[.…]+$/, "").trim().split(" ").map((m) => normal(m)).filter(Boolean);
  const references = dejaDits.map(motsDe).filter((m) => m.length >= 4);
  if (!references.length) return String(texte || "").replace(/\s+/g, " ").trim();
  const garde = phrases(texte).filter((phrase) => {
    const m = motsDe(phrase);
    return !references.some((r) => r.every((mot, i) => m[i] === mot));
  });
  const reste = garde.join(" ").trim();
  return reste.length >= 40 ? reste : "";
}

function lien(p) {
  const type = sel(p, "Type de lien");
  const demo = url(p, "Lien Démo");
  const github = url(p, "Lien GitHub").replace(/\.git\/?$/, "");
  if (type === "GitHub" && github) return { url: github, cta: "Voir le code →" };
  if (demo) return { url: demo, cta: "Voir le projet →" };
  if (github) return { url: github, cta: "Voir le code →" };
  return { url: "", cta: "" };
}

/* Une adresse imprimée sur une carte ne se rattrape pas : le post reste dans le fil. Le test
   se fait donc SANS JETON, sur la voie que le lecteur empruntera — le jeton local voit des
   dépôts privés que le fil ne verra jamais. Si la destination ne répond pas, la carte part
   sans adresse et sans appel à cliquer : la fiche reste publiable (l'histoire se suffit),
   mais on ne fabrique pas un lien mort. Deux cas mesurés le 2026-10-26 : BusNaka
   (narindra.pythonanywhere.com = HTTP 404) et DigiKaratra (digikaratra.alwaysdata.net =
   connexion refusée). */
const atteignables = new Map();
async function sondeLiens(p) {
  const { url: cible } = lien(p);
  if (!cible || atteignables.has(cible)) return;
  let detail = "erreur réseau";
  try {
    const r = await fetch(cible, { redirect: "follow", signal: AbortSignal.timeout(12000), headers: { "User-Agent": "controle-lien", Accept: "text/html,application/json" } });
    detail = `HTTP ${r.status}`;
    atteignables.set(cible, r.ok);
  } catch (e) {
    atteignables.set(cible, false);
  }
  console.log(`  lien ${atteignables.get(cible) ? "vivant" : `MORT (${detail})`} : ${cible}${atteignables.get(cible) ? "" : " — la carte partira sans adresse ni appel à cliquer"}`);
}

function lienSur(p) {
  const l = lien(p);
  return l.url && atteignables.get(l.url) === false ? { url: "", cta: "" } : l;
}

/* Les gabarits dimensionnent la typographie en cqw (liée à la LARGEUR du cadre) : en paysage,
   la même phrase déborde parce que la hauteur disponible est deux fois plus petite. Ces
   plafonds viennent des rendus réels : sur le gabarit « orbit » en portrait, un titre passe à
   60 caractères et déborde à 70 (mesuré le 2026-10-26). L'API renvoie un 422 explicite si un
   gabarit plus serré refuse malgré tout le texte. */
const LIMITS = {
  portrait: { title: 60, subtitle: 100, body: 280, description: 220, tech: 6 },
  square: { title: 50, subtitle: 80, body: 200, description: 170, tech: 5 },
  landscape: { title: 34, subtitle: 55, body: 110, description: 95, tech: 4 },
};

/* Les 11 clés du studio (title, subtitle, description, project, author, role, tech, stats,
   cta, url, extra) : on les envoie toujours, même vides. Le `setState` du Worker
   fusionne avec le contenu par défaut de l'éditeur — un champ absent afficherait le texte
   d'exemple (« UI/UX Design · Frontend », « narindraportfolio.netlify.app ») sur un vrai post. */
function contenuDe(p, auteur, lim = LIMITS.portrait) {
  const nom = titre(p);
  const description = txt(p, "Description");
  const accroche = txt(p, "Accroche");
  const mission = txt(p, "Mission");
  const role = txt(p, "Rôle");
  const categorie = sel(p, "Catégorie");
  const technos = multi(p, "Technologies");
  const fonctionnalites = txt(p, "Fonctionnalités").split(/\n+/).map((s) => s.replace(/^[-•*\s]+/, "").trim()).filter(Boolean);
  const annee = jour(p, "Date de création").slice(0, 4);
  const { url: cible, cta } = lienSur(p);
  const accrocheOu1erePhrase = accroche || txt0(phrases(description)[0] || mission) || nom;
  /* Une accroche plus longue que la ligne de titre ne doit pas être coupée au milieu d'une
     phrase sur la carte : on met le nom du projet en titre et l'accroche en sous-titre. */
  const titreCourt = accrocheOu1erePhrase.length <= lim.title;
  const titreAffiche = titreCourt ? accrocheOu1erePhrase : nom;
  const sousTitre = titreCourt
    ? (mission && mission !== accrocheOu1erePhrase ? nettoyer(mission, lim.subtitle) : nettoyer(categorie, 60))
    : (nettoyer(accrocheOu1erePhrase, lim.subtitle) || nettoyer(categorie, 60));
  /* Corps = la Description amputée de ce que le titre a déjà dit ; à défaut, les
     Fonctionnalités de la fiche (jamais une phrase inventée pour remplir le cadre). */
  const corps = retireDejaDit(description, titreAffiche, sousTitre)
    || retireDejaDit(mission, titreAffiche, sousTitre)
    || nettoyer(fonctionnalites.join(" · "), lim.description);
  /* Trois faits comptés dans la fiche, jamais un chiffre qui n'y figure pas : c'est ce qui
     remplit le bas des gabarits aérés (swiss) au lieu de laisser un vide. */
  const stats = [
    fonctionnalites.length ? `${fonctionnalites.length} fonctionnalités` : "",
    technos.length ? `${technos.length} technologies` : "",
    annee ? `depuis ${annee}` : "",
  ].filter(Boolean).join("|");
  return {
    title: titreAffiche,
    subtitle: sousTitre,
    project: nom,
    description: nettoyer(corps, lim.description),
    author: auteur,
    role: nettoyer(role, 70),
    tech: technos.slice(0, lim.tech).join(" · "),
    stats,
    cta,
    url: domaine(cible),
    extra: [categorie, annee].filter(Boolean).join(" · "),
  };
}

/* Trame narrative du carrousel, construite uniquement sur ce que porte la fiche.
   options.compteur = false pour une mosaïque : les panneaux ne se « tournent » pas, un
   « 02 / 04 » sur une image unique serait une pagination mensongère.
   options.couverture : la phrase d'accroche de la première planche change avec le support. */
function slidesDe(p, nombre, lim = LIMITS.portrait, options = {}) {
  const { compteur = true, couverture = "Défilez pour découvrir le projet." } = options;
  const nom = titre(p);
  const description = txt(p, "Description");
  const mission = txt(p, "Mission");
  const role = txt(p, "Rôle");
  const categorie = sel(p, "Catégorie");
  const technos = multi(p, "Technologies");
  const liste = txt(p, "Fonctionnalités").split("\n").map((l) => l.trim()).filter(Boolean);
  const { cta } = lienSur(p);
  const date = jour(p, "Date de création");
  const corps = phrases(description);
  const annee = date.slice(0, 4);
  /* La slide de chute résume la fiche au lieu de recoller la description : sur une
     série, la description est déjà répartie sur « Le point de départ » et « L'objectif ». */
  const rappel = [role, liste.length ? `${liste.length} fonctionnalités` : "",
    technos.length ? `${technos.length} technologies` : "", annee ? `en production depuis ${annee}` : ""]
    .filter(Boolean).join(" · ");

  const base = [
    { title: nom, subtitle: nettoyer(categorie, 40) || "Projet", body: couverture, cta: "" },
    { title: "Le point de départ", subtitle: "Le contexte", body: nettoyer(corps[0] || description, lim.body), cta: "" },
    { title: "Ce que j'ai voulu résoudre", subtitle: "L'objectif", body: nettoyer(mission || corps.slice(1).join(" ") || description, lim.body), cta: "" },
    { title: "Ce que le projet fait", subtitle: liste.length ? `${liste.length} fonctionnalités` : "Le produit", body: nettoyer(liste.slice(0, 4).map((l) => l.split(":")[0].trim()).join(" · "), lim.body) || nettoyer(corps.slice(0, 2).join(" "), lim.body), cta: "" },
    { title: "Comment c'est construit", subtitle: technos.slice(0, 5).join(" · ") || "La stack", body: nettoyer(liste.slice(0, 3).map((l) => (l.includes(":") ? l.split(":")[1].trim() : l)).join(" · "), lim.body), cta: "" },
    { title: moisDe(date) ? `Démarré en ${moisDe(date)}` : "Et maintenant", subtitle: "La suite", body: nettoyer(corps[corps.length - 1] || mission || description, lim.body), cta: "" },
    { title: nom, subtitle: "À retenir", body: nettoyer(rappel, lim.body), cta: cta || "Merci de votre lecture" },
  ];
  /* Deux façons de composer :
     - un plan explicite (mosaïque) : on choisit les étapes qui portent l'information ;
     - 3 à 10 slides (carrousel) : couverture et chute fixes, les étapes du milieu se
       répètent si nécessaire. */
  if (options.plan) {
    const prises = options.plan.map((i) => base[i]);
    return compteur ? renumerote(prises) : prises;
  }
  const milieu = base.slice(1, -1);
  const choisis = [base[0]];
  while (choisis.length < nombre - 1) choisis.push(...milieu);
  choisis.length = Math.max(1, nombre - 1);
  choisis.push(base[base.length - 1]);
  return compteur ? renumerote(choisis.slice(0, nombre)) : choisis.slice(0, nombre);
}
/* Une date ISO ne s'affiche pas telle quelle sur une carte : « 2025-06-15 » devient « juin 2025 ». */
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const moisDe = (d) => {
  const [a, m] = String(d || "").split("-");
  return a && m && MOIS[+m - 1] ? `${MOIS[+m - 1]} ${a}` : "";
};
const txt0 = (s) => String(s || "").replace(/\s+/g, " ").trim();
/* Les slides intermédiaires portent leur numéro (« 03 / 07 »), la dernière garde l'appel à l'action. */
function renumerote(slides) {
  const total = slides.length;
  return slides.map((s, i) => i === total - 1
    ? s
    : { ...s, cta: `${String(i + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}` });
}

/* Les quatre panneaux de la mosaïque, à un seul endroit : la voie automatique et le test
   local doivent composer la même image. Plan = couverture, ce que fait le projet, comment il
   est construit, ce qu'il faut en retenir ; la couverture porte la matière de la fiche
   (jamais une phrase d'accroche inventée par le script) et les panneaux se passent du
   compteur « 02 / 04 », qui n'a pas de sens sur une image unique. */
function mosaiqueDe(p, lim, contenu) {
  const couverture = nettoyer(contenu.description, 120) || nettoyer(contenu.subtitle, 120) || "Le projet en quatre temps.";
  return slidesDe(p, 4, lim, { plan: [0, 3, 4, 6], compteur: false, couverture });
}

function slug(s) {
  return normal(s).replace(/^-|-$/g, "").slice(0, 60) || "projet";
}

async function listeFiches() {
  const pages = [];
  let curseur;
  do {
    const q = await notion(`/v1/data_sources/${DS}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, ...(curseur ? { start_cursor: curseur } : {}) }),
    });
    (q.results || []).forEach((p) => pages.push(p));
    curseur = q.has_more ? q.next_cursor : undefined;
  } while (curseur);
  return pages;
}

/* ————————————————————— File d'attente automatique ————————————————————— */

/* Une fiche n'est publiable que si elle a de quoi remplir une carte SANS INVENTER RIEN :
   publiée sur le site (« Ajouté »), jamais postée, un lien à montrer, et une matière
   suffisante. Les 16 fiches créées par le scan des dépôts sont écartées par ce filtre —
   ce sont des brouillons sans accroche ni description. */
function publiable(p) {
  const br = p.properties;
  if (sel(br, "Statut Portfolio") !== "Ajouté") return false;
  if (txt(br, "ID du post LinkedIn")) return false;
  if (sel(br, "Statut LinkedIn") === "Publié") return false;
  if (!titre(br)) return false;
  if (!lien(br).url) return false;
  const matiere = txt(br, "Accroche").length + txt(br, "Description").length + txt(br, "Mission").length;
  return matiere >= 60;
}

/* Le rang, et pourquoi. Trois règles, dans cet ordre :
   1. une fiche déjà armée garde la main (un créneau qui a échoué se rejoue, il ne saute pas) ;
   2. la catégorie la moins publiée d'abord : le fil ne doit pas être trois cartes AgriTech de
      suite, et les catégories peu représentées méritent leur tour ;
   3. à égalité, la fiche la plus riche, puis la plus ancienne (l'ordre du portfolio). */
function classer(pages) {
  const dejaPubliees = pages.filter((p) => txt(p.properties, "ID du post LinkedIn"));
  const compteur = {};
  dejaPubliees.forEach((p) => { const c = sel(p.properties, "Catégorie") || "(sans)"; compteur[c] = (compteur[c] || 0) + 1; });
  const richesse = (p) => {
    const b = p.properties;
    return [txt(b, "Accroche"), txt(b, "Description"), txt(b, "Mission"), txt(b, "Rôle"), txt(b, "Fonctionnalités")]
      .filter((v) => v.length > 20).length + multi(b, "Technologies").length * 0.2;
  };
  return pages.filter(publiable).map((p) => ({
    p,
    armee: sel(p.properties, "Statut LinkedIn") === "À publier",
    cat: sel(p.properties, "Catégorie") || "(sans)",
    riche: richesse(p),
    date: jour(p.properties, "Date de création") || "9999",
  })).sort((a, b) => Number(b.armee) - Number(a.armee)
    || (compteur[a.cat] || 0) - (compteur[b.cat] || 0)
    || b.riche - a.riche
    || a.date.localeCompare(b.date));
}

/* Écriture d'une fiche : uniquement les clés passées. Un « "" » est une écriture réelle en
   Notion, donc une clé absente reste telle quelle. */
async function ecrire(pageId, champs) {
  return notion(`/v1/pages/${pageId}`, { method: "PATCH", body: JSON.stringify({ properties: champs }) });
}
const enSelect = (v) => ({ select: { name: v } });
const enUrl = (v) => ({ url: v });
const enCase = (v) => ({ checkbox: !!v });

/* Chaîne de gabarits : celui prévu pour la catégorie, puis les deux qui ont tenu à tous les
   coups en portrait. Un 422 n'est pas une fin de créneau, c'est un gabarit trop serré. */
function chaine(template, reglages) {
  return [...new Set([template, reglages.defaut, "story", "minimal"].filter(Boolean))];
}

/* Une entrée de notion-templates.json s'écrit soit en chaîne (« "AgriTech": "fieldnotes" »),
   soit en objet (« {"template":"fieldnotes"} »). Sans cette normalisation, la forme chaîne
   ne expose pas .template et le gabarit de la catégorie tombeait silencieusement sur `defaut`
   — bug mesuré le 2026-10-26 : Ravina (AgriTech → fieldnotes) sortait en « story ». */
function gabaritDe(entree) {
  if (!entree) return "";
  return typeof entree === "string" ? entree : String(entree.template || "");
}
function reglagePour(reglages, nom, cat) {
  return cleNormalise(reglages.parProjet, nom) || cleNormalise(reglages.parCategorie, cat)
    || String(reglages.defaut || "");
}
/* Les clés du JSON sont recopiées à la main depuis Notion : « pass'io » ou « Mobilite » doivent
   retomber sur la fiche. Sans cette tolérance, un accent oublié dans le mapping = gabarit
   défaut et l'erreur est silencieuse. */
function cleNormalise(table, valeur) {
  if (!table || !valeur) return "";
  const cible = normal(valeur);
  for (const [cle, entree] of Object.entries(table)) {
    if (normal(cle) === cible) return gabaritDe(entree);
  }
  return "";
}

async function rendre(payload, fichier, cle, route = "/api/render", tailleMini = 3000) {
  const r = await fetch(`${ORIGINE}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cle}` },
    body: JSON.stringify({ ...payload, filename: fichier }),
  });
  const corps = Buffer.from(await r.arrayBuffer());
  if (!r.ok) {
    const e = new Error(`Rendu refusé (${r.status}) : ${corps.toString().slice(0, 200)}`);
    e.statut = r.status;
    throw e;
  }
  if (!(corps.length > tailleMini)) throw new Error("Rendu suspect : le PNG renvoyé est trop petit pour être une carte.");
  return corps;
}

/* Le cycle complet d'un créneau, en deux temps pour que l'ordre soit sûr :
   --preparer  choisit la fiche et écrit le PNG (le workflow le pousse sur « donnees ») ;
   --armer     n'écrit dans Notion QU'APRÈS la poussée vérifiée. L'inverse publierait une fiche
   armée dont « Visuel du post » renvoie un 404 — Make, lui, ne vérifie pas l'URL. */
const ETAT = join(RACINE, ".visuel-etat.json");

async function preparer({ pages, reglages, auteur, sec }) {
  const rangs = classer(pages);
  if (!rangs.length) {
    console.log("AUCUNE FICHE PUBLIABLE : rien n'est armé, rien ne sera publié ce créneau.");
    console.log("Le réservoir est vide dès que les fiches « Ajouté » avec un lien sont toutes postées — il faut compléter des fiches, pas baisser le filtre.");
    return 3;
  }
  const { p, cat, armee } = rangs[0];
  const nom = titre(p.properties);
  console.log(`Prochaine fiche : « ${nom} » (${cat})${armee ? " — déjà armée, on lui refait sa carte et on garde la main dessus" : ""}.`);
  rangs.slice(1, 5).forEach((r, i) => console.log(`  candidat ${i + 2} : « ${titre(r.p.properties)} » (${r.cat})`));

  const enMosaique = flag("mosaique") || process.env.VISUEL_MODE === "mosaique";
  /* Un panneau de mosaïque est petit : au rendu réel du 28/10, « story » (fond plein, deux
     blocs de texte, badge de date) remplit la cellule alors que les gabarits aérés (« swiss »)
     laissent la moitié du panneau vide. Le gabarit de la catégorie reste dans la chaîne, en
     repli si le premier refuse le texte (422). */
  const gabarits = enMosaique
    ? [...new Set([reglages.defautMosaique || reglages.defautCarrousel || "story", ...chaine(reglagePour(reglages, nom, cat), reglages)])]
    : chaine(reglagePour(reglages, nom, cat), reglages);
  await sondeLiens(p.properties);
  /* Le log du run d'Actions doit permettre de relire « pourquoi ce gabarit » sans ouvrir le
     JSON : la chaîne d'essai complète y figure, repli de 422 compris. */
  console.log(`Gabarits essayés : ${gabarits.join(" → ")}.`);
  const lim = LIMITS.portrait;
  const contenu = contenuDe(p.properties, auteur, lim);

  const cle = process.env.POSTCRAFT_KEY || cleDepaire("API_KEY");
  if (!cle) throw new Error("Clé API POSTCRAFT manquante : secret POSTCRAFT_KEY (ou .dev.vars en local).");

  /* Une tentative sur toute la chaîne de gabarits, dans une forme donnée (mosaïque ou carte).
     Renvoie null quand la forme est indisponible pour cause de texte trop long (422) sur tous
     les gabarits : l'appelant peut alors réessayer dans l'autre forme. */
  async function chaîne(gabarits, planches) {
    /* Sur une mosaïque, chaque panneau est lu à côté des autres : la ligne de technos et les
       pastilles de chiffres, portées par le contenu global, se répèteraient à l'identique
       quatre fois (mesuré sur le premier rendu du 28/10). Le panneau porte donc son propre
       texte — les slides — et le gabarit ne garde que sa signature (nom, auteur, lien). */
    const textes = planches ? { ...contenu, tech: "", stats: "" } : contenu;
    for (const template of gabarits) {
      const payload = { template, format: "portrait", imageType: "png", content: textes };
      if (planches) payload.slides = planches;
      const nomFichier = `${slug(nom)}-${template}${planches ? "-mosaique" : ""}.png`;
      try {
        const png = planches
          ? await rendre(payload, nomFichier, cle, "/api/render-mosaic", 20_000)
          : await rendre(payload, nomFichier, cle);
        return { png, template };
      } catch (e) {
        /* 422 = le texte déborde de ce gabarit : on passe au suivant. Tout le reste (401, 500,
           quota navigateur épuisé) est bloquant : armer une fiche sans carte publierait un post
           sans visuel, ou un visuel de mauvaise qualité. Sauf en mosaïque, où l'échec technique
           a un repli connu : la carte unique, qui a fait ses preuves depuis le 26/10. */
        if (e.statut === 422) { console.log(`  gabarit « ${template} » refusé (texte trop long), essai du suivant…`); continue; }
        if (planches) { console.error(`  mosaïque indisponible (${e.message}) : le créneau repart en carte unique.`); return null; }
        console.error(`  échec du rendu avec « ${template} » : ${e.message}`);
        throw e;
      }
    }
    return null;
  }

  /* Deux formes de visuel. La mosaïque (4 panneaux dans la même image 1080×1350) est le mode
     de l'automatique depuis le 28/10 : l'API LinkedIn accessible à Make ne publie QU'UN média
     par post (mesuré sur module_spec — aucun module multi-images, aucun module document/PDF),
     donc « présenter le projet en plusieurs visuels » doit se composer dans le PNG lui-même. */
  /* Les quatre panneaux qui racontent un projet : voir mosaiqueDe(). */
  let planches = enMosaique ? mosaiqueDe(p.properties, lim, contenu) : null;
  let rendu = await chaîne(gabarits, planches);
  if (!rendu && planches) {
    planches = null;
    rendu = await chaîne(gabarits, null);
  }
  if (!rendu) throw new Error(`Aucun gabarit de la chaîne ${gabarits.join(", ")} n'a accepté ce texte.`);
  const { png, template: templateRetenu } = rendu;

  const fichier = `${slug(nom)}-${templateRetenu}${planches ? "-mosaique" : ""}.png`;
  const chemin = join(RACINE, DOSSIER_VISUELS, fichier);
  const publique = `https://raw.githubusercontent.com/${REPO}/${BRANCHE_VISUELS}/${DOSSIER_VISUELS}/${fichier}`;
  console.log(`Visuel ${planches ? "mosaïque 4 panneaux" : "carte unique"} « ${templateRetenu} » rendu : ${(png.length / 1024).toFixed(0)} Ko → ${DOSSIER_VISUELS}/${fichier}`);
  if (sec) {
    console.log("--sec : aucun fichier écrit, aucune fiche modifiée.");
    return 0;
  }
  mkdirSync(dirname(chemin), { recursive: true });
  writeFileSync(chemin, png);

  /* L'invariant que Make exige : UNE SEULE fiche armée à la fois. Son filtre est
     « Statut LinkedIn = À publier » ET « Prêt à publier » ET « ID du post LinkedIn » vide, et il
     ne trie pas — deux fiches armées, c'est un créneau publié sur une carte qui ne correspond
     pas au texte. On balaie donc TOUTES les fiches (pas seulement les candidates : mesuré le
     2026-10-26, Talenta portait « Prêt à publier » coché depuis un test manuel alors qu'elle est
     en Brouillon), et on ne garde que le drapeau qui traîne.
     Règle : « Prêt à publier » n'est qu'une porte pour Make, il ne porte aucune histoire — le
     nettoyer sur une fiche déjà publiée ne casse rien. Le statut d'une fiche publiée ne bouge
     jamais : on ne remet pas « Publié » en « Brouillon ». */
  const desarmer = pages.filter((x) => x.id !== p.id && x.properties["Prêt à publier"]?.checkbox)
    .map((x) => {
      const nom = titre(x.properties);
      const armee = sel(x.properties, "Statut LinkedIn") === "À publier";
      const champs = { "Prêt à publier": enCase(false) };
      if (armee) champs["Statut LinkedIn"] = enSelect("Brouillon");
      return { id: x.id, nom, motif: armee ? "arme concurrente" : "drapeau reste coche (test manuel)", champs };
    });

  writeFileSync(ETAT, JSON.stringify({ pageId: p.id, nom, fichier, url: publique, template: templateRetenu, mosaique: !!planches, desarmer }, null, 2) + "\n");
  console.log(`PNG écrit, Notion pas encore touché : --armer le fera après la poussée vérifiée sur « ${BRANCHE_VISUELS} ».`);
  if (desarmer.length) console.log(`À désarmer au même moment : ${desarmer.map((d) => `${d.nom} (${d.motif})`).join(", ")}`);
  return 0;
}

/* Deuxième temps : la carte est en ligne, on arme. */
async function armer() {
  if (!existsSync(ETAT)) { console.log("Rien à armer (--preparer n'a rien déposé)."); return 0; }
  const e = JSON.parse(readFileSync(ETAT, "utf8"));
  /* Contrôle avant d'écrire : l'URL doit répondre 200 et être bien un PNG. Un 404 ici veut dire
     que la poussée a échoué — on n'arme pas, Make ne publiera rien, et le log est explicite. */
  const t = await fetch(e.url, { method: "GET", cache: "no-store" });
  const type = t.headers.get("content-type") || "";
  if (!t.ok || !type.includes("png")) throw new Error(`Visuel non vérifiable en ligne (${t.status} ${type}) : ${e.url} — fiche non armée.`);
  await ecrire(e.pageId, {
    "Visuel du post": enUrl(e.url),
    "Statut LinkedIn": enSelect("À publier"),
    "Prêt à publier": enCase(true),
  });
  console.log(`Fiche « ${e.nom} » armée (gabarit ${e.template}) : ${e.url}`);
  for (const d of e.desarmer || []) {
    await ecrire(d.id, d.champs);
    console.log(`  désarmée (${d.motif}) : ${d.nom}`);
  }
  return 0;
}

async function main() {
  const auteur = opt("auteur", "Nxrxone");
  const format = opt("format", "portrait");
  const nombre = Math.max(3, Math.min(10, Number(opt("slides", 5)) || 5));
  const repertoire = opt("out", "sorties");
  const dir = isAbsolute(repertoire) ? repertoire : join(RACINE, repertoire);
  const cartes = opt("cartes", join("scripts", "notion-templates.json"));
  const cheminCartes = isAbsolute(cartes) ? cartes : join(RACINE, cartes);
  const reglages = existsSync(cheminCartes) ? JSON.parse(readFileSync(cheminCartes, "utf8")) : {};

  /* --armer se passe de lecture de la base : il n'agit que sur ce que --preparer a déposé. */
  if (flag("armer")) return armer();

  const pages = await listeFiches();

  if (flag("liste")) {
    console.log(`${pages.length} fiches dans la base.\n`);
    for (const p of pages) {
      const pr = p.properties;
      const manques = [];
      if (!txt(pr, "Description")) manques.push("description");
      if (!txt(pr, "Fonctionnalités")) manques.push("fonctionnalités");
      if (!multi(pr, "Technologies").length) manques.push("technologies");
      if (!lien(pr).url) manques.push("lien");
      console.log(`- ${titre(pr) || "(sans titre)"} | ${sel(pr, "Catégorie") || "?"} | ${sel(pr, "Statut Portfolio") || "?"} | ${multi(pr, "Technologies").length} technos | ${txt(pr, "Fonctionnalités").split("\n").filter(Boolean).length} fonctionnalités${manques.length ? " | à compléter : " + manques.join(", ") : ""}`);
    }
    console.log("\nLe carrousel se construit sur les champs de la fiche : une fiche incomplète donne des slides répétées. Les champs lus sont Description, Mission, Rôle, Fonctionnalités, Technologies, Type de lien + Lien Démo/GitHub, Date de création.");
    return;
  }

  if (flag("prochain") || flag("preparer")) {
    if (flag("prochain")) {
      const rangs = classer(pages);
      console.log(`${rangs.length} fiche(s) publiable(s) sur ${pages.length}.\n`);
      rangs.forEach((r, i) => console.log(`${i + 1}. ${titre(r.p.properties)} — ${r.cat} — ${r.armee ? "DÉJÀ ARMÉE" : "à armer"} — gabarit ${reglagePour(reglages, titre(r.p.properties), r.cat)} — richesse ${r.riche.toFixed(1)} — ${r.date}`));
      if (!rangs.length) console.log("Rien de publiable : il faut compléter des fiches (Statut Portfolio = Ajouté + lien + 60 caractères de matière).");
      return;
    }
    const code = await preparer({ pages, reglages, auteur, sec: flag("sec") });
    if (code) process.exitCode = code;
    return;
  }

  const demande = opt("projet", "");
  if (!demande) throw new Error("Indiquez --projet \"Nom\", ou --liste, ou --prochain / --preparer.");
  const cible = pages.find((p) => normal(titre(p.properties)) === normal(demande))
    || pages.find((p) => normal(titre(p.properties)).includes(normal(demande)));
  if (!cible) throw new Error(`Fiche introuvable : « ${demande} ». Lancez --liste pour voir les noms exacts.`);

  const cartographie = reglagePour(reglages, titre(cible.properties), sel(cible.properties, "Catégorie"));
  await sondeLiens(cible.properties);
  const template = opt("template",
    flag("mosaique")
      ? (reglages.defautMosaique || "story")
      : cartographie || (flag("carousel") ? reglages.defautCarrousel : reglages.defaut) || "minimal");

  const lim = LIMITS[format] || LIMITS.portrait;
  const payload = {
    template,
    format,
    imageType: opt("type", "png"),
    content: contenuDe(cible.properties, auteur, lim),
  };
  if (flag("carousel")) payload.slides = slidesDe(cible.properties, nombre, lim);
  /* La même fonction que l'automatique : ce qu'on regarde ici est bien ce qui sera publié. */
  if (flag("mosaique")) {
    payload.slides = mosaiqueDe(cible.properties, lim, payload.content);
    Object.assign(payload.content, { tech: "", stats: "" });
  }

  mkdirSync(dir, { recursive: true });
  /* La route se déduit du drapeau, pas de la présence de slides (la mosaïque renvoie UNE
     image, le carrousel un ZIP). Le suffixe va aussi dans le nom LOCAL : sans lui, un
     `--mosaique --render` écrasait la carte unique du même projet sous le même nom. */
  const route = flag("mosaique") ? "/api/render-mosaic" : payload.slides ? "/api/render-carousel" : "/api/render";
  const suffixe = route === "/api/render-mosaic" ? "-mosaique" : route === "/api/render-carousel" ? "-carousel" : "";
  const base = `postcraft-${slug(titre(cible.properties))}-${template}-${format}${suffixe}`;
  writeFileSync(join(dir, `${base}.json`), JSON.stringify(payload, null, 2) + "\n");
  console.log(`Fiche « ${titre(cible.properties)} » → template ${template}, format ${format}${payload.slides ? (flag("mosaique") ? `, mosaïque ${payload.slides.length} panneaux` : `, ${payload.slides.length} slides`) : ""}.`);
  console.log(`Payload écrit : ${repertoire}/${base}.json`);

  if (!flag("render")) {
    console.log("Rien n'a été rendu : ajoutez --render pour appeler l'API (ou importez ce JSON dans le studio).");
    return;
  }

  const cle = process.env.POSTCRAFT_KEY || cleDepaire("API_KEY");
  if (!cle) throw new Error("Clé API manquante : POSTCRAFT_KEY (ou .dev.vars pour un test local).");
  const extensionAttendue = route === "/api/render-carousel" ? "zip" : payload.imageType;
  const r = await fetch(`${ORIGINE}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cle}` },
    body: JSON.stringify({ ...payload, filename: `${base}${suffixe}.${extensionAttendue}` }),
  });
  const corps = Buffer.from(await r.arrayBuffer());
  const type = r.headers.get("content-type") || "";
  if (!r.ok) throw new Error(`Rendu refusé (${r.status}) : ${corps.toString().slice(0, 300)}`);
  const extension = type.includes("zip") ? "zip" : type.includes("jpeg") ? "jpg" : "png";
  writeFileSync(join(dir, `${base}.${extension}`), corps);
  console.log(`Rendu via ${ORIGINE}${route} → ${repertoire}/${base}.${extension} (${(corps.length / 1024).toFixed(0)} Ko)`);
  if (extension === "zip") {
    console.log("Le ZIP contient une image par slide, numérotées dans l'ordre du carrousel.");
  }
}

main().catch((e) => { console.error("ERREUR :", e.message); process.exit(1); });
