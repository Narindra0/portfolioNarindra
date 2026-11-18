/* ==========================================================================
   Rendu de la timeline « Mon Parcours » — design « ligne de vie ».
   Source de vérité : base Notion « Parcours » -> GitHub Action -> branche « donnees »
   Ce fichier ne contient AUCUNE expérience en dur. Même contrat que projects.js :
   lecture en direct sur « donnees » (0 crédit Netlify par modification), copie
   embarquée en repli si GitHub est injoignable, message si les deux échouent.

   Motion : la spine centrale se remplit d'orange au scroll, chaque node s'allume
   à l'entrée de sa carte (IntersectionObserver), le rôle « en cours » pulse.
   prefers-reduced-motion : tout est visible immédiatement, aucune animation.
   ========================================================================== */
(function () {
  'use strict';

  var DATA_URL = 'https://raw.githubusercontent.com/Narindra0/portfolioNarindra/donnees/data/parcours.json';
  var DATA_REPLI = 'data/parcours.json';
  var TIMELINE_SELECTOR = '#parcours-timeline';
  var LIST_SELECTOR = '#parcours-list';
  var SUMMARY_SELECTOR = '#parcours-summary';

  var ESCAPED = /[&<>"']/g;
  var ESCAPED_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function e(value) {
    return String(value === undefined || value === null ? '' : value).replace(ESCAPED, function (m) {
      return ESCAPED_MAP[m];
    });
  }

  function isCurrent(exp) { return Boolean(exp.mise_en_avant || exp.en_cours); }
  function pad(n) { return String(n).padStart(2, '0'); }

  /* ------------------------------------------------------------------
     Bandeau de synthèse (calculé depuis les données)
     ------------------------------------------------------------------ */
  function summaryMarkup(exps) {
    var years = exps.map(function (x) { return String(x.debut || '').slice(0, 4); }).filter(Boolean);
    var minYear = years.length ? years.reduce(function (a, b) { return a < b ? a : b; }) : '';
    var hasCurrent = exps.some(isCurrent);
    var endLabel = hasCurrent ? 'Présent'
      : (exps.map(function (x) { return String(x.fin || x.debut || '').slice(0, 4); }).filter(Boolean)
          .reduce(function (a, b) { return a > b ? a : b; }, '') || '');
    var parts = [];
    if (minYear) parts.push('<span><b>' + e(minYear) + '</b> → <b>' + e(endLabel || minYear) + '</b></span>');
    parts.push('<span class="xp-summary-sep" aria-hidden="true"></span>');
    parts.push('<span><b>' + pad(exps.length) + '</b> Expérience' + (exps.length > 1 ? 's' : '') + '</span>');
    if (hasCurrent) {
      parts.push('<span class="xp-summary-sep" aria-hidden="true"></span>');
      parts.push('<span class="xp-legend"><span class="xp-legend-dot" aria-hidden="true"></span> En cours</span>');
    }
    return parts.join('');
  }

  /* ------------------------------------------------------------------
     Spine + carte
     ------------------------------------------------------------------ */
  function spineMarkup() {
    return '<div class="xp-spine" aria-hidden="true">' +
      '<div class="xp-spine-track"></div>' +
      '<div class="xp-spine-fill"></div>' +
      '<div class="xp-spine-head"></div>' +
      '</div>';
  }

  function badgesMarkup(exp, current) {
    var out = [];
    if (exp.badge) {
      out.push('<span class="xp-badge"><span class="xp-badge-dot" aria-hidden="true"></span>' + e(exp.badge) + '</span>');
    }
    if (current) {
      out.push('<span class="xp-live"><span class="xp-live-dot" aria-hidden="true"></span>En cours</span>');
    }
    return out.length ? '<div class="xp-badges">' + out.join('') + '</div>' : '';
  }

  function tagsMarkup(exp) {
    var tags = Array.isArray(exp.hashtags) ? exp.hashtags.filter(Boolean) : [];
    if (!tags.length) return '';
    return '<div class="xp-tags">' + tags.map(function (t) {
      return '<span class="xp-tag">#' + e(t) + '</span>';
    }).join('') + '</div>';
  }

  function cardMarkup(exp, index) {
    var current = isCurrent(exp);
    var inverted = index % 2 === 1;
    return [
      '<article class="xp-card', inverted ? ' xp-inverted' : '', '" data-current="', current ? 'true' : 'false', '">',
      '<div class="xp-node" aria-hidden="true"><span class="xp-node-ping"></span><span class="xp-node-ring"></span><span class="xp-node-core"></span></div>',
      '<div class="xp-connector" aria-hidden="true"></div>',
      '<div class="xp-meta">',
      '<span class="xp-ghost" aria-hidden="true">', pad(index + 1), '</span>',
      '<span class="xp-period">', e(exp.periode), '</span>',
      '<h3 class="xp-name">', e(exp.nom), '</h3>',
      badgesMarkup(exp, current),
      '</div>',
      '<div class="xp-content"><div class="xp-panel">',
      '<h4 class="xp-poste">', e(exp.poste), '</h4>',
      '<p class="xp-desc">', e(exp.description), '</p>',
      tagsMarkup(exp),
      '</div></div>',
      '</article>'
    ].join('');
  }

  /* ------------------------------------------------------------------
     Motion : reveal par carte + remplissage de la spine au scroll
     ------------------------------------------------------------------ */
  function setupMotion(timeline, cards) {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) {
      cards.forEach(function (c) { c.classList.add('is-lit'); });
      timeline.style.setProperty('--spine', '1');
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-lit'); io.unobserve(en.target); }
      });
    }, { threshold: 0.2, rootMargin: '0px 0px -8% 0px' });
    cards.forEach(function (c) { io.observe(c); });

    var ticking = false;
    function update() {
      ticking = false;
      var rect = timeline.getBoundingClientRect();
      if (!rect.height) return;
      var trigger = window.innerHeight * 0.62;
      var p = (trigger - rect.top) / rect.height;
      p = Math.max(0, Math.min(1, p));
      timeline.style.setProperty('--spine', p.toFixed(4));
      timeline.classList.toggle('is-active', p > 0.01 && p < 0.995);
    }
    function onScroll() { if (!ticking) { ticking = true; window.requestAnimationFrame(update); } }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  /* ------------------------------------------------------------------
     Chargement (même contrat que projects.js)
     ------------------------------------------------------------------ */
  function notice(listEl, message) {
    listEl.innerHTML = '<p class="text-white/40 text-sm font-mono py-10">' + e(message) + '</p>';
  }

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
    var timeline = document.querySelector(TIMELINE_SELECTOR);
    var listEl = document.querySelector(LIST_SELECTOR);
    if (!timeline || !listEl) return;
    var summaryEl = document.querySelector(SUMMARY_SELECTOR);

    lis(DATA_URL)
      .catch(function () { return lis(DATA_REPLI); })
      .then(function (data) {
        var exps = data.filter(function (x) { return x && x.nom; });
        if (!exps.length) throw new Error('aucune expérience');
        timeline.insertAdjacentHTML('afterbegin', spineMarkup());
        listEl.innerHTML = exps.map(cardMarkup).join('');
        listEl.classList.add('loaded');
        if (summaryEl) summaryEl.innerHTML = summaryMarkup(exps);
        setupMotion(timeline, Array.prototype.slice.call(listEl.querySelectorAll('.xp-card')));
      })
      .catch(function (error) {
        listEl.classList.add('loaded');
        notice(listEl, 'Parcours indisponible (' + error.message + ')');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();