// Navigation Module - Handles mobile menu, smooth scrolling, and navigation interactions
class NavigationManager {
    constructor() {
        this.hamburger = document.querySelector('.hamburger');
        this.navMenu = document.querySelector('.nav-menu');
        this.header = document.querySelector('header');
        this.isIndexPage = document.body.classList.contains('index-page');
        this.init();
    }

    init() {
        logger.componentInit('NAV', 'Navigation manager initializing');
        this.setupMobileMenu();
        this.setupSmoothScrolling();
        this.setupNavLinks();
        this.setupDynamicHeader();
        this.setupScrollHint();
        logger.componentLoad('NAV', 'Navigation manager initialized');
    }

    setupMobileMenu() {
        if (this.hamburger && this.navMenu) {
            logger.componentInit('NAV', 'Mobile navigation setup');
            
            this.hamburger.addEventListener('click', () => {
                logger.userInteraction('NAV', 'Mobile menu toggle clicked');
                this.toggleMobileMenu();
            });
        } else {
            logger.warn('NAV', 'Mobile navigation elements not found');
        }
    }

    toggleMobileMenu() {
        this.hamburger.classList.toggle('active');
        this.navMenu.classList.toggle('active');
        
        const isActive = this.hamburger.classList.contains('active');
        logger.debug('NAV', `Mobile menu ${isActive ? 'opened' : 'closed'}`);
    }

    closeMobileMenu() {
        if (this.hamburger && this.navMenu) {
            this.hamburger.classList.remove('active');
            this.navMenu.classList.remove('active');
            logger.debug('NAV', 'Mobile menu closed');
        }
    }

    setupNavLinks() {
        const navLinks = document.querySelectorAll('.nav-menu a');
        navLinks.forEach((link, index) => {
            link.addEventListener('click', () => {
                logger.userInteraction('NAV', `Navigation link clicked: ${link.textContent}`);
                this.closeMobileMenu();
            });
        });

        logger.componentLoad('NAV', 'Navigation links setup complete', {
            linkCount: navLinks.length
        });
    }

    setupSmoothScrolling() {
        // Add smooth scrolling to all anchor links
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = anchor.getAttribute('href').substring(1);
                this.scrollToSection(targetId);
            });
        });

        logger.componentLoad('NAV', 'Smooth scrolling setup complete');
    }

    scrollToSection(sectionId) {
        logger.userInteraction('NAV', `Scrolling to section: ${sectionId}`);
        const element = document.getElementById(sectionId);
        
        if (element) {
            element.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
            logger.debug('NAV', `Successfully scrolled to ${sectionId}`);
        } else {
            logger.warn('NAV', `Section not found: ${sectionId}`);
        }
    }

    // The "Explore" hint under the hero takes you to the cities.
    //
    // Two things used to carry it past the section. iOS grows 100dvh when its
    // toolbar collapses mid-scroll, which moves the target down after the jump
    // has been aimed; and correcting for that while the smooth scroll is still
    // running ADDS to it rather than replacing it. So: aim below the fixed
    // header, wait for the scroll to actually stop, then correct once.
    setupScrollHint() {
        const hint = document.querySelector('.hero-scroll-hint');
        const target = document.getElementById('cities');
        if (!hint || !target) {
            logger.debug('NAV', 'No scroll hint on this page');
            return;
        }

        const scrolled = () => window.pageYOffset || document.documentElement.scrollTop || 0;
        const headerHeight = () => {
            if (!this.header) return 0;
            return getComputedStyle(this.header).position === 'fixed' ? this.header.offsetHeight : 0;
        };
        const landingY = () => Math.max(0, target.getBoundingClientRect().top + scrolled() - headerHeight() - 12);

        const go = () => {
            logger.userInteraction('NAV', 'Explore hint tapped');
            const y = landingY();
            if ('scrollBehavior' in document.documentElement.style) {
                window.scrollTo({ top: y, behavior: 'smooth' });
            } else {
                window.scrollTo(0, y);
            }
            const started = Date.now();
            let last = -1;
            let still = 0;
            const settle = setInterval(() => {
                const y2 = Math.round(scrolled());
                if (y2 === last) { still++; } else { still = 0; last = y2; }
                if (still >= 3 || Date.now() - started > 2500) {
                    clearInterval(settle);
                    const off = target.getBoundingClientRect().top - headerHeight() - 12;
                    if (Math.abs(off) > 2) window.scrollTo(0, y2 + off);
                }
            }, 80);
        };

        hint.style.cursor = 'pointer';
        hint.setAttribute('role', 'button');
        hint.setAttribute('tabindex', '0');
        // it is position:fixed and merely fades out, so without this it keeps
        // catching taps at the bottom of the screen long after you have scrolled
        const guard = () => { hint.dataset.hidden = scrolled() > 50 ? '1' : '0'; };
        window.addEventListener('scroll', guard, { passive: true });
        guard();

        hint.addEventListener('click', () => { if (scrolled() <= 50) go(); });
        hint.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (scrolled() <= 50) go(); }
        });

        logger.componentLoad('NAV', 'Explore hint wired to the cities section');
    }

    setupDynamicHeader() {
        if (!this.isIndexPage || !this.header) {
            logger.debug('NAV', 'Dynamic header not needed for this page');
            return;
        }

        logger.componentInit('NAV', 'Setting up dynamic header for index page');
        
        
        let lastScrollY = window.scrollY;
        let ticking = false;

        const updateHeader = () => {
            const scrollY = window.scrollY;
            const heroHeight = window.innerHeight * 0.6; // Show header after scrolling 60% of viewport
            const scrollHint = document.querySelector('.hero-scroll-hint');
            
            if (scrollY > heroHeight) {
                if (!this.header.classList.contains('visible')) {
                    this.header.classList.add('visible');
                    logger.debug('NAV', 'Header shown on scroll');
                }
            } else {
                if (this.header.classList.contains('visible')) {
                    this.header.classList.remove('visible');
                    logger.debug('NAV', 'Header hidden on scroll up');
                }
            }
            
            // Hide scroll hint when user starts scrolling
            if (scrollHint && scrollY > 50) {
                scrollHint.style.opacity = '0';
            } else if (scrollHint && scrollY <= 50) {
                scrollHint.style.opacity = '0.7';
            }
            
            lastScrollY = scrollY;
            ticking = false;
        };

        const requestTick = () => {
            if (!ticking) {
                requestAnimationFrame(updateHeader);
                ticking = true;
            }
        };

        window.addEventListener('scroll', requestTick, { passive: true });
        logger.componentLoad('NAV', 'Dynamic header scroll listener attached');
    }

}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NavigationManager;
} else {
    window.NavigationManager = NavigationManager;
}