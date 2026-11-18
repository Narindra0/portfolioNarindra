/* Flux B, volet parcours — régénère data/parcours.json depuis la base Notion « Parcours ».
   Même architecture que notion-to-projects.mjs : Notion porte le contenu, le JSON poussé
   sur la branche « donnees » est lu en direct par le site (0 crédit Netlify par modification).

   Usage :
     NOTION_TOKEN=… NOTION_DS_PARCOURS=… node scripts/notion-to-parcours.mjs --check    compare sans écrire
     NOTION_TOKEN=… NOTION_DS_PARCOURS=… node scripts/notion-to-parcours.mjs --write    écrit data/parcours.json
     NOTION_TOKEN=… NOTION_DS_PARCOURS=… node scripts/notion-to-parcours.mjs --publish  écrit + passe les fiches
                                                                                    « À ajouter » à « Ajouté »

   Propriétés attendues dans la base (créées par scripts/creer-base-parcours.mjs) :
     Nom (titre)            — la structure : Pass'io, Zanova, BOA Madagascar…
     Poste (texte)          — le rôle affiché en grand : Développeur FullStack…
     Badge (sélection)      — le contrat : Fondateur & CEO, CDD, Stagiaire…
     Période (date)         — début + fin. Fin vide = expérience en cours (« Depuis … — Présent »),
                              mise en avant automatique (point et badge orange). Un événement
                              d'un seul mois (Hackathon) doit porter une fin dans le même mois,
                              sinon il serait traité comme en cours.
     Période affichée (texte, facultatif) — remplace le libellé calculé, pour les cas particuliers.
     Description (texte)    — le paragraphe de la carte.
     Hashtags (multi-sélection) — affichés avec un # devant, sans le saisir.
     Statut Portfolio (sélection) — Brouillon / À ajouter / Ajouté, même porte que les projets.
     Mise en avant (case)   — force le traitement orange même sur une expérience terminée.
     Ordre (nombre, facultatif) — priorité manuelle ; sinon : en cours d'abord, puis début décroissant.

   Porte de complétude : une fiche sans nom, sans poste, sans description ou sans période
   est tenue en attente (log « ! en attente ») et ne monte pas sur le site. Une base qui ne
   donne AUCUNE fiche publiable fait échouer le run sans rien écrire : jamais de timeline vide.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOKEN = process.env.NOTION_TOKEN;
const DS = process.env.NOTION_DS_PARCOURS;
const MODE = process.argv.includes('--publish') ? 'publish'
  : process.argv.includes('--write') ? 'write' : 'check';

if (!TOKEN) { console.error('NOTION_TOKEN manquant'); process.exit(1); }
if (!DS) { console.error('NOTION_DS_PARCOURS manquant (identifiant de la source de données de la base Parcours)'); process.exit(1); }

const H = { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' };

async function api(path, init = {}) {
  const r = await fetch(`https://api.notion.com${path}`, { ...init, headers: H });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${r.status} ${b?.code || ''} :: ${b?.message || ''}`);
  return b;
}

/* — lecture des propriétés, types du 2025-09-03 — */
const txt = (p, n) => (p[n]?.rich_text || []).map((t) => t.plain_text).join('');
const title = (p) => (p['Nom']?.title || []).map((t) => t.plain_text).join('');
const one = (p, n) => p[n]?.select?.name || '';
const many = (p, n) => (p[n]?.multi_select || []).map((o) => o.name);
const check = (p, n) => p[n]?.checkbox === true;
const num = (p, n) => (typeof p[n]?.number === 'number' ? p[n].number : null);

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

/* Libellé de période calculé depuis la date Notion, mêmes conventions que le HTML d'origine :
   « Octobre 2024 » (un mois), « Septembre — Décembre 2025 » (même année),
   « Août 2024 — Octobre 2024 » (années différentes), « Depuis 2025 — Présent » (fin vide). */
function periodeDe(pr) {
  const forcee = txt(pr, 'Période affichée').trim();
  if (forcee) return forcee;
  const d = pr['Période']?.date;
  const debut = (d?.start || '').slice(0, 10);
  const fin = (d?.end || '').slice(0, 10);
  if (!debut) return '';
  const [ad, md] = debut.split('-').map(Number);
  if (!fin) return `Depuis ${ad} — Présent`;
  const [af, mf] = fin.split('-').map(Number);
  if (ad === af && md === mf) return `${MOIS[md - 1]} ${ad}`;
  if (ad === af) return `${MOIS[md - 1]} — ${MOIS[mf - 1]} ${ad}`;
  return `${MOIS[md - 1]} ${ad} — ${MOIS[mf - 1]} ${af}`;
}

async function main() {
  const pages = [];
  let cursor;
  do {
    const q = await api(`/v1/data_sources/${DS}/query`, {
      method: 'POST',
      body: JSON.stringify(cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 })
    });
    (q.results || []).forEach((p) => pages.push(p));
    cursor = q.has_more ? q.next_cursor : undefined;
  } while (cursor);

  const candidates = pages.filter((p) => ['À ajouter', 'Ajouté'].includes(one(p.properties, 'Statut Portfolio')));

  // Porte de complétude : même règle que les projets — une fiche trop légère reste « À ajouter ».
  const incomplet = (p) => {
    const manque = [];
    if (!(title(p.properties) || '').trim()) manque.push('nom');
    if (!txt(p.properties, 'Poste').trim()) manque.push('poste');
    if (!txt(p.properties, 'Description').trim()) manque.push('description');
    if (!periodeDe(p.properties)) manque.push('période');
    return manque;
  };
  const retenues = [];
  const enattente = [];
  for (const p of candidates) {
    const m = incomplet(p);
    if (m.length) enattente.push({ p, manque: m }); else retenues.push(p);
  }
  const ecartees = pages.length - retenues.length;

  console.log(`fiches lues: ${pages.length} | publiables: ${retenues.length} | écartées (hors « À ajouter/Ajouté »): ${ecartees}`);
  enattente.forEach(({ p, manque }) => console.log(' ! en attente :', title(p.properties), '— manque', manque.join(' + '), '— la fiche reste « À ajouter », rien n\'est publié'));

  // Garde anti-vide intégrée au script : une base mal lue (ou pas encore remplie) ne doit
  // jamais remplacer la timeline en ligne par un tableau vide. Le run échoue, l'ancien JSON reste.
  if (!retenues.length) {
    console.error('ÉCHEC : aucune fiche publiable — data/parcours.json n\'est pas touché. Remplir au moins une fiche (statut « À ajouter », nom + poste + description + période).');
    process.exit(1);
  }

  const parcours = retenues.map((p) => {
    const pr = p.properties;
    const d = pr['Période']?.date;
    const debut = (d?.start || '').slice(0, 10);
    const fin = (d?.end || '').slice(0, 10);
    const enCours = Boolean(debut && !fin);
    const ordre = num(pr, 'Ordre');
    return {
      id: p.id,
      nom: title(pr),
      poste: txt(pr, 'Poste').trim(),
      badge: one(pr, 'Badge'),
      periode: periodeDe(pr),
      debut,
      fin,
      en_cours: enCours,
      mise_en_avant: check(pr, 'Mise en avant') || enCours,
      description: txt(pr, 'Description').replace(/\s+/g, ' ').trim(),
      hashtags: many(pr, 'Hashtags'),
      ...(ordre !== null ? { ordre } : {})
    };
  });

  // En cours d'abord (Pass'io reste en tête), puis début décroissant ; « Ordre » gagne s'il est posé.
  parcours.sort((a, b) => {
    const oa = a.ordre ?? 999;
    const ob = b.ordre ?? 999;
    if (oa !== ob) return oa - ob;
    if (a.en_cours !== b.en_cours) return a.en_cours ? -1 : 1;
    return String(b.debut).localeCompare(String(a.debut));
  });

  const json = JSON.stringify(parcours, null, 2) + '\n';
  const out = new URL('../data/parcours.json', import.meta.url);
  const current = existsSync(fileURLToPath(out)) ? readFileSync(out, 'utf8') : '';

  parcours.forEach((x) => console.log(' -', x.nom, '|', x.badge || '(sans badge)', '|', x.periode, x.mise_en_avant ? '| mise en avant' : ''));

  if (json === current) {
    console.log('\nIDENTIQUE au data/parcours.json actuel — aucun changement à pousser.');
  } else {
    const before = current ? JSON.parse(current) : [];
    console.log('\nDIFFÉRENCES avec le fichier actuel :');
    const ids = new Set([...before.map((x) => x.id), ...parcours.map((x) => x.id)]);
    for (const id of ids) {
      const a = before.find((x) => x.id === id);
      const b = parcours.find((x) => x.id === id);
      if (!a) { console.log(` + nouveau : ${b.nom}`); continue; }
      if (!b) { console.log(` - retiré  : ${a.nom}`); continue; }
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) {
        if (k === 'id') continue;
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
          console.log(`   ~ ${a.nom} — ${k}: ${JSON.stringify(a[k]).slice(0, 70)}  →  ${JSON.stringify(b[k]).slice(0, 70)}`);
        }
      }
    }
    if (MODE === 'check') console.log('\n(mode check : rien n\'a été écrit)');
  }

  if (MODE !== 'check' && json !== current) {
    writeFileSync(out, json);
    console.log('\ndata/parcours.json régénéré (' + parcours.length + ' expériences).');
  }

  if (MODE === 'publish') {
    const aMarquer = retenues.filter((p) => one(p.properties, 'Statut Portfolio') === 'À ajouter');
    for (const p of aMarquer) {
      await api(`/v1/pages/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ properties: { 'Statut Portfolio': { select: { name: 'Ajouté' } } } })
      });
      console.log('   statut portfolio → Ajouté :', title(p.properties));
    }
    if (!aMarquer.length) console.log('   aucune fiche À ajouter à marquer.');
  }
}

main().catch((e) => { console.error('ÉCHEC :', e.message); process.exit(1); });