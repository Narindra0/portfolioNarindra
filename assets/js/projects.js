/* ==========================================================================
   Rendu des projets depuis data/projects.json
   Source de vérité : base Notion -> GitHub Action -> branche « donnees »
   Ce fichier ne contient AUCUN contenu projet en dur.
   ========================================================================== */
(function () {
  'use strict';

  /* Où le contenu est lu, dans cet ordre.

     DATA_URL — la branche « donnees » du dépôt, lue via GitHub brut. Le flux B y
     pousse data/projects.json sans toucher à main, donc une fiche Notion modifiée
     ne déclenche plus de déploiement Netlify (Free = 300 crédits/mois, un déploiement
     production = 15 crédits : la marge est de 20 déploiements par mois).
     Réponse vérifiée : « Access-Control-Allow-Origin: * » (la lecture marchera depuis
     narindraportfolio.netlify.app) et « Cache-Control: max-age=300 » — un projet
     enregistré sur Notion est visible en ligne une à cinq minutes plus tard.

     DATA_REPLI — la copie embarquée dans le bundle au dernier déploiement de code.
     Elle n'est plus mise à jour, mais elle évite une page vide si GitHub est
     injoignable (réseau, blocage, panne). Plus vieille que le contenu en ligne,
     jamais plus fausse qu'une liste vide. */
  var DATA_URL = 'https://raw.githubusercontent.com/Narindra0/portfolioNarindra/donnees/data/projects.json';
  var DATA_REPLI = 'data/projects.json';
  var LIST_SELECTOR = '#project-list';
  var MODAL_ID = 'project-modal';

  /* Thème par défaut pour les projets ajoutés depuis Notion.
     Une fiche peut toujours forcer son style avec les champs
     couleur / couleur_secondaire / icone / sous_titre / badge. */
  var CATEGORIES = {
    'AgriTech':            { c: '#4CAF50', c2: '#66BB6A', i: 'fa-seedling' },
    'Fintech':             { c: '#2196F3', c2: '#64B5F6', i: 'fa-chart-pie' },
    'Fintech & Sim':       { c: '#2196F3', c2: '#64B5F6', i: 'fa-chart-pie' },
    'Mobilité':            { c: '#FF9800', c2: '#FFB74D', i: 'fa-bus' },
    'IA & Data':           { c: '#E91E63', c2: '#F06292', i: 'fa-brain' },
    'Streaming & Culture':  { c: '#FF5722', c2: '#FF8A50', i: 'fa-headphones' },
    'Mobile & Culture':    { c: '#9C27B0', c2: '#BA68C8', i: 'fa-book-open' },
    'E-Gov Web':           { c: '#2196F3', c2: '#64B5F6', i: 'fa-id-card' },
    'HR Tech':             { c: '#00BCD4', c2: '#4DD0E1', i: 'fa-users-gear' },
    'Logiciel Interne':    { c: '#607D8B', c2: '#90A4AE', i: 'fa-building-columns' }
  };
  var FALLBACK = { c: '#FF5722', c2: '#FF8A50', i: 'fa-cube' };

  var LINK_ICONS = {
    Visiter: 'fa-arrow-up-right-from-square',
    GitHub: 'fa-github',
    'Version locale': 'fa-computer',
    Aucun: ''
  };

  var ESCAPED = /[&<>"']/g;
  var ESCAPED_MAP = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  };

  function e(value) {
    return String(value === undefined || value === null ? '' : value).replace(ESCAPED, function (m) {
      return ESCAPED_MAP[m];
    });
  }

  function hexToRgbTriplet(hex) {
    var clean = String(hex || '').replace('#', '');
    if (clean.length === 3) {
      clean = clean.split('').map(function (x) { return x + x; }).join('');
    }
    if (clean.length !== 6 || /[^0-9a-fA-F]/.test(clean)) {
      return '255 87 34';
    }
    var n = parseInt(clean, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(' ');
  }

  function theme(project) {
    var cat = CATEGORIES[String(project.categorie || '').trim()] || FALLBACK;
    return {
      couleur: project.couleur || cat.c,
      secondaire: project.couleur_secondaire || cat.c2,
      icone: project.icone || cat.i
    };
  }

  /* Le texte court affiché à droite de la ligne.
     Sans champ label_court (fiches Notion), on retombe sur la catégorie. */
  function shortLabel(project) {
    return project.label_court || project.categorie || project.role || '';
  }

  function featuresOf(project) {
    if (!Array.isArray(project.fonctionnalites)) return [];
    return project.fonctionnalites.filter(function (f) { return f && f.nom; });
  }

  function techsOf(project) {
    return Array.isArray(project.technologies) ? project.technologies.filter(Boolean) : [];
  }

  function linkOf(project) {
    var l = project.lien;
    if (!l || typeof l !== 'object') return { type: 'Aucun', url: '', libelle: '', note: '' };
    return {
      type: l.type || (l.url ? 'Visiter' : 'Aucun'),
      url: l.url || '',
      libelle: l.libelle || '',
      note: l.note || ''
    };
  }

  function ctaLabel(project, link) {
    if (link.libelle) return link.libelle;
    if (link.type === 'GitHub') return 'Voir sur GitHub';
    if (link.type === 'Version locale') return 'Récupérer en local';
    return 'Visiter ' + project.nom;
  }

  /* ------------------------------------------------------------------
     Liste
     ------------------------------------------------------------------ */
  function rowMarkup(project, index) {
    var t = theme(project);
    var isHighlighted = shortLabel(project) === project.role && project.role;
    var number = String(index + 1).padStart(2, '0');
    var link = linkOf(project);
    return [
      '<div class="project-row group py-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6 cursor-pointer"',
      ' data-slug="', e(project.slug), '" role="button" tabindex="0">',
      '<div class="flex items-baseline gap-6 lg:w-5/12">',
      '<span class="project-number text-white/40 font-mono text-sm">', number, '</span>',
      '<h3 class="project-title text-4xl lg:text-5xl font-bold m-0 text-white tracking-tight">', e(project.nom), '</h3>',
      '</div>',
      '<div class="lg:w-4/12">',
      '<p class="text-white/60 text-base font-light leading-relaxed transition-colors group-hover:text-white/90">',
      e(project.accroche), '</p>',
      '</div>',
      '<div class="lg:w-3/12 flex items-center justify-between lg:justify-end gap-6 text-sm uppercase tracking-widest font-mono text-white/40">',
      '<span', isHighlighted ? ' class="text-primary font-semibold"' : '', '>', e(shortLabel(project)), '</span>',
      linkArrowMarkup(),
      '</div>',
      '</div>'
    ].join('');
  }

  function linkArrowMarkup() {
    return [
      '<svg class="arrow-icon w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">',
      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 8l4 4m0 0l-4 4m4-4H3"></path>',
      '</svg>'
    ].join('');
  }

  /* ------------------------------------------------------------------
     Fenêtre de détail
     ------------------------------------------------------------------ */
  function featureMarkup(f, index) {
    return [
      '<div class="passio-feature-item">',
      '<i class="fa-solid ', e(f.icone || 'fa-check'), ' text-primary" data-accent-icon></i>',
      '<div>',
      '<span class="text-white text-sm font-semibold">', e(f.nom), '</span>',
      '<span class="text-text text-xs">', e(f.description || ''), '</span>',
      '</div>',
      '</div>'
    ].join('');
  }

  function stepMarkup(text, index) {
    return [
      '<div class="modal-step">',
      '<span class="modal-step-number">', index + 1, '</span>',
      '<span>', e(text), '</span>',
      '</div>'
    ].join('');
  }

  function detailMarkup(project) {
    var t = theme(project);
    var link = linkOf(project);
    var features = featuresOf(project);
    var techs = techsOf(project);
    var steps = Array.isArray(project.etapes) ? project.etapes.filter(Boolean) : [];
    var badge = project.badge || project.role || '';

    var parts = [];

    parts.push(
      '<div class="passio-header">',
      '<div class="passio-logo-icon" data-accent-bg>',
      '<i class="fa-solid ', e(t.icone), '"></i>',
      '</div>',
      '<div>',
      '<h3 class="modal-title text-2xl">', e(project.nom), '</h3>',
      '<span class="text-xs font-mono tracking-widest uppercase" data-accent-text>',
      e(project.sous_titre || project.categorie || ''), '</span>',
      '</div>',
      '</div>'
    );

    if (badge) {
      parts.push(
        '<div class="passio-founder-badge">',
        '<i class="fa-solid ', e(project.badge_icone || 'fa-star'), '"></i>',
        '<span>', e(badge), '</span>',
        '</div>'
      );
    }

    var description = project.description || project.accroche || '';
    if (description) {
      parts.push('<p class="modal-text">', e(description), '</p>');
    }

    if (project.mission) {
      parts.push(
        '<div class="passio-mission" data-accent-mission>',
        '<h4 class="passio-section-title">',
        '<i class="fa-solid fa-bullseye" data-accent-icon></i> ',
        e(project.titre_section_mission || 'Notre Mission'), '</h4>',
        '<p class="text-text text-sm leading-relaxed">', e(project.mission), '</p>',
        '</div>'
      );
    }

    if (features.length) {
      parts.push(
        '<div class="passio-features">',
        '<h4 class="passio-section-title">',
        '<i class="fa-solid fa-wand-magic-sparkles" data-accent-icon></i> ',
        e(project.titre_section_fonctionnalites || 'Fonctionnalités'), '</h4>',
        '<div class="passio-feature-grid">',
        features.map(featureMarkup).join(''),
        '</div>',
        '</div>'
      );
    }

    if (steps.length) {
      parts.push(
        '<div class="passio-features">',
        '<h4 class="passio-section-title">',
        '<i class="fa-solid fa-list-ol" data-accent-icon></i> ',
        e(project.titre_section_mise_en_oeuvre || 'Mise en œuvre'), '</h4>',
        '<div class="modal-steps">',
        steps.map(stepMarkup).join(''),
        '</div>',
        '</div>'
      );
    }

    if (techs.length) {
      parts.push(
        '<div class="passio-skills">',
        '<h4 class="passio-section-title">',
        '<i class="fa-solid fa-code" data-accent-icon></i> ',
        e(project.titre_section_competences || 'Compétences'), '</h4>',
        '<div class="flex flex-wrap gap-2" data-accent-tags>',
        techs.map(function (tech) {
          return ['<span class="passio-skill-tag">', e(tech), '</span>'].join('');
        }).join(''),
        '</div>',
        '</div>'
      );
    }

    if (link.type === 'Aucun' || !link.url) {
      if (link.note) {
        parts.push('<div class="passio-cta"><p class="text-text text-sm font-light leading-relaxed">', e(link.note), '</p></div>');
      }
    } else {
      parts.push(
        '<div class="passio-cta">',
        '<a href="', e(link.url), '" target="_blank" rel="noopener noreferrer" class="passio-visit-btn" data-accent-gradient>',
        '<i class="fa-solid ', e(LINK_ICONS[link.type] || 'fa-arrow-up-right-from-square'), '"></i> ',
        e(ctaLabel(project, link)),
        '</a>',
        '</div>'
      );
    }

    return { html: parts.join(''), theme: t };
  }

  function applyAccent(modal, t) {
    modal.style.setProperty('--accent', t.couleur);
    modal.style.setProperty('--accent-rgb', hexToRgbTriplet(t.couleur));
    modal.style.setProperty('--accent-2', t.secondaire);

    var rgb = hexToRgbTriplet(t.couleur).split(' ');
    var rgba = function (alpha) { return 'rgba(' + rgb.join(',') + ',' + alpha + ')'; };

    each(modal, '[data-accent-bg]', function (el) {
      el.style.background = 'linear-gradient(135deg, ' + t.couleur + ' 0%, ' + t.secondaire + ' 100%)';
    });
    each(modal, '[data-accent-text]', function (el) { el.style.color = t.secondaire; });
    each(modal, '[data-accent-icon]', function (el) { el.style.color = t.couleur; });
    each(modal, '[data-accent-section]', function (el) { el.style.color = t.couleur; });
    each(modal, '[data-accent-tags] .passio-skill-tag', function (el) {
      el.style.borderColor = rgba(0.08);
      el.style.color = t.secondaire;
      el.style.background = rgba(0.08);
    });
    each(modal, '[data-accent-gradient]', function (el) {
      el.style.background = 'linear-gradient(135deg, ' + t.couleur + ' 0%, ' + t.secondaire + ' 100%)';
      el.style.boxShadow = '0 8px 25px ' + rgba(0.3);
    });
    each(modal, '[data-accent-mission]', function (el) {
      el.style.borderLeftColor = t.couleur;
    });
    each(modal, '.passio-founder-badge', function (el) {
      el.style.borderColor = rgba(0.3);
      el.style.color = t.couleur;
      el.style.background = rgba(0.1);
    });
    each(modal, '.modal-step-number', function (el) { el.style.background = t.couleur; });
    each(modal, '.passio-mission .passio-section-title', function (el) { el.style.color = t.couleur; });
  }

  function each(root, selector, fn) {
    var nodes = root.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) fn(nodes[i], i);
  }

  /* ------------------------------------------------------------------
     Modal unique
     ------------------------------------------------------------------ */
  var currentModal = null;

  function open(slug) {
    var project = find(slug);
    if (!project || !currentModal) return;
    var content = document.getElementById('project-modal-content');
    var built = detailMarkup(project);
    content.innerHTML = built.html;
    applyAccent(content, built.theme);
    currentModal.classList.add('active');
    currentModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    if (!currentModal) return;
    currentModal.classList.remove('active');
    currentModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  var projects = [];

  function find(slug) {
    for (var i = 0; i < projects.length; i++) {
      if (projects[i].slug === slug) return projects[i];
    }
    return null;
  }

  /* ------------------------------------------------------------------
     Chargement + branchement
     ------------------------------------------------------------------ */
  function notice(listEl, message) {
    listEl.innerHTML = '<p class="text-white/40 text-sm font-mono py-10">' + e(message) + '</p>';
  }

  /* Une lecture, une vérification de forme. Rejette sur HTTP KO, JSON invalide
     ou contenu qui n'est pas un tableau — le repli peut alors prendre le relais. */
  function lis(url) {
    return fetch(url, { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!Array.isArray(data)) throw new Error('format inattendu');
        return data;
      });
  }

  function wire() {
    var listEl = document.querySelector(LIST_SELECTOR);
    currentModal = document.getElementById(MODAL_ID);
    if (!listEl) return;

    lis(DATA_URL)
      .catch(function () { return lis(DATA_REPLI); })
      .then(function (data) {
        projects = data.map(function (p, i) {
          p.slug = 'p' + (i + 1);
          return p;
        });
        listEl.innerHTML = projects.map(rowMarkup).join('');
        listEl.classList.add('loaded');
      })
      .catch(function (error) {
        listEl.classList.add('loaded');
        notice(listEl, 'Projets indisponibles (' + error.message + ')');
      });

    listEl.addEventListener('click', function (event) {
      var row = event.target.closest('.project-row');
      if (row && row.dataset.slug) open(row.dataset.slug);
    });

    listEl.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var row = event.target.closest('.project-row');
      if (!row || !row.dataset.slug) return;
      event.preventDefault();
      open(row.dataset.slug);
    });

    if (currentModal) {
      currentModal.addEventListener('click', function (event) {
        if (event.target === currentModal || event.target.closest('.modal-close')) close();
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
