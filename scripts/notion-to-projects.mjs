/* Flux B — régénère data/projects.json depuis Notion, en préservant le calque de style.
   Notion porte le contenu ; data/style-overlay.json porte la mise en scène (couleurs,
   icônes, libellés, ordre). Les deux sont indexés par l'identifiant de la fiche Notion.

   Usage :
     NOTION_TOKEN=… node scripts/notion-to-projects.mjs --check        compare sans écrire
     NOTION_TOKEN=… node scripts/notion-to-projects.mjs --write       écrit data/projects.json
     NOTION_TOKEN=… node scripts/notion-to-projects.mjs --publish     écrit + passe les fiches
                                                                  « À ajouter » à « Ajouté »
   Porte de complétude : une fiche « À ajouter » sans nom, sans description ou sans catégorie
   est tenue en attente (log « ! en attente ») et ne monte pas sur le site ; son statut n'est
   pas touché, elle sera publiée au run suivant une fois remplie.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const TOKEN = process.env.NOTION_TOKEN;
const DS = process.env.NOTION_DS || '78e87c8c-4916-4d46-8cd2-00b0bcd471fa';
const MODE = process.argv.includes('--publish') ? 'publish'
  : process.argv.includes('--write') ? 'write' : 'check';

if (!TOKEN) { console.error('NOTION_TOKEN manquant'); process.exit(1); }

const H = { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' };

async function api(path, init = {}) {
  const r = await fetch(`https://api.notion.com${path}`, { ...init, headers: H });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${r.status} ${b?.code || ''} :: ${b?.message || ''}`);
  return b;
}

/* — lecture des propriétés, types du 2025-09-03 — */
const txt = (p, n) => (p[n]?.rich_text || []).map((t) => t.plain_text).join('');
const title = (p) => (p['Nom du projet']?.title || []).map((t) => t.plain_text).join('');
const one = (p, n) => p[n]?.select?.name || '';
const many = (p, n) => (p[n]?.multi_select || []).map((o) => o.name);
/* Les fiches créées par le scanner portent l'URL de clonage (.git) ; la carte du portfolio
   doit mener à la page du dépôt. Normalisée ici plutôt que fiche par fiche dans Notion. */
const link = (p, n) => (p[n]?.url || '').replace(/\.git\/?$/, '');
const day = (p, n) => p[n]?.date?.start || '';

/* Description = 1er paragraphe ; reliquat = note (règle inverse de l'import). */
function splitDescription(s) {
  const i = s.search(/\n[ \t]*\n/);
  return i === -1 ? { description: s.trim(), note: '' }
    : { description: s.slice(0, i).trim(), note: s.slice(i).trim() };
}

/* « Nom : description » sur une ligne par fonctionnalité, icône reprise du calque. */
function features(raw, icons) {
  return (raw || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(':');
      const nom = i === -1 ? '' : l.slice(0, i).trim();
      const description = i === -1 ? l.trim() : l.slice(i + 1).trim();
      return nom ? { nom, description, ...(icons?.[nom] ? { icone: icons[nom] } : {}) }
        : { nom: '', description };
    });
}

const DEFAULTS = {
  label_court: '', sous_titre: '', badge: '', badge_icone: 'fa-code',
  couleur: '#607D8B', couleur_secondaire: '#90A4AE', icone: 'fa-cube',
  titre_section_fonctionnalites: 'Fonctionnalités',
  titre_section_competences: 'Compétences mobilisées'
};

async function main() {
  const overlay = JSON.parse(
    await readFile(new URL('../data/style-overlay.json', import.meta.url), 'utf8')
  );

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

  // Porte de complétude : une fiche trop légère ne sort pas sur le site, même marquée « À ajouter ».
  // Une fiche créée par la découverte GitHub n'a ni description ni catégorie : sans cette porte,
  // le run suivant publierait une carte vide sur le portfolio en ligne.
  const incomplet = (p) => {
    const manque = [];
    if (!txt(p.properties, 'Description').trim()) manque.push('description');
    if (!one(p.properties, 'Catégorie')) manque.push('catégorie');
    if (!(title(p.properties) || '').trim()) manque.push('nom');
    return manque;
  };
  const retenues = [];
  const enattente = [];
  for (const p of candidates) {
    const m = incomplet(p);
    if (m.length) enattente.push({ p, manque: m }); else retenues.push(p);
  }
  const ecartees = pages.length - retenues.length;

  const projects = retenues.map((p) => {
    const pr = p.properties;
    const id = p.id;
    const st = overlay[id] || {};
    const type = one(pr, 'Type de lien') || 'Visiter';
    const url = type === 'GitHub' ? link(pr, 'Lien GitHub') : type === 'Aucun' ? '' : (link(pr, 'Lien Démo') || link(pr, 'Lien GitHub'));
    const { description, note } = splitDescription(txt(pr, 'Description'));

    return {
      id,
      nom: title(pr),
      categorie: one(pr, 'Catégorie'),
      accroche: txt(pr, 'Accroche'),
      label_court: st.label_court ?? DEFAULTS.label_court,
      sous_titre: st.sous_titre ?? DEFAULTS.sous_titre,
      role: txt(pr, 'Rôle'),
      mission: txt(pr, 'Mission'),
      description,
      badge: st.badge ?? DEFAULTS.badge,
      badge_icone: st.badge_icone ?? DEFAULTS.badge_icone,
      titre_section_fonctionnalites: st.titre_section_fonctionnalites ?? DEFAULTS.titre_section_fonctionnalites,
      titre_section_competences: st.titre_section_competences ?? DEFAULTS.titre_section_competences,
      ...(st.etapes ? { etapes: st.etapes } : {}),
      fonctionnalites: features(txt(pr, 'Fonctionnalités'), st.fonctionnalites_icone),
      technologies: many(pr, 'Technologies'),
      couleur: st.couleur ?? DEFAULTS.couleur,
      couleur_secondaire: st.couleur_secondaire ?? DEFAULTS.couleur_secondaire,
      icone: st.icone ?? DEFAULTS.icone,
      lien: {
        type,
        url,
        ...(st.lien_libelle !== undefined ? { libelle: st.lien_libelle } : {}),
        ...(note ? { note } : {})
      },
      date: day(pr, 'Date de création'),
      ...(st.titre_section_mission ? { titre_section_mission: st.titre_section_mission } : {}),
      ...(st.titre_section_mise_en_oeuvre ? { titre_section_mise_en_oeuvre: st.titre_section_mise_en_oeuvre } : {})
    };
  });

  projects.sort((a, b) => {
    const oa = overlay[a.id]?.ordre ?? 999;
    const ob = overlay[b.id]?.ordre ?? 999;
    return oa !== ob ? oa - ob : String(b.date).localeCompare(String(a.date));
  });

  const json = JSON.stringify(projects, null, 2) + '\n';
  const out = new URL('../data/projects.json', import.meta.url);
  const current = existsSync(fileURLToPath(out)) ? readFileSync(out, 'utf8') : '';

  console.log(`fiches lues: ${pages.length} | publiables: ${retenues.length} | écartées (hors « À ajouter/Ajouté »): ${ecartees}`);
  enattente.forEach(({ p, manque }) => console.log(' ! en attente :', title(p.properties), '— manque', manque.join(' + '), '— la fiche reste « À ajouter », rien n\'est publié'));

  projects.forEach((p) => console.log(' -', p.nom, '|', p.categorie, '| lien', p.lien.type, p.lien.url || '(aucun)', '|', p.fonctionnalites.length, 'fonctionnalités'));

  if (json === current) {
    console.log('\nIDENTIQUE au data/projects.json actuel — aucun changement à pousser.');
  } else {
    const before = current ? JSON.parse(current) : [];
    console.log('\nDIFFÉRENCES avec le fichier actuel :');
    const ids = new Set([...before.map((p) => p.id), ...projects.map((p) => p.id)]);
    for (const id of ids) {
      const a = before.find((p) => p.id === id);
      const b = projects.find((p) => p.id === id);
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
    console.log('\ndata/projects.json régénéré (' + projects.length + ' projets).');
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
