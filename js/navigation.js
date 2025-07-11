// Navigation Module - Handles mobile menu, smooth scrolling, and navigation interactions
class NavigationManager {
    constructor() {
        this.hamburger = document.querySelector('.hamburger');
        this.navMenu = document.querySelector('.nav-menu');
        this.init();
    }

    init() {
        logger.componentInit('NAV', 'Navigation manager initializing');
        this.setupMobileMenu();
        this.setupSmoothScrolling();
        this.setupNavLinks();
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
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NavigationManager;
} else {
    window.NavigationManager = NavigationManager;
}