/* Vérifie les 4 fonds d'écran en mode clair */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const CHROME = 'C:/Users/it_st/AppData/Local/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe';
const OUT = 'C:/Users/it_st/Downloads/portfolioNarindra/.verify';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9336', '--window-size=1440,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map();
try {
    for (let i = 0; i < 40; i++) {
        try {
            const list = await (await fetch('http://127.0.0.1:9336/json/list')).json();
            const p = list.find(t => t.type === 'page');
            if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); break; }
        } catch (_) { }
        await sleep(250);
    }
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
    const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, m => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => rej(new Error(method + ' timeout')), 20000); });
    const evalJS = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.navigate', { url: 'http://localhost:8734/os.html' });
    await sleep(4000);
    await evalJS(`applySystemTheme('light')`);
    await evalJS(`closeWindow('explorer')`);
    await sleep(400);
    for (let i = 0; i < 4; i++) {
        const info = await evalJS(`(() => { const s = getComputedStyle(document.body); return { cls: document.body.className, img: s.backgroundImage.slice(0, 60), color: s.backgroundColor }; })()`);
        console.log(`fond ${i}:`, JSON.stringify(info));
        const r = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(`${OUT}/wall-light-${i}.png`, Buffer.from(r.data, 'base64'));
        await evalJS(`changeWallpaper()`); await sleep(500);
    }
    console.log('OK fonds clairs capturés');
} catch (e) { console.error('ERREUR:', e.message); process.exitCode = 1; }
finally { try { ws && ws.close(); } catch (_) { } chrome.kill(); }