/* Portfolio OS — ancrage des fenêtres façon Windows 11 (Aero Snap, layouts, assist) */
(() => {
    const EDGE = 14;
    const CORNER = 96;
    const desk = () => ({ w: window.innerWidth, h: Math.max(320, window.innerHeight - 48) });
    const zonesFor = () => {
        const { w, h } = desk();
        return {
            'left': { x: 0, y: 0, w: w / 2, h },
            'right': { x: w / 2, y: 0, w: w / 2, h },
            'top-left': { x: 0, y: 0, w: w / 2, h: h / 2 },
            'top-right': { x: w / 2, y: 0, w: w / 2, h: h / 2 },
            'bottom-left': { x: 0, y: h / 2, w: w / 2, h: h / 2 },
            'bottom-right': { x: w / 2, y: h / 2, w: w / 2, h: h / 2 },
            'max': { x: 0, y: 0, w, h },
            'wide-left': { x: 0, y: 0, w: w * 2 / 3, h },
            'narrow-right': { x: w * 2 / 3, y: 0, w: w / 3, h },
            'wide-right': { x: w / 3, y: 0, w: w * 2 / 3, h },
            'third-1': { x: 0, y: 0, w: w / 3, h },
            'third-2': { x: w / 3, y: 0, w: w / 3, h },
            'third-3': { x: w * 2 / 3, y: 0, w: w / 3, h }
        };
    };
    const complement = {
        'left': 'right', 'right': 'left',
        'top-left': 'right', 'bottom-left': 'right',
        'top-right': 'left', 'bottom-right': 'left',
        'wide-left': 'narrow-right', 'narrow-right': 'wide-left',
        'third-1': 'wide-right', 'third-2': 'third-3', 'third-3': 'wide-left',
        'max': null
    };
    const layouts = [
        { name: 'Deux moitiés', zones: ['left', 'right'], grid: false },
        { name: 'Grand + petit', zones: ['wide-left', 'narrow-right'], grid: false },
        { name: 'Trois colonnes', zones: ['third-1', 'third-2', 'third-3'], grid: false },
        { name: 'Quatre coins', zones: ['top-left', 'top-right', 'bottom-left', 'bottom-right'], grid: true }
    ];
    const zoneLabel = {
        'left': 'Moitié gauche', 'right': 'Moitié droite', 'max': 'Plein écran',
        'top-left': 'Coin haut gauche', 'top-right': 'Coin haut droit',
        'bottom-left': 'Coin bas gauche', 'bottom-right': 'Coin bas droit',
        'wide-left': 'Deux tiers gauche', 'narrow-right': 'Tiers droit', 'wide-right': 'Deux tiers droit',
        'third-1': 'Colonne gauche', 'third-2': 'Colonne centrale', 'third-3': 'Colonne droite'
    };

    let dragZone = null;
    let popoverApp = null;
    let hideTimer = 0;
    let assistZone = null;

    const preview = document.createElement('div');
    preview.id = 'snap-preview';
    preview.hidden = true;
    const popover = document.createElement('div');
    popover.id = 'snap-layouts';
    popover.className = 'mica-dark';
    popover.hidden = true;
    const assist = document.createElement('div');
    assist.id = 'snap-assist';
    assist.hidden = true;
    document.body.append(preview, popover, assist);

    const html = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

    function hidePreview() { preview.hidden = true; }
    function showPreview(zone) {
        const z = zonesFor()[zone];
        if (!z) return hidePreview();
        preview.style.left = `${Math.round(z.x) + 6}px`;
        preview.style.top = `${Math.round(z.y) + 6}px`;
        preview.style.width = `${Math.round(z.w) - 12}px`;
        preview.style.height = `${Math.round(z.h) - 12}px`;
        preview.hidden = false;
    }
    function hidePopover() { clearTimeout(hideTimer); popoverApp = null; popover.hidden = true; }
    function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(hidePopover, 220); }
    function hideAssist() { assistZone = null; assist.hidden = true; assist.innerHTML = ''; }

    function setRect(el, z) {
        el.style.left = `${Math.round(z.x)}px`;
        el.style.top = `${Math.round(z.y)}px`;
        el.style.width = `${Math.round(z.w)}px`;
        el.style.height = `${Math.round(z.h)}px`;
    }

    function applySnap(appId, zone, withAssist = true) {
        const st = windowStates[appId];
        const el = document.getElementById(`window-${appId}`);
        const z = zonesFor()[zone];
        if (!st || !el || !z) return;
        if (!st.snap && !st.maximized) {
            st.prevBounds = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
        }
        el.classList.add('window-transition');
        setRect(el, z);
        el.classList.add('rounded-xl');
        st.maximized = false;
        st.snap = zone;
        setTimeout(() => el.classList.remove('window-transition'), 250);
        focusWindow(appId);
        renderTaskbar();
        hidePopover();
        if (withAssist) showAssist(appId, zone); else hideAssist();
    }

    function restoreBounds(appId) {
        const st = windowStates[appId];
        const el = document.getElementById(`window-${appId}`);
        if (!st || !el || !st.prevBounds) return;
        el.classList.add('window-transition');
        el.style.left = `${st.prevBounds.left}px`;
        el.style.top = `${st.prevBounds.top}px`;
        el.style.width = `${st.prevBounds.width}px`;
        el.style.height = `${st.prevBounds.height}px`;
        st.snap = null;
        st.maximized = false;
        setTimeout(() => el.classList.remove('window-transition'), 250);
        focusWindow(appId);
    }

    function unsnapForDrag(appId, x, y) {
        const st = windowStates[appId];
        const el = document.getElementById(`window-${appId}`);
        if (!st || !el || !st.snap) return;
        const b = st.prevBounds;
        const ratio = Math.min(.9, Math.max(.1, (x - el.offsetLeft) / Math.max(1, el.offsetWidth)));
        st.snap = null;
        el.style.width = `${b.width}px`;
        el.style.height = `${b.height}px`;
        el.style.left = `${Math.round(x - b.width * ratio)}px`;
        el.style.top = `${Math.max(0, Math.round(y - 20))}px`;
    }

    function detectZone(x, y) {
        const { w, h } = desk();
        const left = x <= EDGE, right = x >= w - EDGE;
        const top = y <= CORNER, bottom = y >= h - CORNER;
        if (left && top) return 'top-left';
        if (right && top) return 'top-right';
        if (left && bottom) return 'bottom-left';
        if (right && bottom) return 'bottom-right';
        if (left) return 'left';
        if (right) return 'right';
        if (y <= 8) return 'max';
        return null;
    }

    function openPopover(appId, anchor) {
        clearTimeout(hideTimer);
        if (popoverApp === appId && !popover.hidden) return;
        popoverApp = appId;
        popover.innerHTML = `<div class="snap-layouts-title">Dispositions d’ancrage</div>
            <div class="snap-layouts-grid">${layouts.map((layout, li) => `
                <div class="snap-layout ${layout.grid ? 'is-grid' : ''}" role="group" aria-label="${html(layout.name)}">
                    ${layout.zones.map(zone => `<button type="button" class="snap-zone" data-zone="${zone}" style="flex-grow:${zone.startsWith('wide') ? 2 : 1}" title="${html(zoneLabel[zone])}" aria-label="${html(layout.name)} — ${html(zoneLabel[zone])}"></button>`).join('')}
                </div>`).join('')}
            </div>
            <p class="snap-layouts-hint"><i class="ph ph-cursor-click"></i> Glissez aussi une fenêtre vers un bord ou un coin de l’écran.</p>`;
        popover.hidden = false;
        const r = anchor.getBoundingClientRect();
        const pw = popover.offsetWidth, ph = popover.offsetHeight;
        let left = Math.min(Math.max(8, r.right - pw), window.innerWidth - pw - 8);
        let top = r.bottom + 10;
        if (top + ph > window.innerHeight - 56) top = Math.max(8, r.top - ph - 10);
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
    }

    function showAssist(appId, zone) {
        const cz = complement[zone];
        const z = cz && zonesFor()[cz];
        const others = Object.keys(windowStates).filter(id => id !== appId && windowStates[id] && !windowStates[id].minimized && document.getElementById(`window-${id}`));
        if (!z || !others.length) return hideAssist();
        assistZone = cz;
        assist.style.left = `${Math.round(z.x)}px`;
        assist.style.top = `${Math.round(z.y)}px`;
        assist.style.width = `${Math.round(z.w)}px`;
        assist.style.height = `${Math.round(z.h)}px`;
        assist.innerHTML = `<div class="snap-assist-card mica-dark" role="dialog" aria-label="Compléter l’ancrage">
            <div class="snap-assist-head"><i class="ph-fill ph-squares-four"></i><span>Compléter l’ancrage</span>
                <button type="button" class="snap-assist-close" data-assist-dismiss aria-label="Ignorer"><i class="ph ph-x"></i></button></div>
            <div class="snap-assist-list">${others.map(id => {
                const cfg = appsConfig[id] || {};
                return `<button type="button" class="snap-assist-item" data-assist-app="${html(id)}">
                    <span class="snap-assist-icon bg-gradient-to-br ${html(cfg.color || 'from-blue-500 to-indigo-600')}"><i class="ph-fill ${html(cfg.icon || 'ph-app-window')}"></i></span>
                    <span class="snap-assist-copy"><strong>${html(cfg.title || id)}</strong><small>${html(zoneLabel[cz])}</small></span>
                    <i class="ph ph-arrow-right snap-assist-arrow"></i></button>`;
            }).join('')}</div>
            <button type="button" class="snap-assist-skip" data-assist-dismiss>Ignorer pour l’instant</button>
        </div>`;
        assist.hidden = false;
    }

    /* ---- Ponts avec le gestionnaire de fenêtres existant ---- */
    window.addEventListener('os-snap-dragstart', event => {
        const { appId, x, y } = event.detail;
        hideAssist();
        hidePopover();
        unsnapForDrag(appId, x, y);
        dragZone = null;
    });
    window.addEventListener('os-snap-drag', event => {
        if (window.innerWidth < 768) return;
        const { x, y } = event.detail;
        dragZone = detectZone(x, y);
        if (dragZone) showPreview(dragZone); else hidePreview();
    });
    window.addEventListener('os-snap-dragend', event => {
        const { appId } = event.detail;
        const zone = dragZone;
        dragZone = null;
        hidePreview();
        if (zone && window.innerWidth >= 768) applySnap(appId, zone);
    });
    window.addEventListener('os-snap-resize', event => {
        const st = windowStates[event.detail.appId];
        if (st && st.snap) st.snap = null;
        hideAssist();
    });

    const originalToggleMaximize = window.toggleMaximize;
    window.toggleMaximize = function (appId) {
        hidePopover();
        hideAssist();
        const st = windowStates[appId];
        if (st) st.snap = null;
        return originalToggleMaximize(appId);
    };

    /* ---- Survol du bouton Agrandir : popover des dispositions ---- */
    document.addEventListener('mouseover', event => {
        if (window.innerWidth < 768) return;
        const btn = event.target.closest('button[title="Agrandir"]');
        if (btn) {
            const win = btn.closest('.mica-window');
            if (win) openPopover(win.id.replace('window-', ''), btn);
            return;
        }
        if (!event.target.closest('#snap-layouts')) scheduleHide();
    });
    popover.addEventListener('click', event => {
        const zone = event.target.closest('.snap-zone');
        if (!zone || !popoverApp) return;
        applySnap(popoverApp, zone.dataset.zone);
    });

    /* ---- Snap assist : choix de la fenêtre voisine ---- */
    assist.addEventListener('click', event => {
        const item = event.target.closest('[data-assist-app]');
        if (item && assistZone) {
            const target = item.dataset.assistApp;
            const zone = assistZone;
            hideAssist();
            applySnap(target, zone, false);
            return;
        }
        if (event.target.closest('[data-assist-dismiss]') || event.target === assist) hideAssist();
    });

    /* ---- Raccourcis Ctrl+Alt+Flèches (équivalent Win+Flèches) ---- */
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') { hidePopover(); hideAssist(); hidePreview(); return; }
        if (!(event.ctrlKey && event.altKey) || event.metaKey) return;
        const appId = activeWindow;
        if (!appId || !windowStates[appId]) return;
        const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'max', ArrowDown: 'restore' };
        const action = map[event.key];
        if (!action) return;
        event.preventDefault();
        hideAssist();
        if (action === 'max') {
            if (!windowStates[appId].maximized) window.toggleMaximize(appId);
        } else if (action === 'restore') {
            if (windowStates[appId].maximized) window.toggleMaximize(appId);
            else restoreBounds(appId);
        } else {
            applySnap(appId, action);
        }
    });

    /* ---- Recadrage des fenêtres ancrées si le viewport change ---- */
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            hidePopover();
            hideAssist();
            hidePreview();
            const zones = zonesFor();
            Object.entries(windowStates).forEach(([id, st]) => {
                if (!st || !st.snap) return;
                const el = document.getElementById(`window-${id}`);
                if (el && zones[st.snap]) setRect(el, zones[st.snap]);
            });
        }, 120);
    });

    window.osSnap = { apply: applySnap, zones: zonesFor };
})();