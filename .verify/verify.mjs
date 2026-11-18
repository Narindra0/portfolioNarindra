/* Vérification réelle du Portfolio OS (dark + light) via Chrome DevTools Protocol */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const CHROME = 'C:/Users/it_st/AppData/Local/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe';
const OUT = 'C:/Users/it_st/Downloads/portfolioNarindra/.verify';
const URL = 'http://localhost:8734/os.html';
const PORT = 9333;
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, info = '') => { results.push({ name, pass: !!pass, info }); console.log(`${pass ? 'OK ' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

const chrome = spawn(CHROME, ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--window-size=1440,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

let ws, msgId = 0;
const pending = new Map();
const events = [];
const consoleErrors = [];

async function connect() {
    for (let i = 0; i < 40; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
            const page = list.find(t => t.type === 'page');
            if (page) {
                ws = new WebSocket(page.webSocketDebuggerUrl);
                await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
                ws.onmessage = ev => {
                    const m = JSON.parse(ev.data);
                    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
                    else if (m.method) {
                        events.push(m.method);
                        if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('EXCEPTION: ' + JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
                        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
                        if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push('log: ' + m.params.entry.text.slice(0, 200) + ' ' + (m.params.entry.url || ''));
                    }
                };
                return;
            }
        } catch (_) { }
        await sleep(250);
    }
    throw new Error('Chrome CDP injoignable');
}

function send(method, params = {}) {
    return new Promise((res, rej) => {
        const id = ++msgId;
        pending.set(id, m => m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result));
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(method + ' timeout')); } }, 30000);
    });
}

async function evalJS(expression) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
}

async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
    console.log('capture ' + name + '.png');
}

async function waitBoot() {
    for (let i = 0; i < 40; i++) {
        const loaded = await evalJS(`location.href.startsWith('http://localhost:8734') && !!document.getElementById('desktop')`).catch(() => false);
        if (loaded) break;
        if (i === 20) await send('Page.navigate', { url: URL }).catch(() => { });
        await sleep(500);
    }
    await sleep(2500);
    for (let i = 0; i < 20; i++) {
        const gone = await evalJS(`!document.getElementById('boot-screen')`);
        if (gone) return;
        await sleep(500);
    }
}
async function goto() {
    await send('Page.navigate', { url: URL });
    for (let i = 0; i < 40; i++) {
        const loaded = await evalJS(`location.href.startsWith('http://localhost:8734') && !!document.getElementById('desktop')`).catch(() => false);
        if (loaded) break;
        await sleep(500);
    }
    await sleep(2500);
    for (let i = 0; i < 20; i++) {
        const gone = await evalJS(`!document.getElementById('boot-screen')`);
        if (gone) return;
        await sleep(500);
    }
}

try {
    await connect();
    await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
    await goto();

    // ---------- MODE SOMBRE (défaut) ----------
    ok('boot terminé, bureau visible', await evalJS(`!!document.getElementById('desktop') && !document.getElementById('boot-screen')`));
    ok('thème sombre par défaut', await evalJS(`document.documentElement.dataset.theme === undefined`));
    ok('explorateur ouvert au démarrage', await evalJS(`!!document.querySelector('.explorer-shell')`));
    const darkBg = await evalJS(`getComputedStyle(document.querySelector('.explorer-shell')).backgroundColor`);
    ok('fond explorateur sombre', darkBg.startsWith('rgba(17, 18, 23'), darkBg);
    ok('bouton thème défini (toggleSystemTheme)', await evalJS(`typeof toggleSystemTheme === 'function'`));
    ok('bouton thème état initial inactif', await evalJS(`document.getElementById('theme-toggle').getAttribute('aria-pressed') === 'false'`));
    await shot('01-dark-desktop');

    // ---------- ORDRE DES ICÔNES (bureau + Accueil explorateur) ----------
    const expectedKeys = ['this-pc-shortcut', 'system-explorer', 'documents-shortcut', 'images-shortcut', 'app-about', 'app-projects', 'app-skills', 'app-resume', 'app-terminal', 'app-contact', 'link-classic'];
    const domKeys = await evalJS(`[...document.querySelectorAll('#desktop-icons-grid > .desktop-icon')].map(i => i.dataset.desktopKey)`);
    ok('ordre DOM du bureau groupé par famille', JSON.stringify(domKeys) === JSON.stringify(expectedKeys), domKeys.join(','));
    const cols = await evalJS(`(() => { const m = new Map(); [...document.querySelectorAll('#desktop-icons-grid > .desktop-icon')].forEach(i => { const x = Math.round(i.getBoundingClientRect().left); if (!m.has(x)) m.set(x, []); m.get(x).push(i.dataset.desktopKey); }); return [...m.values()]; })()`);
    ok('colonnes visuelles : système / portfolio / outils', cols.length === 3 && cols[0].join() === expectedKeys.slice(0, 4).join() && cols[1].join() === expectedKeys.slice(4, 8).join() && cols[2].join() === expectedKeys.slice(8).join(), JSON.stringify(cols));
    const recentNames = await evalJS(`[...document.querySelectorAll('.explorer-home-recent .explorer-item-name')].map(e => e.textContent)`);
    const projPart = recentNames.slice(2);
    ok('Récents Accueil : projets triés comme le dossier Projets', projPart.length === 4 && JSON.stringify(projPart) === JSON.stringify([...projPart].sort((a, b) => a.localeCompare(b, 'fr'))), recentNames.join(' | '));
    await evalJS(`closeWindow('explorer')`); await sleep(300);
    await shot('11-desktop-order');
    await evalJS(`openApp('explorer')`); await sleep(300);

    // ouvrir chaque application en sombre
    for (const app of ['about', 'projects', 'skills', 'resume', 'terminal', 'contact']) {
        await evalJS(`openApp('${app}')`); await sleep(400);
        const len = await evalJS(`(document.querySelector('#window-${app} .window-body')||{innerHTML:''}).innerHTML.length`);
        ok(`app ${app} rendue (sombre)`, len > 200, len + ' caractères');
        await evalJS(`closeWindow('${app}')`).catch(() => { });
    }

    // ---------- MODE CLAIR ----------
    await evalJS(`toggleSystemTheme()`); await sleep(600);
    ok('attribut data-theme=light posé', await evalJS(`document.documentElement.dataset.theme === 'light'`));
    ok('thème persisté dans localStorage', await evalJS(`localStorage.getItem('portfolio-os-theme-v1') === 'light'`));
    ok('bouton thème actif synchronisé', await evalJS(`document.getElementById('theme-toggle').getAttribute('aria-pressed') === 'true' && document.getElementById('theme-toggle').classList.contains('bg-blue-600')`));
    ok('menu contextuel synchronisé', await evalJS(`document.getElementById('context-theme-label').textContent === 'Passer en mode sombre'`));
    const lightBg = await evalJS(`getComputedStyle(document.querySelector('.explorer-shell')).backgroundColor`);
    ok('fond explorateur clair', lightBg.startsWith('rgba(248, 250, 253'), lightBg);
    const bodyColor = await evalJS(`getComputedStyle(document.body).color`);
    ok('texte du bureau sombre sur fond clair', bodyColor === 'rgb(15, 23, 42)', bodyColor);
    const iconLabel = await evalJS(`getComputedStyle(document.querySelector('.desktop-icon span')).color`);
    ok('libellés icônes bureau lisibles', iconLabel === 'rgb(30, 41, 59)', iconLabel);
    await shot('02-light-desktop');

    // menu Démarrer + paramètres rapides en clair
    await evalJS(`toggleStartMenu()`); await sleep(400);
    const startInfo = await evalJS(`(() => {
        const m = document.getElementById('start-menu');
        const tile = m.querySelector('.bg-gradient-to-br i');
        const label = m.querySelector('input');
        return { visible: !m.classList.contains('hidden'), tileColor: tile ? getComputedStyle(tile).color : null, bg: getComputedStyle(m).backgroundColor };
    })()`);
    ok('menu Démarrer visible (clair)', startInfo.visible, startInfo.bg);
    ok('glyphes des tuiles Démarrer blancs sur dégradé', startInfo.tileColor === 'rgb(255, 255, 255)', startInfo.tileColor);
    await shot('09-light-start-menu');
    await evalJS(`toggleStartMenu()`); await sleep(200);
    await evalJS(`toggleQuickSettings()`); await sleep(400);
    const qsInfo = await evalJS(`(() => {
        const q = document.getElementById('quick-settings');
        const btn = document.getElementById('theme-toggle');
        return { visible: !q.classList.contains('hidden'), btnBg: getComputedStyle(btn).backgroundColor, btnColor: getComputedStyle(btn).color };
    })()`);
    ok('paramètres rapides visibles (clair)', qsInfo.visible);
    ok('bouton thème actif bleu/blanc (clair)', qsInfo.btnBg === 'rgb(37, 99, 235)' && qsInfo.btnColor === 'rgb(255, 255, 255)', JSON.stringify(qsInfo));
    await shot('10-light-quick-settings');
    await evalJS(`toggleQuickSettings()`); await sleep(200);

    // apps en clair + contrastes clés
    for (const app of ['about', 'projects', 'skills', 'resume', 'contact']) {
        await evalJS(`openApp('${app}')`); await sleep(400);
        const info = await evalJS(`(() => {
            const w = document.querySelector('#window-${app} .window-body');
            if (!w) return { len: 0 };
            const white = w.querySelector('.text-white');
            return { len: w.innerHTML.length, whiteColor: white ? getComputedStyle(white).color : null };
        })()`);
        ok(`app ${app} rendue (clair)`, info.len > 200, info.len + ' caractères');
        if (info.whiteColor) ok(`app ${app} : .text-white assombri`, info.whiteColor !== 'rgb(255, 255, 255)', info.whiteColor);
    }
    await shot('03-light-apps');

    // terminal : reste sombre (theme-keep-dark)
    await evalJS(`openApp('terminal')`); await sleep(400);
    const term = await evalJS(`(() => {
        const root = document.querySelector('#window-terminal .theme-keep-dark');
        if (!root) return null;
        const typed = root.querySelector('.text-white') || root.querySelector('p');
        return { bg: getComputedStyle(root).backgroundColor, color: getComputedStyle(typed).color };
    })()`);
    ok('terminal présent avec theme-keep-dark', !!term);
    ok('terminal reste sombre en mode clair', term && term.color === 'rgb(255, 255, 255)' && term.bg.startsWith('rgba(9, 11, 16'), JSON.stringify(term));

    // commandes terminal light/dark
    await evalJS(`(() => { const i = document.getElementById('terminal-input'); i.value = 'dark'; handleTerminalCommand({ key: 'Enter', target: i, preventDefault(){} }); })()`);
    await sleep(300);
    ok('commande terminal "dark"', await evalJS(`document.documentElement.dataset.theme === undefined`));
    await evalJS(`(() => { const i = document.getElementById('terminal-input'); i.value = 'light'; handleTerminalCommand({ key: 'Enter', target: i, preventDefault(){} }); })()`);
    await sleep(300);
    ok('commande terminal "light"', await evalJS(`document.documentElement.dataset.theme === 'light'`));
    const helpHas = await evalJS(`(() => { const i = document.getElementById('terminal-input'); i.value = 'help'; handleTerminalCommand({ key: 'Enter', target: i, preventDefault(){} }); return document.getElementById('terminal-output').textContent.includes('light') && document.getElementById('terminal-output').textContent.includes('dark'); })()`);
    ok('aide terminal mentionne light/dark', helpHas);
    await shot('04-light-terminal');

    // explorateur en clair : navigation + vues
    await evalJS(`openApp('explorer')`); await sleep(300);
    await evalJS(`document.querySelector('.explorer-sidebar-link[data-path="Projets"]').click()`); await sleep(300);
    ok('navigation Projets (clair)', await evalJS(`document.querySelectorAll('.explorer-item').length >= 5`), await evalJS(`document.querySelectorAll('.explorer-item').length`) + ' éléments');
    await shot('05-light-explorer-projets');
    const firstProject = await evalJS(`document.querySelector('.explorer-item[data-item-kind="folder"]').dataset.explorerItem`);
    await evalJS(`(() => { const el = document.querySelector('.explorer-item[data-item-kind="folder"]'); el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`); await sleep(400);
    ok('ouverture dossier projet (clair)', await evalJS(`document.querySelectorAll('.explorer-item').length >= 2`), firstProject);
    await shot('06-light-explorer-detail');

    // persistance après rechargement
    await goto();
    ok('mode clair persistant après rechargement', await evalJS(`document.documentElement.dataset.theme === 'light'`));
    ok('bouton thème resynchronisé après rechargement', await evalJS(`document.getElementById('theme-toggle').getAttribute('aria-pressed') === 'true'`));
    const bootBgEarly = await evalJS(`getComputedStyle(document.documentElement).colorScheme`);
    ok('color-scheme light', bootBgEarly === 'light', bootBgEarly);

    // retour sombre + rechargement
    await evalJS(`toggleSystemTheme()`); await sleep(300);
    ok('retour au mode sombre', await evalJS(`document.documentElement.dataset.theme === undefined && localStorage.getItem('portfolio-os-theme-v1') === 'dark'`));
    await goto();
    ok('mode sombre persistant après rechargement', await evalJS(`document.documentElement.dataset.theme === undefined`));

    // ---------- RÉORGANISATION DU BUREAU PAR GLISSER-DÉPOSER ----------
    await evalJS(`(() => {
        const grid = document.getElementById('desktop-icons-grid');
        const icons = [...grid.querySelectorAll(':scope > .desktop-icon')];
        const src = icons[0], dst = icons[5];
        const dt = new DataTransfer();
        src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
        dst.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
        src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    })()`);
    const expectedDragged = ['system-explorer', 'documents-shortcut', 'images-shortcut', 'app-about', 'this-pc-shortcut', 'app-projects', 'app-skills', 'app-resume', 'app-terminal', 'app-contact', 'link-classic'];
    const savedOrder = await evalJS(`JSON.parse(localStorage.getItem('portfolio-os-desktop-order-v1') || 'null')`);
    ok('glisser-déposer : nouvel ordre persisté', JSON.stringify(savedOrder) === JSON.stringify(expectedDragged), JSON.stringify(savedOrder));
    await goto();
    const afterKeys = await evalJS(`[...document.querySelectorAll('#desktop-icons-grid > .desktop-icon')].map(i => i.dataset.desktopKey)`);
    ok('ordre personnalisé restauré après rechargement', JSON.stringify(afterKeys) === JSON.stringify(expectedDragged), afterKeys.join(','));
    await evalJS(`localStorage.removeItem('portfolio-os-desktop-order-v1')`);
    await goto();
    const resetKeys = await evalJS(`[...document.querySelectorAll('#desktop-icons-grid > .desktop-icon')].map(i => i.dataset.desktopKey)`);
    ok('ordre par défaut propre après réinitialisation', JSON.stringify(resetKeys) === JSON.stringify(expectedKeys), resetKeys.join(','));

    // ---------- MOBILE (clair, chargement réel en 390px) ----------
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await evalJS(`localStorage.setItem('portfolio-os-theme-v1', 'light')`);
    await goto();
    ok('mode clair appliqué dès le boot mobile', await evalJS(`document.documentElement.dataset.theme === 'light'`));
    const winBounds = await evalJS(`(() => { const w = document.getElementById('window-explorer'); if (!w) return null; const r = w.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: window.innerWidth, vh: window.innerHeight }; })()`);
    ok('fenêtre explorateur cadrée dans le viewport mobile', winBounds && winBounds.left >= 0 && winBounds.right <= winBounds.vw + 1 && winBounds.top >= 0 && winBounds.bottom <= winBounds.vh + 1, JSON.stringify(winBounds));
    const overflow = await evalJS(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
    ok('pas de débordement horizontal (mobile clair)', overflow);
    const taskbarVisible = await evalJS(`(() => { const t = document.getElementById('taskbar-apps'); if (!t) return false; const r = t.getBoundingClientRect(); return r.bottom <= window.innerHeight + 2 && r.height > 0; })()`);
    ok('barre des tâches visible (mobile)', taskbarVisible);
    await shot('07-light-mobile');
    // terminal mobile : ouvrir puis vérifier fond sombre
    await evalJS(`openApp('terminal')`); await sleep(400);
    const termBgMobile = await evalJS(`getComputedStyle(document.querySelector('#window-terminal .theme-keep-dark')).backgroundColor`);
    ok('console terminal sombre en mode clair', termBgMobile.startsWith('rgba(9, 11, 16'), termBgMobile);
    await shot('08-light-mobile-terminal');
    await send('Emulation.clearDeviceMetricsOverride');

    // ---------- ERREURS CONSOLE ----------
    const realErrors = consoleErrors.filter(e => !/favicon|net::ERR|Failed to load resource|404/.test(e));
    ok('aucune erreur JS runtime', realErrors.length === 0, realErrors.slice(0, 5).join(' | ') || 'aucune');
    if (consoleErrors.length) console.log('Toutes les entrées console (info réseau inclus):\n' + consoleErrors.join('\n'));

    const fails = results.filter(r => !r.pass);
    console.log(`\nBILAN : ${results.length - fails.length}/${results.length} vérifications réussies`);
    writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
    process.exitCode = fails.length ? 1 : 0;
} catch (e) {
    console.error('ERREUR DU SCRIPT DE VÉRIFICATION :', e.message);
    writeFileSync(`${OUT}/results.json`, JSON.stringify({ error: e.message, results }, null, 2));
    process.exitCode = 2;
} finally {
    try { ws && ws.close(); } catch (_) { }
    chrome.kill();
}