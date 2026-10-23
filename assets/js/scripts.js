document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const heroLogo = document.getElementById('hero-logo');
    const navbar = document.getElementById('navbar');
    const navSpacer = document.getElementById('nav-spacer');
    const burger = document.getElementById('burger');
    const closeMenu = document.getElementById('close-menu');
    const mobileMenu = document.getElementById('mobile-menu');
    const mobileLinks = document.querySelectorAll('.mobile-nav-link');
    const backToTop = document.getElementById('backToTop');
    const scrollThreshold = 80;

    // --- CURSOR GLOW ---
    const cursorGlow = document.createElement('div');
    cursorGlow.classList.add('cursor-glow');
    document.body.appendChild(cursorGlow);
    document.addEventListener('mousemove', (e) => {
        cursorGlow.style.left = e.clientX + 'px';
        cursorGlow.style.top = e.clientY + 'px';
    });

    // --- SCROLL REVEAL ---
    const revealElements = document.querySelectorAll('.reveal-up, .reveal-left, .reveal-right, .reveal-scale');
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                revealObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    revealElements.forEach(el => revealObserver.observe(el));

    // --- ANIMATED COUNTER ---
    const counters = document.querySelectorAll('[data-count]');
    let countersAnimated = false;

    function animateCounters() {
        if (countersAnimated) return;
        countersAnimated = true;

        counters.forEach(counter => {
            const target = parseInt(counter.getAttribute('data-count'));
            const duration = 2000;
            const start = performance.now();

            function updateCounter(currentTime) {
                const elapsed = currentTime - start;
                const progress = Math.min(elapsed / duration, 1);
                // Ease out cubic
                const eased = 1 - Math.pow(1 - progress, 3);
                const current = Math.floor(eased * target);

                if (target >= 1000) {
                    counter.textContent = current.toLocaleString('fr-FR') + '+';
                } else {
                    counter.textContent = current + '+';
                }

                if (progress < 1) {
                    requestAnimationFrame(updateCounter);
                }
            }
            requestAnimationFrame(updateCounter);
        });
    }

    // Observe stats section
    const statsSection = document.querySelector('[data-count]');
    if (statsSection) {
        const statsObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    animateCounters();
                    statsObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.3 });
        statsObserver.observe(statsSection.closest('section'));
    }

    // --- SCROLL LOGIC & NAVIGATION ---
    window.addEventListener('scroll', () => {
        const scrollY = window.scrollY;

        // Logo & Navbar Shrink Effect
        if (scrollY > scrollThreshold) {
            if (heroLogo) heroLogo.classList.add('shrunk');
            if (navbar) navbar.classList.add('navbar-scrolled');
            if (window.innerWidth >= 768 && navSpacer) {
                navSpacer.style.width = '6rem';
            }
        } else {
            if (heroLogo) heroLogo.classList.remove('shrunk');
            if (navbar) navbar.classList.remove('navbar-scrolled');
            if (navSpacer) navSpacer.style.width = '0';
        }

        // Back to Top Button
        if (backToTop) {
            if (scrollY > 500) {
                backToTop.classList.add('visible');
            } else {
                backToTop.classList.remove('visible');
            }
        }

        // Active Section Highlighting
        let current = '';
        const sections = document.querySelectorAll('section');
        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            if (pageYOffset >= sectionTop - 150) {
                current = section.getAttribute('id');
            }
        });

        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href').substring(1) === current) {
                link.classList.add('active');
            }
        });
    });

    // --- BACK TO TOP ---
    if (backToTop) {
        backToTop.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // --- MOBILE MENU HANDLERS ---
    if (burger) {
        burger.addEventListener('click', () => {
            if (mobileMenu) mobileMenu.classList.add('active');
            document.body.style.overflow = 'hidden';
        });
    }

    if (closeMenu) {
        closeMenu.addEventListener('click', () => {
            if (mobileMenu) mobileMenu.classList.remove('active');
            document.body.style.overflow = '';
        });
    }

    mobileLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (mobileMenu) mobileMenu.classList.remove('active');
            document.body.style.overflow = '';
        });
    });

    // --- SMOOTH SCROLL INTEGRATION ---
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;

            e.preventDefault();
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                targetElement.scrollIntoView({
                    behavior: 'smooth'
                });
            }
        });
    });

    // --- ESCAPE KEY FOR MOBILE MENU ---
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mobileMenu) {
            mobileMenu.classList.remove('active');
            document.body.style.overflow = '';
        }
    });
});

// --- MODAL UTILITIES (GLOBAL SCOPE FOR ONCLICK) ---

// Generic open/close helpers
function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}
function closeModal(id, event) {
    const modal = document.getElementById(id);
    if (!event || event.target.id === id || event.target.closest('.modal-close')) {
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    }
}

// YAS Modal
window.openYasModal = function () { openModal('yasModal'); };
window.closeYasModal = function (event) { closeModal('yasModal', event); };

// Pass'io Modal
window.openPassioModal = function () { openModal('passioModal'); };
window.closePassioModal = function (event) { closeModal('passioModal', event); };
