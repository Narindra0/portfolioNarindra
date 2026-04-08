document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const heroLogo = document.getElementById('hero-logo');
    const navbar = document.getElementById('navbar');
    const navSpacer = document.getElementById('nav-spacer');
    const burger = document.getElementById('burger');
    const closeMenu = document.getElementById('close-menu');
    const mobileMenu = document.getElementById('mobile-menu');
    const mobileLinks = document.querySelectorAll('.mobile-nav-link');
    const scrollThreshold = 80;

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

    // --- ESCAPE KEY FOR MODALS ---
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeYasModal();
    });
});

// --- MODAL UTILITIES (GLOBAL SCOPE FOR ONCLICK) ---
window.openYasModal = function () {
    const modal = document.getElementById('yasModal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
};

window.closeYasModal = function (event) {
    const modal = document.getElementById('yasModal');
    if (!event || event.target.id === 'yasModal' || event.target.closest('.modal-close')) {
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    }
};
