/* Setup one-shot du volet parcours — crée la base Notion « Parcours — Portfolio » avec les
   propriétés exactes attendues par notion-to-parcours.mjs, puis y seede les expériences de
   data/parcours.json (la copie embarquée qui sert aujourd'hui le site).

   À ne lancer QU'UNE FOIS. Pré-requis :
     1. Dans Notion, créer (ou choisir) une page qui hébergera la base, ex. « Portfolio ».
     2. Partager cette page avec l'intégration du NOTION_TOKEN existant
        (page -> … -> Connections -> ajouter l'intégration). Sans ce partage : 404.
     3. Récupérer l'identifiant de la page (URL ou « Copy link » : les 32 hex finaux).

   Usage (Git Bash) :
     NOTION_TOKEN=ntn_… NOTION_PAGE_PARCOURS=<id-de-la-page> node scripts/creer-base-parcours.mjs

   À la fin, le script affiche l'identifiant de source de données à poser comme variable
   GitHub NOTION_DS_PARCOURS (Settings -> Secrets and variables -> Actions -> Variables,
   ou `gh variable set NOTION_DS_PARCOURS --body <id>`). Dès que la variable existe, le cron
   de 15 minutes de portfolio-sync.yml prend le relais et pousse data/parcours.json sur
   « donnees » — sans aucun déploiement Netlify.
 */
import { readFileSync } from 'node:fs';

const TOKEN = process.env.NOTION_TOKEN;
/* Accepte l'ID nu OU le lien Notion complet (« Copy link »). On isole le dernier segment du
   CHEMIN (on ignore ?v=… qui est l'ID de la vue, pas de la page), on retire les tirets d'un
   éventuel UUID, et on prend les 32 hex finaux — l'ancre de fin évite qu'une lettre hex du
   titre (ex. « Cafe ») ne décale l'ID. */
function extractPageId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const seg = s.split(/[?#]/)[0].split('/').filter(Boolean).pop() || '';
  const m = seg.replace(/-/g, '').match(/([0-9a-fA-F]{32})$/);
  return m ? m[1].toLowerCase() : '';
}
const PAGE = extractPageId(process.env.NOTION_PAGE_PARCOURS);
const TITRE = process.env.NOTION_PARCOURS_TITRE || 'Parcours — Portfolio';

if (!TOKEN) { console.error('NOTION_TOKEN manquant'); process.exit(1); }
if (!PAGE) { console.error('NOTION_PAGE_PARCOURS manquant ou illisible (colle le lien Notion de la page, ou son ID 32 hex)'); process.exit(1); }
if (process.env.NOTION_DS_PARCOURS) {
  console.error('NOTION_DS_PARCOURS est déjà posé : la base semble exister. Ce script ne doit tourner qu\'une fois — abandon pour éviter un doublon.');
  process.exit(1);
}

const H = { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' };

async function api(path, init = {}) {
  const r = await fetch(`https://api.notion.com${path}`, { ...init, headers: H });
  const b = await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 404) throw new Error(`404 :: page introuvable ou non partagée avec l'intégration (… -> Connections). ${b?.message || ''}`);
    if (r.status === 401) throw new Error(`401 :: NOTION_TOKEN invalide. ${b?.message || ''}`);
    throw new Error(`${r.status} ${b?.code || ''} :: ${b?.message || ''}`);
  }
  return b;
}

const rt = (s) => [{ type: 'text', text: { content: String(s || '').slice(0, 2000) } }];
const sel = (name) => ({ select: { name } });

async function main() {
  const seed = JSON.parse(readFileSync(new URL('../data/parcours.json', import.meta.url), 'utf8'));
  if (!Array.isArray(seed) || !seed.length) throw new Error('data/parcours.json vide : rien à seeder.');

  const badges = [...new Set([
    'Fondateur & CEO', 'CDI', 'CDD', 'Alternance', 'Stage', 'Stagiaire',
    'Stage Technique', 'Freelance', 'Participant', 'Bénévolat',
    ...seed.map((x) => x.badge).filter(Boolean)
  ])].map((name) => ({ name }));
  const hashtags = [...new Set(seed.flatMap((x) => x.hashtags || []))].map((name) => ({ name }));

  console.log(`Création de la base « ${TITRE} » sous la page ${PAGE}…`);
  const db = await api('/v1/databases', {
    method: 'POST',
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: PAGE },
      title: rt(TITRE),
      initial_data_source: {
        properties: {
          'Nom': { title: {} },
          'Poste': { rich_text: {} },
          'Badge': { select: { options: badges } },
          'Période': { date: {} },
          'Période affichée': { rich_text: {} },
          'Description': { rich_text: {} },
          'Hashtags': { multi_select: { options: hashtags } },
          'Statut Portfolio': {
            select: {
              options: [
                { name: 'Brouillon', color: 'gray' },
                { name: 'À ajouter', color: 'yellow' },
                { name: 'Ajouté', color: 'green' }
              ]
            }
          },
          'Mise en avant': { checkbox: {} },
          'Ordre': { number: { format: 'number' } }
        }
      }
    })
  });

  const ds = db.data_sources?.[0]?.id;
  if (!ds) throw new Error('Réponse inattendue : pas de data_sources dans la base créée. ' + JSON.stringify(db).slice(0, 300));
  console.log('Base créée. Source de données :', ds);

  for (const x of seed) {
    const properties = {
      'Nom': { title: rt(x.nom) },
      'Poste': { rich_text: rt(x.poste) },
      'Description': { rich_text: rt(x.description) },
      'Période': { date: { start: x.debut, end: x.fin || null } },
      'Hashtags': { multi_select: (x.hashtags || []).map((name) => ({ name })) },
      'Statut Portfolio': sel('Ajouté'),
      'Mise en avant': { checkbox: x.mise_en_avant === true }
    };
    if (x.badge) properties['Badge'] = sel(x.badge);
    await api('/v1/pages', {
      method: 'POST',
      body: JSON.stringify({ parent: { type: 'data_source_id', data_source_id: ds }, properties })
    });
    console.log(' + seedée :', x.nom, '|', x.periode);
  }

  console.log('\nTERMINÉ. Dernière étape, une seule fois :');
  console.log(`  GitHub -> Narindra0/portfolioNarindra -> Settings -> Secrets and variables -> Actions -> Variables -> New variable`);
  console.log(`  Nom : NOTION_DS_PARCOURS   Valeur : ${ds}`);
  console.log(`  (ou en CLI : gh variable set NOTION_DS_PARCOURS --body ${ds})`);
  console.log('Dès le prochain cron (15 min max), data/parcours.json part sur « donnees » et le site le lit en direct.');
}

main().catch((e) => { console.error('ÉCHEC :', e.message); process.exit(1); });