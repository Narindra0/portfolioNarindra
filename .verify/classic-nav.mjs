/* Vérification : bouton Version OS = icône Windows sur mobile ET mini icône au scroll (navbar non déformée) */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const CHROME = 'C:/Users/it_st/AppData/Local/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe';
const OUT = 'C:/Users/it_st/Downloads/portfolioNarindra/.verify';
const URL = 'http://localhost:8734/index.html';
const PORT = 9339;
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, info = '') => { results.push({ name, pass: !!pass, info }); console.log(`${pass ? 'OK ' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const chrome = spawn(CHROME, ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--window-size=390,844', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
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
async function goto(url) {
    await send('Page.navigate', { url });
    for (let i = 0; i < 40; i++) {
        if (await evalJS(`location.href.includes('index.html') && !!document.getElementById('navbar')`).catch(() => false)) break;
        await sleep(400);
    }
    await sleep(2200);
}
const navState = () => evalJS(`(() => {
    const btn = document.getElementById('nav-os-btn');
    const label = btn && btn.querySelector('.os-label');
    const glyph = btn && btn.querySelector('.os-icon');
    const mobileIcon = document.querySelector('#nav-container a[href="os.html"]:not(#nav-os-btn)');
    const cont = document.getElementById('nav-container');
    const rb = btn && btn.getBoundingClientRect();
    const rm = mobileIcon && mobileIcon.getBoundingClientRect();
    const rc = cont.getBoundingClientRect();
    const vis = el => !!el && getComputedStyle(el).display !== 'none';
    return {
        scrolled: document.getElementById('navbar').classList.contains('navbar-scrolled'),
        btnRect: rb ? { x: Math.round(rb.x), y: Math.round(rb.y), w: Math.round(rb.width), h: Math.round(rb.height) } : null,
        btnVisible: !!rb && rb.width > 0,
        labelVisible: vis(label),
        glyphVisible: vis(glyph),
        glyphIsWindows: !!glyph && glyph.classList.contains('fa-windows'),
        mobileIconVisible: !!rm && rm.width > 0,
        mobileIconRect: rm ? { x: Math.round(rm.x), y: Math.round(rm.y), w: Math.round(rm.width), h: Math.round(rm.height) } : null,
        contH: Math.round(rc.height),
        overflow: cont.scrollWidth > cont.clientWidth + 1,
        burgerVisible: (() => { const r = document.getElementById('burger').getBoundingClientRect(); return r.width > 0; })(),
        mailVisible: (() => { const r = document.querySelector('#nav-container a[href^="mailto"]').getBoundingClientRect(); return r.width > 0; })()
    };
})()`);
const scrollTo = async y => { await evalJS(`window.scrollTo(0, ${y})`); await sleep(1100); };

try {
    await connect();
    await send('Runtime.enable'); await send('Page.enable');
    // ---------- Mobile ----------
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await goto(URL);
    let s = await navState();
    ok('mobile : icône Windows visible dans la barre', s.mobileIconVisible && s.glyphIsWindows, JSON.stringify(s.mobileIconRect));
    ok('mobile : pilule desktop masquée', !s.btnVisible);
    ok('mobile : burger + email présents', s.burgerVisible && s.mailVisible);
    await scrollTo(700);
    s = await navState();
    ok('mobile scrollé : icône toujours intacte, pas de débordement', s.mobileIconVisible && !s.overflow && s.contH <= 60, `h=${s.contH}`);
    await shot('30-classic-mobile-nav');
    await evalJS(`window.scrollTo(0, 0)`); await sleep(900);
    s = await navState();
    await mouse('mousePressed', s.mobileIconRect.x + 20, s.mobileIconRect.y + 20);
    await mouse('mouseReleased', s.mobileIconRect.x + 20, s.mobileIconRect.y + 20);
    let landed = false;
    for (let i = 0; i < 30; i++) { if (await evalJS(`location.href.includes('os.html')`).catch(() => false)) { landed = true; break; } await sleep(400); }
    ok('mobile : clic icône → Portfolio OS ouvert', landed);
    // ---------- Desktop 1440 ----------
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await goto(URL);
    s = await navState();
    const topH = s.contH;
    ok('desktop haut de page : pilule texte « Version OS »', s.btnVisible && s.labelVisible && !s.glyphVisible, JSON.stringify(s.btnRect));
    ok('desktop haut de page : pilule sur une seule ligne', s.btnRect.h <= 44, `h=${s.btnRect.h}`);
    await shot('31-classic-desktop-nav');
    await scrollTo(700);
    s = await navState();
    ok('desktop scrollé : navbar compacte active', s.scrolled);
    ok('desktop scrollé : bouton devenu mini icône Windows', s.btnVisible && s.glyphVisible && !s.labelVisible && s.btnRect.w <= 40 && s.btnRect.h <= 40, JSON.stringify(s.btnRect));
    ok('desktop scrollé : navbar non déformée (hauteur stable, sans débordement)', s.contH <= topH + 2 && !s.overflow, `h=${s.contH} vs ${topH}`);
    await shot('32-classic-scrolled-nav');
    await mouse('mousePressed', s.btnRect.x + s.btnRect.w / 2, s.btnRect.y + s.btnRect.h / 2);
    await mouse('mouseReleased', s.btnRect.x + s.btnRect.w / 2, s.btnRect.y + s.btnRect.h / 2);
    landed = false;
    for (let i = 0; i < 30; i++) { if (await evalJS(`location.href.includes('os.html')`).catch(() => false)) { landed = true; break; } await sleep(400); }
    ok('desktop scrollé : clic mini icône → Portfolio OS ouvert', landed);
    await goto(URL);
    await scrollTo(700);
    await scrollTo(0);
    s = await navState();
    ok('retour en haut : pilule texte restaurée', s.btnVisible && s.labelVisible && !s.glyphVisible && !s.scrolled);
    // ---------- Largeur intermédiaire 800 ----------
    await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 800, deviceScaleFactor: 1, mobile: false });
    await goto(URL);
    s = await navState();
    ok('800px haut de page : pilule sans retour à la ligne', s.btnVisible && s.labelVisible && s.btnRect.h <= 44 && !s.overflow, `h=${s.btnRect.h}`);
    await scrollTo(700);
    s = await navState();
    ok('800px scrollé : mini icône + navbar sans débordement', s.glyphVisible && !s.labelVisible && s.btnRect.h <= 40 && !s.overflow && s.contH <= 60, JSON.stringify(s.btnRect) + ` h=${s.contH}`);
    await shot('33-classic-midwidth-scrolled');
    const realErrors = consoleErrors.filter(e => !/favicon|net::ERR|Failed to load resource|404/.test(e));
    ok('aucune erreur JS runtime', realErrors.length === 0, realErrors.slice(0, 5).join(' | ') || 'aucune');
    const fails = results.filter(x => !x.pass);
    console.log(`\nBILAN CLASSIC NAV : ${results.length - fails.length}/${results.length} vérifications réussies`);
    writeFileSync(`${OUT}/classic-nav-results.json`, JSON.stringify(results, null, 2));
    process.exitCode = fails.length ? 1 : 0;
} catch (e) {
    console.error('ERREUR SCRIPT CLASSIC NAV :', e.message);
    writeFileSync(`${OUT}/classic-nav-results.json`, JSON.stringify({ error: e.message, results }, null, 2));
    process.exitCode = 2;
} finally { try { ws && ws.close(); } catch (_) { } chrome.kill(); }