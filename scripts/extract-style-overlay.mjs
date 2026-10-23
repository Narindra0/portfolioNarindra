/* Extrait le calque de style (ce que Notion ne porte pas) de data/projects.json
   vers data/style-overlay.json, indexé par identifiant de fiche Notion. */
import { readFileSync, writeFileSync } from 'node:fs';

const list = JSON.parse(readFileSync(new URL('../data/projects.json', import.meta.url), 'utf8'));
const STYLE_KEYS = [
  'label_court', 'sous_titre', 'badge', 'badge_icone', 'couleur', 'couleur_secondaire',
  'icone', 'titre_section_fonctionnalites', 'titre_section_competences',
  'titre_section_mission', 'titre_section_mise_en_oeuvre', 'etapes'
];

const overlay = {};
list.forEach((p, i) => {
  const e = { ordre: i + 1 };
  STYLE_KEYS.forEach((k) => { if (p[k] !== undefined) e[k] = p[k]; });
  if (p.lien && p.lien.libelle !== undefined) e.lien_libelle = p.lien.libelle;
  const icons = {};
  (p.fonctionnalites || []).forEach((f) => { if (f.icone && f.nom) icons[f.nom] = f.icone; });
  if (Object.keys(icons).length) e.fonctionnalites_icone = icons;
  overlay[p.id] = e;
});

writeFileSync(
  new URL('../data/style-overlay.json', import.meta.url),
  JSON.stringify(overlay, null, 2) + '\n'
);
console.log('calque écrit pour', Object.keys(overlay).length, 'fiches');
