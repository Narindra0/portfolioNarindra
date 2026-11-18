/* Portfolio OS — explorateur de fichiers virtuel du portfolio Narindra */
(() => {
    const projectAssets = {
        'pass-io': 'assets/visuels/pass-io.png',
        'ravina': 'assets/visuels/ravina.png',
        'noovy': 'assets/visuels/noovy.png',
        'digikaratra': 'assets/visuels/digikaratra.png',
        'yas-ussd': 'assets/visuels/yas-ussd.png',
        'busnaka': 'assets/visuels/busnaka.png',
        'godmod': 'assets/visuels/godmod.png',
        'talenta': 'assets/visuels/talenta.png',
        'boa-manager': 'assets/visuels/boa-manager.png',
        'meshway': 'assets/visuels/meshway.png',
        'fjkmgestionnaire': 'assets/visuels/fjkmgestionnaire.png'
    };
    const movesKey = 'portfolio-os-file-locations-v1';
    const desktopOrderKey = 'portfolio-os-desktop-order-v1';
    const driveRoot = 'Ce PC/Disque local (C:)';
    const usersRoot = `${driveRoot}/Utilisateurs`;
    const profileRoot = `${usersRoot}/Narindra`;
    const shellFolderAliases = {
        'Ce PC/Bureau': 'Bureau', 'Ce PC/Documents': 'Documents',
        'Ce PC/Téléchargements': 'Téléchargements', 'Ce PC/Images': 'Images',
        'Ce PC/Musique': 'Musique', 'Ce PC/Vidéos': 'Vidéos',
        [`${profileRoot}/Bureau`]: 'Bureau', [`${profileRoot}/Documents`]: 'Documents',
        [`${profileRoot}/Téléchargements`]: 'Téléchargements', [`${profileRoot}/Images`]: 'Images',
        [`${profileRoot}/Musique`]: 'Musique', [`${profileRoot}/Vidéos`]: 'Vidéos',
        [`${profileRoot}/Projets`]: 'Projets'
    };
    const state = {
        path: 'Accueil', history: ['Accueil'], historyIndex: 0,
        view: 'grid', sort: 'name', query: '', selected: new Set(),
        anchor: null, visibleItems: [], moves: readMoves(), contextPath: null,
        expandedPaths: new Set(['Ce PC']),
        tabs: [{ id: 1, path: 'Accueil', history: ['Accueil'], historyIndex: 0 }],
        activeTab: 1, nextTabId: 2
    };

    function readMoves() {
        try { return JSON.parse(localStorage.getItem(movesKey) || '{}'); }
        catch (_) { return {}; }
    }
    function saveMoves() {
        try { localStorage.setItem(movesKey, JSON.stringify(state.moves)); }
        catch (_) { if (typeof toggleNotificationToast === 'function') toggleNotificationToast('Le navigateur ne permet pas de mémoriser les déplacements de fichiers.'); }
    }
    function html(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }
    function attr(value) { return html(value).replace(/`/g, '&#96;'); }
    function slug(value) {
        return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }
    function safeLocalPath(value) {
        const candidate = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
        if (!candidate || candidate.split('/').some(part => part === '..' || part === '.')) return '';
        return candidate;
    }
    function iconFor(item) {
        if (item.kind === 'folder') return 'ph-folder';
        if (item.kind === 'pdf') return 'ph-file-pdf';
        if (item.kind === 'image') return 'ph-image';
        if (item.kind === 'link') return 'ph-globe';
        if (item.kind === 'text') return 'ph-file-text';
        return 'ph-file';
    }
    function entry(name, path, kind, options = {}) {
        return {
            name, path, kind, detail: options.detail || '', date: options.date || '17/11/2026',
            action: options.action || '', projectId: options.projectId || '',
            asset: options.asset || '', href: options.href || '', size: options.size || '',
            originalParent: options.originalParent || path.split('/').slice(0, -1).join('/')
        };
    }
    function folder(name, path, detail = '') { return entry(name, path, 'folder', { detail, size: 'Dossier' }); }
    function projectList() { return Array.isArray(projects) ? projects : []; }
    function canonicalFolderPath(path) { return shellFolderAliases[path] || path; }
    function treeChildren(path) {
        const branch = children => children.map(([name, childPath]) => ({ name, path: childPath }));
        if (path === 'Ce PC') return branch([
            ['Bureau', 'Ce PC/Bureau'], ['Documents', 'Ce PC/Documents'],
            ['Téléchargements', 'Ce PC/Téléchargements'], ['Images', 'Ce PC/Images'],
            ['Musique', 'Ce PC/Musique'], ['Vidéos', 'Ce PC/Vidéos'], ['Disque local (C:)', driveRoot]
        ]);
        if (path === driveRoot) return branch([
            ['PerfLogs', `${driveRoot}/PerfLogs`], ['Program Files', `${driveRoot}/Program Files`],
            ['Program Files (x86)', `${driveRoot}/Program Files (x86)`], ['ProgramData', `${driveRoot}/ProgramData`],
            ['Utilisateurs', usersRoot], ['Windows', `${driveRoot}/Windows`]
        ]);
        if (path === usersRoot) return branch([
            ['Narindra', profileRoot], ['Public', `${usersRoot}/Public`]
        ]);
        if (path === `${driveRoot}/Windows`) return branch([
            ['Fonts', `${driveRoot}/Windows/Fonts`], ['System32', `${driveRoot}/Windows/System32`],
            ['SysWOW64', `${driveRoot}/Windows/SysWOW64`], ['Temp', `${driveRoot}/Windows/Temp`],
            ['WinSxS', `${driveRoot}/Windows/WinSxS`]
        ]);
        if (path === `${driveRoot}/Program Files`) return branch([
            ['Common Files', `${driveRoot}/Program Files/Common Files`],
            ['Microsoft Shared', `${driveRoot}/Program Files/Microsoft Shared`],
            ['WindowsApps', `${driveRoot}/Program Files/WindowsApps`]
        ]);
        if (path === `${driveRoot}/Program Files (x86)`) return branch([
            ['Common Files', `${driveRoot}/Program Files (x86)/Common Files`],
            ['Internet Explorer', `${driveRoot}/Program Files (x86)/Internet Explorer`]
        ]);
        if (path === profileRoot) return branch([
            ['Bureau', `${profileRoot}/Bureau`], ['Documents', `${profileRoot}/Documents`],
            ['Images', `${profileRoot}/Images`], ['Musique', `${profileRoot}/Musique`],
            ['Projets', `${profileRoot}/Projets`], ['Téléchargements', `${profileRoot}/Téléchargements`],
            ['Vidéos', `${profileRoot}/Vidéos`]
        ]);
        return [];
    }
    function expandAncestors(path) {
        const parts = path.split('/');
        let current = parts[0];
        if (treeChildren(current).length) state.expandedPaths.add(current);
        for (const part of parts.slice(1)) {
            current += `/${part}`;
            if (treeChildren(current).length) state.expandedPaths.add(current);
        }
    }

    function baseItems(path) {
        if (shellFolderAliases[path]) return baseItems(shellFolderAliases[path]);
        if (path === 'Accueil') return [
            folder('Bureau', 'Bureau', 'Accès rapide • dossiers utilisateur'),
            folder('Documents', 'Documents', 'CV et parcours professionnel'),
            folder('Téléchargements', 'Téléchargements', 'Fichiers prêts à télécharger'),
            folder('Images', 'Images', 'Portrait et réalisations'),
            folder('Projets', 'Projets', `${projectList().length || 11} dossiers de projets`),
            folder('Ce PC', 'Ce PC', 'Dossiers utilisateur et disque local')
        ];
        if (path === 'Ce PC') return [
            folder('Bureau', 'Ce PC/Bureau', 'C:\\Users\\Narindra\\Desktop'),
            folder('Documents', 'Ce PC/Documents', 'C:\\Users\\Narindra\\Documents'),
            folder('Téléchargements', 'Ce PC/Téléchargements', 'C:\\Users\\Narindra\\Downloads'),
            folder('Images', 'Ce PC/Images', 'C:\\Users\\Narindra\\Pictures'),
            folder('Musique', 'Ce PC/Musique', 'C:\\Users\\Narindra\\Music'),
            folder('Vidéos', 'Ce PC/Vidéos', 'C:\\Users\\Narindra\\Videos'),
            folder('Disque local (C:)', driveRoot, 'Structure virtuelle du portfolio')
        ];
        if (path === driveRoot) return [
            folder('PerfLogs', `${driveRoot}/PerfLogs`, 'Journaux de performances • espace virtuel'),
            folder('Program Files', `${driveRoot}/Program Files`, 'Applications système • espace virtuel'),
            folder('Program Files (x86)', `${driveRoot}/Program Files (x86)`, 'Applications 32 bits • espace virtuel'),
            folder('ProgramData', `${driveRoot}/ProgramData`, 'Données système • espace virtuel'),
            folder('Utilisateurs', usersRoot, 'Profils présents dans ce portfolio'),
            folder('Windows', `${driveRoot}/Windows`, 'Répertoires système • espace virtuel')
        ];
        if (path === usersRoot) return [
            folder('Narindra', profileRoot, 'Profil du portfolio'),
            folder('Public', `${usersRoot}/Public`, 'Dossiers partagés • espace virtuel')
        ];
        if (path === profileRoot) return [
            folder('Bureau', `${profileRoot}/Bureau`, 'Dossiers et raccourcis'),
            folder('Documents', `${profileRoot}/Documents`, 'CV et parcours professionnel'),
            folder('Images', `${profileRoot}/Images`, 'Portrait et visuels du portfolio'),
            folder('Musique', `${profileRoot}/Musique`, 'Dossier utilisateur'),
            folder('Projets', `${profileRoot}/Projets`, 'Réalisations de Narindra'),
            folder('Téléchargements', `${profileRoot}/Téléchargements`, 'Fichiers disponibles'),
            folder('Vidéos', `${profileRoot}/Vidéos`, 'Dossier utilisateur')
        ];
        if (path === `${driveRoot}/Windows`) return treeChildren(path).map(child => folder(child.name, child.path, 'Dossier système virtuel'));
        if (path === `${driveRoot}/Program Files` || path === `${driveRoot}/Program Files (x86)`) return treeChildren(path).map(child => folder(child.name, child.path, 'Dossier système virtuel'));
        if (path === 'Bureau') return [
            entry('À propos de Narindra.txt', 'Bureau/À propos de Narindra.txt', 'text', { detail: 'Présentation', action: 'about', size: '2 Ko' }),
            folder('Mes Projets', 'Projets', 'Portfolio • projets réalisés'),
            entry('Compétences.app', 'Bureau/Compétences.app', 'text', { detail: 'Stack technique', action: 'skills', size: '1 Ko' }),
            entry('Curriculum_Vitae_Narindra.pdf', 'Bureau/Curriculum_Vitae_Narindra.pdf', 'pdf', { detail: 'Document PDF', action: 'document', size: '64 Ko' }),
            entry('Portrait.png', 'Bureau/Portrait.png', 'image', { detail: 'Image • PNG', action: 'image', asset: 'assets/img/Portrait.png', size: '172 Ko' }),
            entry('Contact.url', 'Bureau/Contact.url', 'link', { detail: portfolioData.email, action: 'contact', size: '1 Ko' })
        ];
        if (path === 'Documents') return [
            entry('Curriculum_Vitae_Narindra.pdf', 'Documents/Curriculum_Vitae_Narindra.pdf', 'pdf', { detail: 'Adobe PDF • Document', action: 'document', size: '64 Ko' }),
            entry('Parcours_professionnel.txt', 'Documents/Parcours_professionnel.txt', 'text', { detail: 'Expériences et formation', action: 'resume', size: '4 Ko' }),
            entry('Profil_Narindra.txt', 'Documents/Profil_Narindra.txt', 'text', { detail: 'Présentation personnelle', action: 'about', size: '2 Ko' }),
            entry('Contact.url', 'Documents/Contact.url', 'link', { detail: portfolioData.email, action: 'contact', size: '1 Ko' }),
            entry('Portfolio_classique.url', 'Documents/Portfolio_classique.url', 'link', { detail: 'Version classique du portfolio', action: 'classic', size: '1 Ko' })
        ];
        if (path === 'Images') {
            const images = [
                entry('Portrait.png', 'Images/Portrait.png', 'image', { detail: 'Portrait de Narindra • PNG', action: 'image', asset: 'assets/img/Portrait.png', size: '172 Ko' }),
                entry('LogoNarindra.png', 'Images/LogoNarindra.png', 'image', { detail: 'Identité visuelle • PNG', action: 'image', asset: 'assets/img/LogoNarindra.png', size: '61 Ko' }),
                entry('hero-bg.gif', 'Images/hero-bg.gif', 'image', { detail: 'Fond animé • GIF', action: 'image', asset: 'assets/img/hero-bg.gif', size: '1,2 Mo' })
            ];
            projectList().forEach(project => {
                const asset = projectAssets[slug(project.nom)];
                if (asset) images.push(entry(`${project.nom}.png`, `Images/${slug(project.nom)}.png`, 'image', { detail: `Aperçu du projet • ${project.categorie}`, action: 'image', asset, size: '220 Ko' }));
            });
            return images;
        }
        if (path === 'Téléchargements') return [
            entry('CV-Narindra-Ranjalahy.pdf', 'Téléchargements/CV-Narindra-Ranjalahy.pdf', 'pdf', { detail: 'Téléchargement prêt • PDF', action: 'document', size: '64 Ko' }),
            entry('Portrait-Narindra.png', 'Téléchargements/Portrait-Narindra.png', 'image', { detail: 'Photo de profil', action: 'image', asset: 'assets/img/Portrait.png', size: '172 Ko' }),
            entry('Portfolio_classique.url', 'Téléchargements/Portfolio_classique.url', 'link', { detail: 'Ouvrir la version classique', action: 'classic', size: '1 Ko' })
        ];
        if (path === 'Musique' || path === 'Vidéos' || path.endsWith('/Public')) return [];
        if (path === 'Projets') return projectList().map(project => folder(project.nom, `Projets/${project.id}`, project.categorie || 'Projet du portfolio'));

        if (path.startsWith('Projets/')) {
            const projectId = path.slice('Projets/'.length);
            const project = projectList().find(candidate => candidate.id === projectId);
            if (!project) return [];
            const items = [
                entry('Présentation_du_projet.txt', `Projets/${project.id}/Présentation_du_projet.txt`, 'text', { detail: project.role || project.categorie, action: 'project', projectId: project.id, size: '3 Ko' }),
                entry('Technologies.txt', `Projets/${project.id}/Technologies.txt`, 'text', { detail: `${project.technologies.length} technologies`, action: 'project', projectId: project.id, size: '1 Ko' })
            ];
            const asset = projectAssets[slug(project.nom)];
            if (asset) items.push(entry('Aperçu.png', `Projets/${project.id}/Aperçu.png`, 'image', { detail: 'Capture du projet', action: 'image', asset, size: '220 Ko' }));
            if (project.lien && project.lien.url && project.lien.type !== 'Aucun') items.push(entry('Lien_du_projet.url', `Projets/${project.id}/Lien_du_projet.url`, 'link', { detail: project.lien.libelle || project.lien.type, action: 'external', href: project.lien.url, size: '1 Ko' }));
            return items;
        }
        return [];
    }

    function allBaseItems() {
        const systemPaths = [
            'Accueil', 'Ce PC', driveRoot, `${driveRoot}/PerfLogs`, `${driveRoot}/Program Files`,
            `${driveRoot}/Program Files (x86)`, `${driveRoot}/ProgramData`, usersRoot,
            `${usersRoot}/Public`, profileRoot, `${driveRoot}/Windows`, `${driveRoot}/Windows/Fonts`,
            `${driveRoot}/Windows/System32`, `${driveRoot}/Windows/SysWOW64`, `${driveRoot}/Windows/Temp`,
            `${driveRoot}/Windows/WinSxS`, `${driveRoot}/Program Files/Common Files`,
            `${driveRoot}/Program Files/Microsoft Shared`, `${driveRoot}/Program Files/WindowsApps`,
            `${driveRoot}/Program Files (x86)/Common Files`, `${driveRoot}/Program Files (x86)/Internet Explorer`
        ];
        const aliases = Object.keys(shellFolderAliases);
        const portfolioPaths = ['Bureau', 'Documents', 'Images', 'Musique', 'Vidéos', 'Téléchargements', 'Projets', ...projectList().map(project => `Projets/${project.id}`)];
        return [...new Set([...systemPaths, ...aliases, ...portfolioPaths])].flatMap(baseItems);
    }
    function locateBaseItem(itemPath) { return allBaseItems().find(item => item.path === itemPath) || null; }
    function listItems(path) {
        const location = canonicalFolderPath(path);
        let items = baseItems(path).filter(item => !state.moves[item.path] || state.moves[item.path] === location);
        Object.entries(state.moves).forEach(([source, destination]) => {
            if (destination !== location || items.some(item => item.path === source)) return;
            const sourceItem = locateBaseItem(source);
            if (sourceItem && sourceItem.kind !== 'folder') items.push({ ...sourceItem, originalParent: sourceItem.originalParent, moved: true });
        });
        if (state.sort === 'type') items.sort((a, b) => a.kind.localeCompare(b.kind, 'fr') || a.name.localeCompare(b.name, 'fr'));
        else if (state.sort === 'date') items.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, 'fr'));
        else if (state.sort === 'size') items.sort((a, b) => (a.size || '').localeCompare(b.size || '', 'fr', { numeric: true }) || a.name.localeCompare(b.name, 'fr'));
        else items.sort((a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1) || a.name.localeCompare(b.name, 'fr'));
        if (state.query) {
            const query = state.query.toLocaleLowerCase('fr');
            items = items.filter(item => `${item.name} ${item.detail}`.toLocaleLowerCase('fr').includes(query));
        }
        return items;
    }
    function nameForSegment(segment, fullPath) {
        if (segment === 'Accueil') return 'Accueil';
        const project = fullPath.startsWith('Projets/') && segment === fullPath.slice('Projets/'.length)
            ? projectList().find(candidate => candidate.id === segment) : null;
        return project ? project.nom : segment;
    }
    function breadcrumbs() {
        const parts = state.path.split('/');
        return parts.map((part, index) => {
            const path = parts.slice(0, index + 1).join('/');
            return `${index ? '<i class="ph ph-caret-right explorer-breadcrumb-separator"></i>' : ''}<button class="explorer-breadcrumb" data-explorer-action="navigate" data-path="${attr(path)}">${html(nameForSegment(part, state.path))}</button>`;
        }).join('');
    }
    function itemMarkup(item) {
        const selected = state.selected.has(item.path);
        const typeName = item.kind === 'folder' ? 'Dossier' : item.kind === 'pdf' ? 'Document PDF' : item.kind === 'image' ? 'Image' : item.kind === 'link' ? 'Raccourci' : 'Document texte';
        const thumb = item.kind === 'image' && item.asset
            ? `<img class="explorer-item-thumb" src="${attr(item.asset)}" alt="" loading="lazy">`
            : `<span class="explorer-item-icon kind-${attr(item.kind)} ${item.kind === 'folder' ? 'kind-folder' : ''}"><i class="ph-fill ${iconFor(item)}"></i></span>`;
        return `<button class="explorer-item ${selected ? 'is-selected' : ''}" data-explorer-item="${attr(item.path)}" data-item-kind="${attr(item.kind)}" aria-pressed="${selected}" draggable="${item.kind !== 'folder'}" title="${attr(item.name)}">
            ${thumb}<span class="explorer-item-copy"><span class="explorer-item-name">${html(item.name)}</span><span class="explorer-item-detail">${html(item.detail || typeName)}${item.moved ? ' · déplacé' : ''}</span></span>
            <span class="explorer-item-modified">${html(item.date)}</span><span class="explorer-item-type">${html(typeName)}</span><span class="explorer-item-size">${html(item.size || '—')}</span></button>`;
    }
    function listHeaderMarkup() {
        return '<div class="explorer-list-head"><span>Nom</span><span class="explorer-item-modified">Date de modification</span><span class="explorer-item-type">Type</span><span class="explorer-item-size">Taille</span></div>';
    }
    function homeMarkup() {
        const shortcuts = [
            ['Bureau', 'Bureau', 'ph-desktop', 'C:\\Users\\Narindra\\Desktop'],
            ['Documents', 'Documents', 'ph-file-text', 'CV et parcours professionnel'],
            ['Téléchargements', 'Téléchargements', 'ph-download-simple', 'Fichiers prêts à télécharger'],
            ['Images', 'Images', 'ph-images', 'Portrait et visuels de projets'],
            ['Projets', 'Projets', 'ph-folders', `${projectList().length || 11} projets`],
            ['Ce PC', 'Ce PC', 'ph-hard-drives', 'Dossiers et lecteur local C:']
        ];
        const recent = [
            entry('Curriculum_Vitae_Narindra.pdf', 'Documents/Curriculum_Vitae_Narindra.pdf', 'pdf', { detail: 'Documents · PDF', action: 'document', size: '64 Ko' }),
            entry('Portrait.png', 'Images/Portrait.png', 'image', { detail: 'Images · PNG', action: 'image', asset: 'assets/img/Portrait.png', size: '172 Ko' }),
            ...[...projectList()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).slice(0, 4).map(project => entry(`${project.nom} · Présentation`, `Projets/${project.id}/Présentation_du_projet.txt`, 'text', { detail: `Projets · ${project.categorie}`, action: 'project', projectId: project.id }))
        ];
        return `<section class="explorer-section"><h3 class="explorer-section-heading"><i class="ph-fill ph-push-pin-simple text-blue-300"></i> Accès rapide</h3>
            <div class="explorer-quick-grid">${shortcuts.map(([label, path, icon, detail]) => `<button class="explorer-quick-card" data-explorer-action="navigate" data-path="${attr(path)}"><span class="explorer-quick-icon"><i class="ph-fill ${icon}"></i></span><span class="explorer-quick-copy"><strong>${html(label)}</strong><span>${html(detail)}</span></span></button>`).join('')}</div></section>
            <section class="explorer-section explorer-home-recent"><h3 class="explorer-section-heading"><i class="ph-fill ph-clock-counter-clockwise text-amber-300"></i> Récents <small>Documents et projets du portfolio</small></h3>
            <div class="explorer-items list">${listHeaderMarkup()}${recent.map(item => itemMarkup(item)).join('')}</div></section>`;
    }
    function driveMarkup(item) {
        if (!item) return '';
        const selected = state.selected.has(item.path);
        return `<button class="explorer-drive-card ${selected ? 'is-selected' : ''}" data-explorer-item="${attr(item.path)}" data-item-kind="folder" aria-pressed="${selected}" title="Ouvrir ${attr(item.name)}">
            <i class="ph-fill ph-hard-drive explorer-drive-art"></i><span class="explorer-drive-copy"><strong>${html(item.name)}</strong><span>Lecteur système du portfolio</span><span class="explorer-drive-meter"><i></i></span><small>Environnement virtuel • aucun accès à votre disque réel</small></span></button>`;
    }
    function thisPcMarkup() {
        const drive = state.visibleItems.find(item => item.path === driveRoot);
        const folders = state.visibleItems.filter(item => item.path !== driveRoot);
        return `<section class="explorer-section"><h3 class="explorer-section-heading"><i class="ph-fill ph-folder-open text-amber-300"></i> Dossiers</h3>
            <div class="explorer-items grid">${folders.map(itemMarkup).join('')}</div></section>
            <section class="explorer-section explorer-drives-section"><h3 class="explorer-section-heading"><i class="ph-fill ph-hard-drives text-blue-300"></i> Périphériques et lecteurs</h3>${driveMarkup(drive)}</section>`;
    }
    function contentMarkup() {
        state.visibleItems = listItems(state.path);
        if (state.path === 'Accueil') return homeMarkup();
        if (state.path === 'Ce PC') return thisPcMarkup();
        if (!state.visibleItems.length) return `<div class="explorer-empty"><i class="ph ph-folder-open"></i><strong>Aucun résultat</strong><span>Essayez une autre recherche ou choisissez un dossier dans le volet de navigation.</span></div>`;
        const systemNote = state.path.startsWith(driveRoot) ? '<p class="explorer-virtual-note"><i class="ph ph-info"></i> Arborescence Windows simulée pour le portfolio. Les dossiers affichés ne donnent pas accès à cet ordinateur.</p>' : '';
        return `${systemNote}<div class="explorer-items ${state.view}">${state.view === 'list' ? listHeaderMarkup() : ''}${state.visibleItems.map(itemMarkup).join('')}</div>`;
    }
    function sideLink(label, path, icon) {
        const canonical = canonicalFolderPath(state.path);
        const current = state.path === path || canonical === path || state.path.startsWith(`${path}/`) || (path === 'Projets' && state.path.startsWith('Projets/'));
        return `<button class="explorer-sidebar-link ${current ? 'is-current' : ''}" data-explorer-action="navigate" data-path="${attr(path)}" title="${html(label)}" ${current ? 'aria-current="page"' : ''}><i class="ph-fill ${icon}"></i><span>${html(label)}</span></button>`;
    }
    function treeIcon(path) {
        if (path === 'Ce PC') return 'ph-hard-drives';
        if (path === driveRoot) return 'ph-hard-drive';
        if (path === usersRoot) return 'ph-users-three';
        if (path === profileRoot) return 'ph-user-circle';
        if (path.endsWith('/Windows')) return 'ph-windows-logo';
        if (path.includes('Program Files')) return 'ph-app-window';
        if (path === 'Ce PC/Bureau' || path.endsWith('/Bureau')) return 'ph-desktop';
        if (path.endsWith('/Documents') || path === 'Ce PC/Documents') return 'ph-file-text';
        if (path.endsWith('/Images') || path === 'Ce PC/Images') return 'ph-images';
        if (path.endsWith('/Téléchargements') || path === 'Ce PC/Téléchargements') return 'ph-download-simple';
        return 'ph-folder';
    }
    function treeNode(path, label, depth = 0) {
        const children = treeChildren(path);
        const expanded = state.expandedPaths.has(path);
        const current = state.path === path;
        return `<div class="explorer-tree-entry" style="--tree-depth:${depth}">
            ${children.length ? `<button class="explorer-tree-chevron ${expanded ? 'is-expanded' : ''}" data-explorer-action="toggle-tree" data-path="${attr(path)}" aria-label="${expanded ? 'Réduire' : 'Développer'} ${html(label)}" aria-expanded="${expanded}"><i class="ph ph-caret-right"></i></button>` : '<span class="explorer-tree-chevron is-empty"></span>'}
            <button class="explorer-tree-link ${current ? 'is-current' : ''}" data-explorer-action="navigate" data-path="${attr(path)}" title="${html(label)}"><i class="ph-fill ${treeIcon(path)}"></i><span>${html(label)}</span></button></div>
            ${expanded ? children.map(child => treeNode(child.path, child.name, depth + 1)).join('') : ''}`;
    }
    function sidebarMarkup() {
        return `<div class="explorer-sidebar-group"><div class="explorer-sidebar-heading">Accueil</div>${sideLink('Accueil', 'Accueil', 'ph-house')}
            <div class="explorer-sidebar-heading explorer-sidebar-subheading">Accès rapide</div>
            ${sideLink('Bureau', 'Bureau', 'ph-desktop')}${sideLink('Documents', 'Documents', 'ph-file-text')}${sideLink('Téléchargements', 'Téléchargements', 'ph-download-simple')}${sideLink('Images', 'Images', 'ph-images')}${sideLink('Projets', 'Projets', 'ph-folders')}</div>
            <div class="explorer-sidebar-group explorer-tree-group"><div class="explorer-sidebar-heading">Ce PC</div>${treeNode('Ce PC', 'Ce PC')}</div>
            <div class="explorer-sidebar-foot"><i class="ph-fill ph-shield-check"></i><span>Explorateur du portfolio<br><small>Lecteur C: virtuel</small></span></div>`;
    }
    function tabTitle(path) {
        return nameForSegment(path.split('/').at(-1), path);
    }
    function syncActiveTab() {
        const tab = state.tabs.find(candidate => candidate.id === state.activeTab);
        if (tab) Object.assign(tab, { path: state.path, history: [...state.history], historyIndex: state.historyIndex });
    }
    function activateTab(id) {
        syncActiveTab();
        const tab = state.tabs.find(candidate => candidate.id === Number(id));
        if (!tab) return;
        state.activeTab = tab.id;
        state.path = tab.path;
        state.history = [...tab.history];
        state.historyIndex = tab.historyIndex;
        renderAt(state.path, false);
    }
    function addTab() {
        syncActiveTab();
        const tab = { id: state.nextTabId++, path: 'Accueil', history: ['Accueil'], historyIndex: 0 };
        state.tabs.push(tab);
        state.activeTab = tab.id;
        state.history = ['Accueil'];
        state.historyIndex = 0;
        renderAt('Accueil', false);
    }
    function closeTab(id) {
        if (state.tabs.length === 1) { navigate('Accueil'); return; }
        const closing = Number(id);
        const index = state.tabs.findIndex(tab => tab.id === closing);
        state.tabs = state.tabs.filter(tab => tab.id !== closing);
        if (state.activeTab === closing) {
            const next = state.tabs[Math.max(0, index - 1)];
            activateTab(next.id);
        } else renderAt(state.path, false);
    }
    function rerenderSidebar() {
        const sidebar = document.querySelector('#window-explorer .explorer-sidebar');
        if (sidebar) sidebar.innerHTML = sidebarMarkup();
    }
    function tabStripMarkup() {
        return `<div class="explorer-tabstrip" role="tablist" aria-label="Onglets de l’Explorateur">${state.tabs.map(tab => `<div class="explorer-tab ${tab.id === state.activeTab ? 'is-active' : ''}" role="presentation"><button class="explorer-tab-label" role="tab" aria-selected="${tab.id === state.activeTab}" data-explorer-action="select-tab" data-tab-id="${tab.id}" title="${html(tab.path)}"><i class="ph-fill ${tab.path === 'Accueil' ? 'ph-house' : tab.path === 'Ce PC' ? 'ph-hard-drives' : 'ph-folder'}"></i>${html(tabTitle(tab.path))}</button><button class="explorer-tab-close" data-explorer-action="close-tab" data-tab-id="${tab.id}" aria-label="Fermer l’onglet" title="Fermer l’onglet"><i class="ph ph-x"></i></button></div>`).join('')}<button class="explorer-new-tab" data-explorer-action="new-tab" aria-label="Nouvel onglet" title="Nouvel onglet"><i class="ph ph-plus"></i></button></div>`;
    }
    function markup(path) {
        state.path = safeLocalPath(path) || 'Accueil';
        expandAncestors(state.path);
        state.selected.clear();
        state.query = '';
        const viewLabel = state.view === 'grid' ? 'Icônes' : 'Liste';
        const addressIcon = state.path === 'Accueil' ? 'ph-house' : state.path === 'Ce PC' ? 'ph-hard-drives' : state.path === driveRoot ? 'ph-hard-drive' : 'ph-folder';
        return `<div class="explorer-shell" data-explorer-root>
            ${tabStripMarkup()}
            <div class="explorer-commandbar"><div class="explorer-command-left">
                <button class="explorer-action-button" data-explorer-action="back" title="Précédent" aria-label="Précédent"><i class="ph ph-arrow-left"></i></button>
                <button class="explorer-action-button" data-explorer-action="forward" title="Suivant" aria-label="Suivant"><i class="ph ph-arrow-right"></i></button>
                <button class="explorer-action-button" data-explorer-action="up" title="Dossier parent" aria-label="Dossier parent"><i class="ph ph-arrow-up"></i></button>
                <button class="explorer-action-button" data-explorer-action="refresh" title="Actualiser" aria-label="Actualiser"><i class="ph ph-arrows-clockwise"></i></button>
                <span class="explorer-divider"></span><strong class="text-[12px] font-semibold truncate">${html(nameForSegment(state.path.split('/').at(-1), state.path))}</strong>
            </div><div class="explorer-command-right"><span class="explorer-virtual-badge" title="Les dossiers système sont une simulation du portfolio"><i class="ph-fill ph-shield-check"></i> Espace virtuel</span></div></div>
            <div class="explorer-addressbar"><div class="explorer-address-actions"><i class="ph-fill ${addressIcon} text-blue-300"></i><nav class="explorer-breadcrumbs" aria-label="Chemin actuel">${breadcrumbs()}</nav></div>
                <label class="explorer-search-wrap"><i class="ph ph-magnifying-glass"></i><input class="explorer-search" type="search" placeholder="Rechercher dans ${html(nameForSegment(state.path.split('/').at(-1), state.path))}" value="" aria-label="Rechercher dans ce dossier"></label></div>
            <div class="explorer-toolbar"><div class="explorer-toolbar-left"><button class="explorer-toolbar-link" data-explorer-action="open" title="Ouvrir la sélection"><i class="ph ph-arrow-square-out"></i><span>Ouvrir</span></button><span class="explorer-divider"></span>
                <button class="explorer-toolbar-link" data-explorer-action="sort"><i class="ph ph-sort-ascending"></i><span>Trier</span></button><select class="explorer-sort" aria-label="Trier les fichiers"><option value="name" ${state.sort === 'name' ? 'selected' : ''}>Nom</option><option value="type" ${state.sort === 'type' ? 'selected' : ''}>Type</option><option value="date" ${state.sort === 'date' ? 'selected' : ''}>Date</option><option value="size" ${state.sort === 'size' ? 'selected' : ''}>Taille</option></select>
            </div><div class="explorer-tool-actions"><span class="explorer-selection-label" data-selection-label></span><button class="explorer-view-button ${state.view === 'grid' ? 'is-active' : ''}" data-explorer-action="view-grid" title="Grandes icônes" aria-label="Vue icônes"><i class="ph ph-squares-four"></i></button><button class="explorer-view-button ${state.view === 'list' ? 'is-active' : ''}" data-explorer-action="view-list" title="Vue liste détaillée" aria-label="Vue liste"><i class="ph ph-list-bullets"></i></button></div></div>
            <div class="explorer-workspace"><aside class="explorer-sidebar" aria-label="Navigation de l’Explorateur">${sidebarMarkup()}
            </aside><main class="explorer-content" data-explorer-content>${contentMarkup()}</main></div>
            <footer class="explorer-statusbar"><span data-explorer-count>${state.visibleItems.length} élément${state.visibleItems.length === 1 ? '' : 's'}</span><span class="explorer-status-right"><span data-explorer-selected>Aucun élément sélectionné</span><span>${viewLabel}</span></span></footer>
        </div>`;
    }
    function rerenderContent() {
        const shell = document.querySelector('#window-explorer [data-explorer-root]');
        if (!shell) return;
        const content = shell.querySelector('[data-explorer-content]');
        if (content) content.innerHTML = contentMarkup();
        updateStatus(shell);
    }
    function renderAt(path, pushHistory = true) {
        state.path = safeLocalPath(path) || 'Accueil';
        state.query = '';
        state.selected.clear();
        state.anchor = null;
        if (pushHistory && state.history[state.historyIndex] !== state.path) {
            state.history = state.history.slice(0, state.historyIndex + 1);
            state.history.push(state.path);
            state.historyIndex = state.history.length - 1;
        }
        expandAncestors(state.path);
        syncActiveTab();
        const shell = document.querySelector('#window-explorer [data-explorer-root]');
        if (!shell) return;
        const replacement = document.createElement('div');
        replacement.innerHTML = markup(state.path);
        shell.replaceWith(replacement.firstElementChild);
    }
    function navigate(path) {
        renderAt(path, true);
    }
    function updateStatus(shell) {
        const items = state.visibleItems;
        const count = shell.querySelector('[data-explorer-count]');
        const selected = shell.querySelector('[data-explorer-selected]');
        const label = shell.querySelector('[data-selection-label]');
        if (count) count.textContent = `${items.length} élément${items.length === 1 ? '' : 's'}`;
        if (selected) selected.textContent = state.selected.size ? `${state.selected.size} sélectionné${state.selected.size > 1 ? 's' : ''}` : 'Aucun élément sélectionné';
        if (label) label.textContent = state.selected.size ? `${state.selected.size} sélectionné${state.selected.size > 1 ? 's' : ''}` : '';
    }
    function refreshSearch(value) {
        state.query = String(value || '').trim();
        rerenderContent();
    }
    function updateView(view) {
        state.view = view;
        const shell = document.querySelector('#window-explorer [data-explorer-root]');
        if (!shell) return;
        const content = shell.querySelector('[data-explorer-content]');
        if (content) content.innerHTML = contentMarkup();
        shell.querySelectorAll('[data-explorer-action="view-grid"], [data-explorer-action="view-list"]').forEach(button => button.classList.toggle('is-active', button.dataset.explorerAction === `view-${view}`));
        const viewText = shell.querySelector('.explorer-status-right > span:last-child');
        if (viewText) viewText.textContent = view === 'grid' ? 'Icônes' : 'Liste';
        updateStatus(shell);
    }
    function itemByPath(path) {
        return state.visibleItems.find(item => item.path === path) || locateBaseItem(path);
    }
    function openItem(item) {
        if (!item) return;
        if (item.kind === 'folder') { navigate(item.path); return; }
        if (item.action === 'image') { window.openApp('photos', item.asset); return; }
        if (item.action === 'document') { window.openApp('document', 'assets/files/CV-Narindra-Ranjalahy.pdf'); return; }
        if (item.action === 'project') { window.openApp('projects', item.projectId); return; }
        if (item.action === 'external' && item.href) { window.open(item.href, '_blank', 'noopener,noreferrer'); return; }
        if (item.action === 'classic') { window.open('index.html', '_blank', 'noopener,noreferrer'); return; }
        if (item.action && appsConfig[item.action]) { window.openApp(item.action); return; }
        if (item.path.endsWith('.pdf')) { window.openApp('document', 'assets/files/CV-Narindra-Ranjalahy.pdf'); return; }
        toggleNotificationToast(`Ouverture de ${item.name}`);
    }
    function selectItem(path, event) {
        const index = state.visibleItems.findIndex(item => item.path === path);
        if (event.shiftKey && state.anchor) {
            const start = state.visibleItems.findIndex(item => item.path === state.anchor);
            if (start >= 0 && index >= 0) {
                if (!event.ctrlKey && !event.metaKey) state.selected.clear();
                state.visibleItems.slice(Math.min(start, index), Math.max(start, index) + 1).forEach(item => state.selected.add(item.path));
            }
        } else if (event.ctrlKey || event.metaKey) {
            if (state.selected.has(path)) state.selected.delete(path); else state.selected.add(path);
            state.anchor = path;
        } else {
            state.selected.clear();
            state.selected.add(path);
            state.anchor = path;
        }
        document.querySelectorAll('#window-explorer [data-explorer-item]').forEach(node => {
            const active = state.selected.has(node.dataset.explorerItem);
            node.classList.toggle('is-selected', active);
            node.setAttribute('aria-pressed', String(active));
        });
        const shell = document.querySelector('#window-explorer [data-explorer-root]');
        if (shell) updateStatus(shell);
    }
    function showContextMenu(event, path) {
        const item = itemByPath(path);
        const menu = document.getElementById('portfolio-explorer-context-menu');
        if (!menu || !item) return;
        event.preventDefault();
        state.contextPath = path;
        if (!state.selected.has(path)) { state.selected.clear(); state.selected.add(path); }
        document.querySelectorAll('#window-explorer [data-explorer-item]').forEach(node => node.classList.toggle('is-selected', state.selected.has(node.dataset.explorerItem)));
        const left = Math.min(event.clientX, window.innerWidth - 215);
        const top = Math.min(event.clientY, window.innerHeight - 145);
        menu.style.left = `${Math.max(6, left)}px`;
        menu.style.top = `${Math.max(6, top)}px`;
        menu.hidden = false;
    }
    function closeContextMenu() {
        const menu = document.getElementById('portfolio-explorer-context-menu');
        if (menu) menu.hidden = true;
    }
    function moveFile(sourcePath, targetPath) {
        const source = locateBaseItem(sourcePath);
        const target = itemByPath(targetPath) || locateBaseItem(targetPath);
        if (!source || source.kind === 'folder' || !target || target.kind !== 'folder') return;
        const destination = canonicalFolderPath(target.path);
        if (sourcePath === destination || destination.startsWith(`${sourcePath}/`)) return;
        if (source.originalParent === destination) delete state.moves[sourcePath];
        else state.moves[sourcePath] = destination;
        saveMoves();
        state.selected.clear();
        rerenderContent();
        toggleNotificationToast(`${source.name} déplacé vers ${target.name}.`);
    }
    function changeHistory(delta) {
        const next = state.historyIndex + delta;
        if (next < 0 || next >= state.history.length) return;
        state.historyIndex = next;
        renderAt(state.history[next], false);
    }
    function selectedItem() {
        const path = state.selected.values().next().value;
        return path ? itemByPath(path) : null;
    }
    function handleAction(action, button) {
        if (action === 'navigate') navigate(button.dataset.path);
        else if (action === 'toggle-tree') {
            const path = button.dataset.path;
            if (state.expandedPaths.has(path)) state.expandedPaths.delete(path); else state.expandedPaths.add(path);
            rerenderSidebar();
        }
        else if (action === 'select-tab') activateTab(button.dataset.tabId);
        else if (action === 'new-tab') addTab();
        else if (action === 'close-tab') closeTab(button.dataset.tabId);
        else if (action === 'back') changeHistory(-1);
        else if (action === 'forward') changeHistory(1);
        else if (action === 'up') { if (state.path.includes('/')) navigate(state.path.split('/').slice(0, -1).join('/')); else navigate('Accueil'); }
        else if (action === 'refresh') { state.moves = readMoves(); renderAt(state.path, false); }
        else if (action === 'view-grid') updateView('grid');
        else if (action === 'view-list') updateView('list');
        else if (action === 'open') openItem(selectedItem());
        else if (action === 'context-open') { const item = itemByPath(state.contextPath); closeContextMenu(); openItem(item); }
        else if (action === 'context-location') { const item = itemByPath(state.contextPath); closeContextMenu(); if (item && item.originalParent) navigate(item.originalParent); }
        else if (action === 'context-info') { const item = itemByPath(state.contextPath); closeContextMenu(); if (item) toggleNotificationToast(`${item.name} · ${item.kind === 'folder' ? 'Dossier' : item.kind.toUpperCase()} · ${item.size || item.detail || 'Portfolio Narindra'}`); }
        else if (action === 'sort') { const select = document.querySelector('#window-explorer .explorer-sort'); if (select) select.focus(); }
    }

    const appDefs = {
        explorer: { id: 'explorer', title: 'Explorateur de fichiers', icon: 'ph-folder-open', color: 'from-blue-500 to-sky-600', defaultWidth: 990, defaultHeight: 650 },
        photos: { id: 'photos', title: 'Visionneuse de photos', icon: 'ph-image', color: 'from-violet-500 to-fuchsia-600', defaultWidth: 900, defaultHeight: 620 },
        document: { id: 'document', title: 'Lecteur de documents — CV Narindra.pdf', icon: 'ph-file-pdf', color: 'from-rose-500 to-pink-600', defaultWidth: 920, defaultHeight: 680 }
    };
    Object.assign(appsConfig, appDefs);

    const originalGetAppContent = window.getAppContent;
    window.getAppContent = function (appId, param) {
        if (appId === 'explorer') return markup(param || 'Accueil');
        if (appId === 'photos') return photoMarkup(param || 'assets/img/Portrait.png');
        if (appId === 'document') return documentMarkup(param || 'assets/files/CV-Narindra-Ranjalahy.pdf');
        return originalGetAppContent(appId, param);
    };
    function photoMarkup(source) {
        const image = safeLocalPath(source) || 'assets/img/Portrait.png';
        const filename = image.split('/').pop();
        return `<section class="portfolio-photo-viewer"><header class="portfolio-viewer-toolbar"><span class="portfolio-viewer-caption"><i class="ph-fill ph-image text-violet-300 mr-1"></i>${html(filename)}</span><div class="portfolio-viewer-actions"><a class="portfolio-viewer-button" href="${attr(image)}" target="_blank" rel="noopener"><i class="ph ph-arrow-square-out"></i> Ouvrir l’image</a></div></header><div class="portfolio-photo-canvas"><img src="${attr(image)}" alt="${html(filename)}"></div><footer class="portfolio-photo-meta">Visuel du portfolio Narindra · ${html(image)}</footer></section>`;
    }
    function documentMarkup(source) {
        const file = safeLocalPath(source) || 'assets/files/CV-Narindra-Ranjalahy.pdf';
        return `<section class="portfolio-document-viewer"><header class="portfolio-viewer-toolbar"><span class="portfolio-viewer-caption"><i class="ph-fill ph-file-pdf text-rose-300 mr-1"></i>Curriculum_Vitae_Narindra.pdf</span><div class="portfolio-viewer-actions"><a class="portfolio-viewer-button" href="${attr(file)}" download><i class="ph ph-download-simple"></i> Télécharger</a><a class="portfolio-viewer-button" href="${attr(file)}" target="_blank" rel="noopener"><i class="ph ph-arrow-square-out"></i> Ouvrir à part</a></div></header><iframe class="portfolio-document-frame" src="${attr(file)}#toolbar=1&view=FitH" title="CV de Narindra Ranjalahy" loading="lazy"></iframe></section>`;
    }

    const originalOpenApp = window.openApp;
    window.openApp = function (appId, param = null) {
        originalOpenApp(appId, param);
        if (appId === 'explorer') {
            if (param) navigate(param);
            ensureProjects().then(() => { if (document.querySelector('#window-explorer')) rerenderContent(); });
        } else if (appId === 'photos' && param) {
            const body = document.querySelector('#window-photos .window-body');
            if (body) body.innerHTML = photoMarkup(param);
        } else if (appId === 'document' && param) {
            const body = document.querySelector('#window-document .window-body');
            if (body) body.innerHTML = documentMarkup(param);
        }
    };
    window.openExplorerAt = path => window.openApp('explorer', path || 'Accueil');
    window.openPortfolioFile = path => {
        const item = locateBaseItem(path);
        if (item) openItem(item);
    };
    window.navigateExplorer = navigate;

    function applyDesktopOrder(grid) {
        let order = [];
        try { order = JSON.parse(localStorage.getItem(desktopOrderKey) || '[]'); } catch (_) { order = []; }
        if (!Array.isArray(order) || !order.length) return;
        const icons = Array.from(grid.querySelectorAll(':scope > .desktop-icon'));
        icons.sort((a, b) => {
            const ai = order.indexOf(a.dataset.desktopKey);
            const bi = order.indexOf(b.dataset.desktopKey);
            return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
        }).forEach(icon => grid.appendChild(icon));
    }
    function persistDesktopOrder(grid) {
        const order = Array.from(grid.querySelectorAll(':scope > .desktop-icon')).map(icon => icon.dataset.desktopKey).filter(Boolean);
        try { localStorage.setItem(desktopOrderKey, JSON.stringify(order)); } catch (_) { /* Le bureau reste utilisable sans stockage local. */ }
    }
    function appendDesktopShortcut(grid, config) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'desktop-icon w-24 h-24 rounded-lg flex flex-col items-center justify-center p-2 group cursor-pointer focus:outline-none';
        button.dataset.desktopKey = config.key;
        button.dataset.explorerPath = config.path;
        button.innerHTML = `<div class="w-12 h-12 rounded-xl bg-gradient-to-br ${config.color} flex items-center justify-center shadow-lg mb-1.5 group-hover:scale-105 transition-transform"><i class="ph-fill ${config.icon} text-2xl text-white"></i></div><span class="text-xs text-center font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] leading-tight">${html(config.label)}</span>`;
        button.addEventListener('click', event => window.selectDesktopIcon(event, button));
        button.addEventListener('dblclick', () => window.openExplorerAt(config.path));
        button.addEventListener('touchend', event => { event.preventDefault(); window.selectDesktopIcon(event, button); window.openExplorerAt(config.path); }, { passive: false });
        grid.appendChild(button);
    }
    function initDesktopShortcuts() {
        const grid = document.getElementById('desktop-icons-grid');
        if (!grid) return;
        grid.querySelectorAll(':scope > .desktop-icon').forEach((icon, index) => {
            if (!icon.dataset.desktopKey) icon.dataset.desktopKey = `default-${index}-${slug(icon.textContent.trim())}`;
        });
        const systemShortcuts = [
            { key: 'this-pc-shortcut', label: 'Ce PC', path: 'Ce PC', icon: 'ph-hard-drives', color: 'from-sky-500 to-blue-700' },
            { key: 'system-explorer', label: 'Explorateur de fichiers', path: 'Accueil', icon: 'ph-folder-open', color: 'from-blue-500 to-sky-600' },
            { key: 'documents-shortcut', label: 'Mes documents', path: 'Documents', icon: 'ph-file-text', color: 'from-sky-500 to-cyan-600' },
            { key: 'images-shortcut', label: 'Mes images', path: 'Images', icon: 'ph-images', color: 'from-violet-500 to-fuchsia-600' }
        ];
        systemShortcuts.forEach(config => { if (!grid.querySelector(`[data-desktop-key="${config.key}"]`)) appendDesktopShortcut(grid, config); });
        // Colonne « système » en tête du bureau, puis applications, puis outils :
        // l'ordre de lecture reste groupé par famille au lieu d'être dispersé.
        const firstAppIcon = grid.querySelector('[data-desktop-key="app-about"]') || grid.firstElementChild;
        if (firstAppIcon) systemShortcuts.forEach(config => {
            const icon = grid.querySelector(`[data-desktop-key="${config.key}"]`);
            if (icon) grid.insertBefore(icon, firstAppIcon);
        });
        applyDesktopOrder(grid);
        grid.querySelectorAll(':scope > .desktop-icon').forEach(icon => { icon.draggable = true; });
        grid.addEventListener('dragstart', event => {
            const icon = event.target.closest('.desktop-icon');
            if (!icon) return;
            state.desktopDragged = icon;
            icon.classList.add('is-dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', icon.dataset.desktopKey || 'shortcut');
        });
        grid.addEventListener('dragover', event => {
            const target = event.target.closest('.desktop-icon');
            if (!state.desktopDragged || !target || target === state.desktopDragged) return;
            event.preventDefault();
            target.classList.add('is-drag-target');
        });
        grid.addEventListener('dragleave', event => event.target.closest('.desktop-icon')?.classList.remove('is-drag-target'));
        grid.addEventListener('drop', event => {
            const target = event.target.closest('.desktop-icon');
            if (!state.desktopDragged || !target || target === state.desktopDragged) return;
            event.preventDefault();
            target.classList.remove('is-drag-target');
            grid.insertBefore(state.desktopDragged, target);
            persistDesktopOrder(grid);
            toggleNotificationToast('Raccourci réorganisé sur le bureau.');
        });
        grid.addEventListener('dragend', () => {
            grid.querySelectorAll('.desktop-icon').forEach(icon => icon.classList.remove('is-dragging', 'is-drag-target'));
            state.desktopDragged = null;
            persistDesktopOrder(grid);
        });
    }
    function initStartMenu() {
        const grid = document.getElementById('start-apps-grid');
        if (!grid || grid.querySelector('[data-app-shortcut="explorer"]')) return;
        [
            { id: 'explorer', title: 'Explorateur', icon: 'ph-folder-open', color: 'from-blue-500 to-sky-600' },
            { id: 'photos', title: 'Photos', icon: 'ph-image', color: 'from-violet-500 to-fuchsia-600' },
            { id: 'document', title: 'Lecteur PDF', icon: 'ph-file-pdf', color: 'from-rose-500 to-pink-600' }
        ].forEach(app => {
            const button = document.createElement('button');
            button.className = 'start-app-item flex flex-col items-center p-2.5 rounded-xl hover:bg-white/10 transition-colors';
            button.dataset.appShortcut = app.id;
            button.innerHTML = `<div class="w-10 h-10 rounded-xl bg-gradient-to-br ${app.color} flex items-center justify-center mb-1.5 shadow"><i class="ph-fill ${app.icon} text-xl"></i></div><span class="text-[11px] text-center">${app.title}</span>`;
            button.addEventListener('click', () => { window.openApp(app.id); window.toggleStartMenu(); });
            grid.appendChild(button);
        });
    }
    function initContextMenu() {
        if (document.getElementById('portfolio-explorer-context-menu')) return;
        const menu = document.createElement('div');
        menu.id = 'portfolio-explorer-context-menu';
        menu.className = 'explorer-context-menu';
        menu.hidden = true;
        menu.innerHTML = `<button class="explorer-menu-button" data-explorer-action="context-open"><i class="ph ph-arrow-square-out"></i>Ouvrir</button><button class="explorer-menu-button" data-explorer-action="context-location"><i class="ph ph-folder-notch-open"></i>Ouvrir l’emplacement</button><button class="explorer-menu-button" data-explorer-action="context-info"><i class="ph ph-info"></i>Informations</button>`;
        document.body.appendChild(menu);
        menu.addEventListener('click', event => { const button = event.target.closest('[data-explorer-action]'); if (button) handleAction(button.dataset.explorerAction, button); });
    }
    function initExplorerEvents() {
        document.addEventListener('click', event => {
            const action = event.target.closest('#window-explorer [data-explorer-action]');
            if (action) { handleAction(action.dataset.explorerAction, action); return; }
            const item = event.target.closest('#window-explorer [data-explorer-item]');
            if (item) selectItem(item.dataset.explorerItem, event);
            else if (event.target.closest('#window-explorer [data-explorer-root]')) { state.selected.clear(); rerenderContent(); }
            if (!event.target.closest('#portfolio-explorer-context-menu')) closeContextMenu();
        });
        document.addEventListener('dblclick', event => {
            const node = event.target.closest('#window-explorer [data-explorer-item]');
            if (node) openItem(itemByPath(node.dataset.explorerItem));
        });
        document.addEventListener('input', event => {
            if (event.target.matches('#window-explorer .explorer-search')) refreshSearch(event.target.value);
        });
        document.addEventListener('change', event => {
            if (!event.target.matches('#window-explorer .explorer-sort')) return;
            state.sort = event.target.value;
            rerenderContent();
        });
        document.addEventListener('contextmenu', event => {
            const node = event.target.closest('#window-explorer [data-explorer-item]');
            if (node) showContextMenu(event, node.dataset.explorerItem);
        });
        document.addEventListener('keydown', event => {
            if (!document.querySelector('#window-explorer .window-focused')) return;
            if (event.target.matches('input,textarea,select,[contenteditable="true"]')) return;
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
                event.preventDefault(); state.visibleItems.forEach(item => state.selected.add(item.path)); rerenderContent();
            } else if (event.key === 'Enter' && state.selected.size) { event.preventDefault(); openItem(selectedItem()); }
            else if (event.key === 'Escape') { state.selected.clear(); closeContextMenu(); rerenderContent(); }
            else if (event.key === 'Backspace') { event.preventDefault(); handleAction('up', {}); }
        });
        document.addEventListener('dragstart', event => {
            const node = event.target.closest('#window-explorer [data-explorer-item]');
            if (!node || node.dataset.itemKind === 'folder') return;
            state.dragPath = node.dataset.explorerItem;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', state.dragPath);
        });
        document.addEventListener('dragover', event => {
            const target = event.target.closest('#window-explorer [data-explorer-item][data-item-kind="folder"]');
            if (target) { event.preventDefault(); target.classList.add('is-drop-target'); event.dataTransfer.dropEffect = 'move'; }
        });
        document.addEventListener('dragleave', event => event.target.closest('#window-explorer [data-explorer-item]')?.classList.remove('is-drop-target'));
        document.addEventListener('drop', event => {
            const target = event.target.closest('#window-explorer [data-explorer-item][data-item-kind="folder"]');
            if (!target || !state.dragPath) return;
            event.preventDefault(); target.classList.remove('is-drop-target');
            moveFile(state.dragPath, target.dataset.explorerItem); state.dragPath = null;
        });
        document.addEventListener('dragend', event => {
            event.target.closest('#window-explorer [data-explorer-item]')?.classList.remove('is-drop-target');
            state.dragPath = null;
        });
    }

    function installWindowEnhancements() {
        window.makeDraggable = function (win, appId) {
            const header = win.querySelector('.window-header');
            if (!header) return;
            let drag = null;
            header.addEventListener('pointerdown', event => {
                if (event.button !== 0 || event.target.closest('button, a, input, select')) return;
                if (windowStates[appId]?.maximized) return;
                drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: win.offsetLeft, top: win.offsetTop };
                try { header.setPointerCapture(event.pointerId); } catch (_) { /* Le déplacement global reste utilisable sans capture. */ }
                window.focusWindow(appId);
                window.dispatchEvent(new CustomEvent('os-snap-dragstart', { detail: { appId, x: event.clientX, y: event.clientY } }));
                drag.left = win.offsetLeft;
                drag.top = win.offsetTop;
                event.preventDefault();
            });
            header.addEventListener('pointermove', event => {
                if (!drag || event.pointerId !== drag.pointerId) return;
                const container = document.getElementById('windows-container');
                const maxLeft = Math.max(0, container.clientWidth - 72);
                const maxTop = Math.max(0, container.clientHeight - 42);
                win.style.left = `${Math.max(-win.offsetWidth + 100, Math.min(drag.left + event.clientX - drag.x, maxLeft))}px`;
                win.style.top = `${Math.max(0, Math.min(drag.top + event.clientY - drag.y, maxTop))}px`;
                window.dispatchEvent(new CustomEvent('os-snap-drag', { detail: { appId, x: event.clientX, y: event.clientY } }));
            });
            const stop = event => {
                if (drag && event.pointerId === drag.pointerId) {
                    drag = null;
                    window.dispatchEvent(new CustomEvent('os-snap-dragend', { detail: { appId, x: event.clientX, y: event.clientY } }));
                }
            };
            header.addEventListener('pointerup', stop);
            header.addEventListener('pointercancel', stop);
        };
        window.makeResizable = function (win, appId) {
            const handle = win.querySelector('.resize-handle');
            if (!handle) return;
            let resize = null;
            handle.addEventListener('pointerdown', event => {
                if (event.button !== 0 || windowStates[appId]?.maximized) return;
                resize = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: win.offsetWidth, height: win.offsetHeight };
                try { handle.setPointerCapture(event.pointerId); } catch (_) { /* Les navigateurs sans capture gardent le redimensionnement actif. */ }
                window.focusWindow(appId);
                event.preventDefault();
                event.stopPropagation();
            });
            handle.addEventListener('pointermove', event => {
                if (!resize || event.pointerId !== resize.pointerId) return;
                const container = document.getElementById('windows-container');
                const maxWidth = Math.max(260, container.clientWidth - win.offsetLeft);
                const maxHeight = Math.max(220, container.clientHeight - win.offsetTop);
                const minWidth = Math.min(window.innerWidth < 520 ? 250 : 360, maxWidth);
                const minHeight = Math.min(240, maxHeight);
                win.style.width = `${Math.max(minWidth, Math.min(resize.width + event.clientX - resize.x, maxWidth))}px`;
                win.style.height = `${Math.max(minHeight, Math.min(resize.height + event.clientY - resize.y, maxHeight))}px`;
                window.dispatchEvent(new CustomEvent('os-snap-resize', { detail: { appId } }));
            });
            const stop = event => { if (resize && event.pointerId === resize.pointerId) resize = null; };
            handle.addEventListener('pointerup', stop);
            handle.addEventListener('pointercancel', stop);
        };

        const topmostWindow = () => Object.keys(windowStates)
            .filter(id => !windowStates[id].minimized && document.getElementById(`window-${id}`))
            .sort((a, b) => Number(document.getElementById(`window-${a}`).style.zIndex || 0) - Number(document.getElementById(`window-${b}`).style.zIndex || 0))
            .at(-1);
        window.minimizeWindow = function (appId) {
            const wasFocused = activeWindow === appId;
            const win = document.getElementById(`window-${appId}`);
            if (!win || !windowStates[appId]) return;
            win.classList.add('hidden');
            windowStates[appId].minimized = true;
            if (wasFocused) {
                activeWindow = null;
                const next = topmostWindow();
                if (next) window.focusWindow(next);
                else renderTaskbar();
            } else renderTaskbar();
        };
        window.closeWindow = function (appId) {
            const win = document.getElementById(`window-${appId}`);
            if (!win) return;
            const wasFocused = activeWindow === appId;
            win.style.opacity = '0';
            win.style.transform = 'scale(.96) translateY(6px)';
            win.style.transition = 'all .14s ease';
            window.setTimeout(() => {
                win.remove();
                delete windowStates[appId];
                if (wasFocused || activeWindow === appId) {
                    activeWindow = null;
                    const next = topmostWindow();
                    if (next) window.focusWindow(next);
                    else renderTaskbar();
                } else renderTaskbar();
            }, 145);
        };
        window.minimizeAllWindows = function () {
            Object.keys(windowStates).forEach(id => {
                const win = document.getElementById(`window-${id}`);
                if (win) win.classList.add('hidden');
                if (windowStates[id]) windowStates[id].minimized = true;
            });
            activeWindow = null;
            document.querySelectorAll('.mica-window').forEach(win => win.classList.remove('window-focused'));
            renderTaskbar();
        };
    }

    function installDesktopSelection() {
        window.selectDesktopIcon = function (event, icon) {
            if (event) event.stopPropagation();
            const additive = !!(event && (event.ctrlKey || event.metaKey));
            if (!additive) {
                document.querySelectorAll('.desktop-icon').forEach(item => item.classList.remove('selected'));
                if (icon) icon.classList.add('selected');
                return;
            }
            if (icon) icon.classList.toggle('selected');
        };
        window.initDesktopSelection = function () {
            const desktop = document.getElementById('desktop');
            const grid = document.getElementById('desktop-icons-grid');
            const box = document.getElementById('selection-box');
            if (!desktop || !grid || !box) return;
            let origin = null;
            let additive = false;
            desktop.addEventListener('pointerdown', event => {
                if (event.button !== 0 || event.target.closest('.desktop-icon, .mica-window, button, a, input')) return;
                if (event.target !== desktop && event.target !== grid) return;
                origin = { x: event.clientX, y: event.clientY };
                additive = event.ctrlKey || event.metaKey;
                if (!additive) grid.querySelectorAll('.desktop-icon').forEach(icon => icon.classList.remove('selected'));
                box.style.display = 'block';
                box.style.left = `${origin.x - desktop.getBoundingClientRect().left}px`;
                box.style.top = `${origin.y - desktop.getBoundingClientRect().top}px`;
                box.style.width = '0px';
                box.style.height = '0px';
            });
            window.addEventListener('pointermove', event => {
                if (!origin) return;
                const left = Math.min(origin.x, event.clientX);
                const top = Math.min(origin.y, event.clientY);
                const width = Math.abs(event.clientX - origin.x);
                const height = Math.abs(event.clientY - origin.y);
                const desktopRect = desktop.getBoundingClientRect();
                box.style.left = `${left - desktopRect.left}px`;
                box.style.top = `${top - desktopRect.top}px`;
                box.style.width = `${width}px`;
                box.style.height = `${height}px`;
                grid.querySelectorAll('.desktop-icon').forEach(icon => {
                    const rect = icon.getBoundingClientRect();
                    const intersects = rect.left < left + width && rect.right > left && rect.top < top + height && rect.bottom > top;
                    if (intersects) icon.classList.add('selected');
                    else if (!additive) icon.classList.remove('selected');
                });
            });
            window.addEventListener('pointerup', () => {
                if (!origin) return;
                origin = null;
                box.style.display = 'none';
            });
        };
    }

    function init() {
        installWindowEnhancements();
        installDesktopSelection();
        initDesktopShortcuts();
        initStartMenu();
        initContextMenu();
        initExplorerEvents();
        if (typeof ensureProjects === 'function') ensureProjects().then(() => {
            if (document.querySelector('#window-explorer')) rerenderContent();
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
