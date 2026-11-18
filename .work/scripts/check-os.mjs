import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const html = read("os.html");
const js = read("assets/js/os-explorer.js");
const css = read("assets/css/os-explorer.css");
const manifest = JSON.parse(read("manus-routes.json"));

const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(([, attributes, body]) => !/\bsrc\s*=/.test(attributes) && body.trim())
  .map(([, , body]) => body);
assert.ok(inlineScripts.length, "Le script principal doit être présent dans os.html.");
inlineScripts.forEach((source, index) => new vm.Script(source, { filename: `os-inline-${index + 1}.js` }));
const explorerScript = new vm.Script(js, { filename: "assets/js/os-explorer.js" });
new vm.Script(fs.readFileSync(path.join(root, ".work/scripts/serve-preview.cjs"), "utf8"), { filename: "serve-preview.cjs" });

for (const asset of ["assets/css/os-explorer.css", "assets/js/os-explorer.js", "assets/files/CV-Narindra-Ranjalahy.pdf", "assets/img/Portrait.png", "data/projects.json"]) {
  assert.ok(fs.existsSync(path.join(root, asset)), `Ressource locale absente : ${asset}`);
}
const projectData = JSON.parse(read("data/projects.json"));
assert.ok(Array.isArray(projectData) && projectData.length > 0, "Le portfolio doit conserver des projets exploitables.");
const testWindow = { getAppContent: () => "", openApp: () => {}, innerWidth: 1440, innerHeight: 900 };
const testDocument = { readyState: "loading", addEventListener: () => {} };
const sandbox = {
  window: testWindow, document: testDocument, localStorage: { getItem: () => null, setItem: () => {} },
  appsConfig: {}, projects: projectData, portfolioData: { email: "narindra@example.test" }, console
};
explorerScript.runInNewContext(sandbox);
const homeView = testWindow.getAppContent("explorer", "Accueil");
const pcView = testWindow.getAppContent("explorer", "Ce PC");
const driveView = testWindow.getAppContent("explorer", "Ce PC/Disque local (C:)");
const profilePath = "Ce PC/Disque local (C:)/Utilisateurs/Narindra";
const profileView = testWindow.getAppContent("explorer", profilePath);
const docsAliasView = testWindow.getAppContent("explorer", "Ce PC/Documents");
assert.ok(homeView.includes("explorer-tabstrip") && homeView.includes("Ce PC"), "L’accueil doit afficher les onglets et les raccourcis Ce PC.");
assert.ok(pcView.includes("Périphériques et lecteurs") && pcView.includes("Environnement virtuel"), "Ce PC doit afficher son lecteur C: virtuel.");
for (const folder of ["Program Files", "Program Files (x86)", "ProgramData", "Utilisateurs", "Windows"]) assert.ok(driveView.includes(folder), `Dossier système absent du lecteur C: ${folder}`);
for (const folder of ["Bureau", "Documents", "Images", "Téléchargements", "Vidéos"]) assert.ok(profileView.includes(folder), `Dossier du profil Narindra absent : ${folder}`);
assert.ok(docsAliasView.includes("Curriculum_Vitae_Narindra.pdf"), "Le raccourci Documents de Ce PC doit ouvrir les fichiers du portfolio.");
assert.deepEqual(manifest.routes.map(route => route.path), ["/", "/index.html", "/os.html", "/portfolio_windows_os.html"]);
assert.ok(manifest.routes.every(route => route.title && route.path.startsWith("/")), "Chaque route doit avoir un titre et un chemin absolu.");
assert.ok(css.includes("@media (max-width: 720px)") && css.includes(".explorer-sidebar"), "Les styles responsives de l’explorateur doivent exister.");
const strippedCss = css.replace(/\/\*[\s\S]*?\*\//g, "");
assert.equal((strippedCss.match(/{/g) || []).length, (strippedCss.match(/}/g) || []).length, "Les accolades CSS doivent être équilibrées.");
for (const feature of ["explorer", "photos", "document", "function installDesktopSelection", "function installWindowEnhancements", "function moveFile"]) {
  assert.ok(js.includes(feature), `Fonctionnalité OS absente : ${feature}`);
}
assert.ok(html.includes("openApp('explorer')"), "La session doit ouvrir l’Explorateur au démarrage.");
for (const feature of ["function treeNode", "function addTab", "function activateTab", "function thisPcMarkup", "Lecteur système du portfolio"]) assert.ok(js.includes(feature), `Expérience Windows absente : ${feature}`);
console.log(`QA OK : ${inlineScripts.length} script(s) intégré(s), navigation Ce PC/C:/profil simulée, onglets et lecteur testés, ${projectData.length} projets, ${manifest.routes.length} routes.`);
