/* Vérification réelle de l'ancrage des fenêtres (Aero Snap, layouts, assist, clavier) */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const CHROME = 'C:/Users/it_st/AppData/Local/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe';
const OUT = 'C:/Users/it_st/Downloads/portfolioNarindra/.verify';
const URL = 'http://localhost:8734/os.html';
const PORT = 9337;
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, info = '') => { results.push({ name, pass: !!pass, info }); console.log(`${pass ? 'OK ' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const chrome = spawn(CHROME, ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--window-size=1440,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let ws, msgId = 0; const pending = new Map(); const consoleErrors = [];
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
                    else if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('EXCEPTION: ' + JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
                    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
                };
                return;
            }
        } catch (_) { }
        await sleep(250);
    }
    throw new Error('CDP injoignable');
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
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64')); console.log('capture ' + name + '.png'); };
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
async function drag(x1, y1, x2, y2, pauseBeforeRelease = false) {
    await mouse('mousePressed', x1, y1);
    const steps = 12;
    for (let i = 1; i <= steps; i++) await mouse('mouseMoved', x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps);
    if (pauseBeforeRelease) return;
    await mouse('mouseReleased', x2, y2);
}
const release = (x, y) => mouse('mouseReleased', x, y);
async function goto() {
    await send('Page.navigate', { url: URL });
    for (let i = 0; i < 40; i++) {
        if (await evalJS(`location.href.startsWith('http://localhost:8734') && !!document.getElementById('desktop')`).catch(() => false)) break;
        await sleep(500);
    }
    await sleep(2500);
    for (let i = 0; i < 20; i++) { if (await evalJS(`!document.getElementById('boot-screen')`)) return; await sleep(500); }
}
const rectOf = id => evalJS(`(() => { const r = document.getElementById('window-${id}').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const near = (a, b, tol = 4) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;
const headerCenter = id => evalJS(`(() => { const r = document.querySelector('#window-${id} .window-header').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);

try {
    await connect();
    await send('Runtime.enable'); await send('Page.enable');
    await goto();
    const W = await evalJS(`window.innerWidth`), H = await evalJS(`window.innerHeight - 48`);
    await evalJS(`openApp('about')`); await sleep(400);
    await evalJS(`closeWindow('about')`); await sleep(200); // repartir avec une seule fenêtre pour le premier snap
    // ---------- 1. Drag vers le bord gauche : aperçu + ancrage ----------
    let hc = await headerCenter('explorer');
    await drag(hc.x, hc.y, 4, 400, true);
    const previewVisible = await evalJS(`!document.getElementById('snap-preview').hidden`);
    const previewRect = await evalJS(`(() => { const r = document.getElementById('snap-preview').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    ok('aperçu d’ancrage visible pendant le drag', previewVisible, JSON.stringify(previewRect));
    await shot('20-snap-preview');
    await release(4, 400); await sleep(400);
    let r = await rectOf('explorer');
    ok('drag bord gauche → moitié gauche', near(r, { x: 0, y: 0, w: W / 2, h: H }), JSON.stringify(r));
    ok('état snap mémorisé', await evalJS(`windowStates['explorer'].snap === 'left'`));
    // ---------- 2. Snap assist avec une seconde fenêtre ----------
    await evalJS(`openApp('about')`); await sleep(400);
    await evalJS(`window.osSnap.apply('explorer', 'left')`); await sleep(300);
    const assistUp = await evalJS(`!document.getElementById('snap-assist').hidden && !!document.querySelector('[data-assist-app="about"]')`);
    ok('snap assist propose la fenêtre voisine', assistUp);
    await shot('21-snap-assist');
    await evalJS(`document.querySelector('[data-assist-app="about"]').click()`); await sleep(400);
    r = await rectOf('about');
    ok('choix assist → ancrage moitié droite', near(r, { x: W / 2, y: 0, w: W / 2, h: H }), JSON.stringify(r));
    ok('assist refermé après choix', await evalJS(`document.getElementById('snap-assist').hidden`));
    await shot('22-snap-halves');
    // ---------- 3. Popover des dispositions au survol d'Agrandir ----------
    const maxBtn = await evalJS(`(() => { const r = document.querySelector('#window-explorer button[title="Agrandir"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await mouse('mouseMoved', maxBtn.x, maxBtn.y); await sleep(350);
    const popInfo = await evalJS(`(() => { const p = document.getElementById('snap-layouts'); return { visible: !p.hidden, zones: p.querySelectorAll('.snap-zone').length, layouts: p.querySelectorAll('.snap-layout').length }; })()`);
    ok('popover dispositions au survol du bouton Agrandir', popInfo.visible && popInfo.zones === 11 && popInfo.layouts === 4, JSON.stringify(popInfo));
    await shot('23-snap-layouts');
    const zoneRect = await evalJS(`(() => { const r = document.querySelector('#snap-layouts .snap-zone[data-zone="bottom-right"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await mouse('mouseMoved', zoneRect.x, zoneRect.y); await sleep(150);
    await mouse('mousePressed', zoneRect.x, zoneRect.y); await mouse('mouseReleased', zoneRect.x, zoneRect.y); await sleep(400);
    r = await rectOf('explorer');
    ok('clic zone → ancrage coin bas droit', near(r, { x: W / 2, y: H / 2, w: W / 2, h: H / 2 }), JSON.stringify(r));
    ok('popover refermé après ancrage', await evalJS(`document.getElementById('snap-layouts').hidden`));
    if (await evalJS(`!document.getElementById('snap-assist').hidden`)) await evalJS(`document.querySelector('.snap-assist-skip').click()`);
    await sleep(200);
    // ---------- 4. Clavier Ctrl+Alt+Flèches ----------
    hc = await headerCenter('about');
    await mouse('mousePressed', hc.x, hc.y); await mouse('mouseReleased', hc.x, hc.y); await sleep(200);
    await evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, altKey: true, bubbles: true }))`); await sleep(350);
    r = await rectOf('about');
    ok('Ctrl+Alt+Gauche → moitié gauche', near(r, { x: 0, y: 0, w: W / 2, h: H }), JSON.stringify(r));
    if (await evalJS(`!document.getElementById('snap-assist').hidden`)) await evalJS(`document.querySelector('.snap-assist-skip').click()`);
    await evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', ctrlKey: true, altKey: true, bubbles: true }))`); await sleep(350);
    ok('Ctrl+Alt+Haut → plein écran', await evalJS(`windowStates['about'].maximized === true`));
    await evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true, altKey: true, bubbles: true }))`); await sleep(350);
    ok('Ctrl+Alt+Bas → restauration', await evalJS(`windowStates['about'].maximized === false && windowStates['about'].snap === null`));
    // ---------- 5. Drag d'une fenêtre ancrée : restitution de la taille ----------
    const before = await evalJS(`windowStates['explorer'].prevBounds.width`);
    hc = await headerCenter('explorer');
    await drag(hc.x, hc.y, 700, 420); await sleep(400);
    const afterW = await evalJS(`document.getElementById('window-explorer').offsetWidth`);
    ok('drag depuis ancrage → taille d’origine restituée', Math.abs(afterW - before) <= 2 && await evalJS(`windowStates['explorer'].snap === null`), `${afterW}px vs ${before}px`);
    // ---------- 6. Redimensionnement manuel désancre ----------
    await evalJS(`window.osSnap.apply('explorer', 'right', false)`); await sleep(300);
    const handle = await evalJS(`(() => { const r = document.querySelector('#window-explorer .resize-handle').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await drag(handle.x, handle.y, handle.x - 80, handle.y - 40); await sleep(300);
    ok('resize manuel → désancrage', await evalJS(`windowStates['explorer'].snap === null`));
    // ---------- 7. Recadrage au changement de viewport ----------
    await evalJS(`window.osSnap.apply('explorer', 'left', false)`); await sleep(300);
    await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    r = await rectOf('explorer');
    ok('fenêtre ancrée recadrée au resize viewport', near(r, { x: 0, y: 0, w: 600, h: 752 }), JSON.stringify(r));
    await send('Emulation.clearDeviceMetricsOverride'); await sleep(500);
    // ---------- 8. Mode clair : popover + assist ----------
    await evalJS(`applySystemTheme('light')`); await sleep(400);
    await evalJS(`window.osSnap.apply('explorer', 'left')`); await sleep(300);
    ok('assist visible en mode clair', await evalJS(`!document.getElementById('snap-assist').hidden`));
    await shot('24-snap-assist-light');
    await evalJS(`document.querySelector('.snap-assist-skip').click()`); await sleep(200);
    const maxBtn2 = await evalJS(`(() => { const r = document.querySelector('#window-explorer button[title="Agrandir"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await mouse('mouseMoved', maxBtn2.x, maxBtn2.y); await sleep(350);
    ok('popover lisible en mode clair', await evalJS(`!document.getElementById('snap-layouts').hidden`));
    await shot('25-snap-layouts-light');
    await evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(200);
    await evalJS(`window.osSnap.apply('about', 'right', false)`); await sleep(300);
    await shot('26-snap-halves-light');
    // ---------- 9. Mobile : pas d'ancrage accidentel ----------
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await goto();
    hc = await headerCenter('explorer');
    await drag(hc.x, hc.y, 2, 400); await sleep(400);
    ok('mobile : aucun ancrage au drag', await evalJS(`!windowStates['explorer'].snap && document.getElementById('snap-preview').hidden`));
    await shot('27-snap-mobile');
    await send('Emulation.clearDeviceMetricsOverride');
    // ---------- Erreurs ----------
    const realErrors = consoleErrors.filter(e => !/favicon|net::ERR|Failed to load resource|404/.test(e));
    ok('aucune erreur JS runtime', realErrors.length === 0, realErrors.slice(0, 5).join(' | ') || 'aucune');
    const fails = results.filter(x => !x.pass);
    console.log(`\nBILAN SNAP : ${results.length - fails.length}/${results.length} vérifications réussies`);
    writeFileSync(`${OUT}/snap-results.json`, JSON.stringify(results, null, 2));
    process.exitCode = fails.length ? 1 : 0;
} catch (e) {
    console.error('ERREUR SCRIPT SNAP :', e.message);
    writeFileSync(`${OUT}/snap-results.json`, JSON.stringify({ error: e.message, results }, null, 2));
    process.exitCode = 2;
} finally { try { ws && ws.close(); } catch (_) { } chrome.kill(); }