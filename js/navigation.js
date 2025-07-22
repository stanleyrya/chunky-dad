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
        this.setupTabs();
        this.setupCityCards();
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

    setupTabs() {
        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');
        
        if (tabButtons.length === 0) {
            logger.debug('NAV', 'No tab buttons found, skipping tab setup');
            return;
        }

        logger.componentInit('NAV', 'Setting up tab navigation', {
            tabCount: tabButtons.length
        });

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.getAttribute('data-tab');
                logger.userInteraction('NAV', `Tab clicked: ${targetTab}`);
                
                // Remove active class from all buttons and contents
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));
                
                // Add active class to clicked button and corresponding content
                button.classList.add('active');
                const targetContent = document.getElementById(`${targetTab}-tab`);
                if (targetContent) {
                    targetContent.classList.add('active');
                    logger.debug('NAV', `Switched to tab: ${targetTab}`);
                } else {
                    logger.warn('NAV', `Tab content not found: ${targetTab}-tab`);
                }
            });
        });

        logger.componentLoad('NAV', 'Tab navigation setup complete');
    }

    setupCityCards() {
        const cityCards = document.querySelectorAll('.city-card-modern');
        
        if (cityCards.length === 0) {
            logger.debug('NAV', 'No city cards found, skipping city card setup');
            return;
        }

        logger.componentInit('NAV', 'Setting up city card interactions', {
            cardCount: cityCards.length
        });

        cityCards.forEach(card => {
            const expandBtn = card.querySelector('.city-expand-btn');
            const details = card.querySelector('.city-card-details');
            
            if (expandBtn && details) {
                // Initially hide details
                details.style.display = 'none';
                
                card.addEventListener('click', (e) => {
                    // Don't trigger if clicking the action button
                    if (e.target.classList.contains('city-action-btn')) {
                        return;
                    }
                    
                    const cityName = card.getAttribute('data-city') || 'unknown';
                    logger.userInteraction('NAV', `City card clicked: ${cityName}`);
                    
                    const isExpanded = details.style.display !== 'none';
                    
                    // Close all other cards first
                    cityCards.forEach(otherCard => {
                        const otherDetails = otherCard.querySelector('.city-card-details');
                        const otherExpandBtn = otherCard.querySelector('.city-expand-btn');
                        if (otherDetails && otherExpandBtn) {
                            otherDetails.style.display = 'none';
                            otherExpandBtn.textContent = '+';
                            otherExpandBtn.style.transform = 'rotate(0deg)';
                        }
                    });
                    
                    // Toggle current card
                    if (!isExpanded) {
                        details.style.display = 'block';
                        expandBtn.textContent = '−';
                        expandBtn.style.transform = 'rotate(45deg)';
                        logger.debug('NAV', `City card expanded: ${cityName}`);
                    }
                });
            }
        });

        logger.componentLoad('NAV', 'City card interactions setup complete');
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NavigationManager;
} else {
    window.NavigationManager = NavigationManager;
}