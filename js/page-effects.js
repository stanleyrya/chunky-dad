// Page Effects Module - Handles animations, scroll effects, visual enhancements, and header behavior
class PageEffectsManager {
    constructor() {
        this.isMainPage = this.checkIfMainPage();
        this.isCityPage = this.checkIfCityPage();
        this.header = document.querySelector('header');
        this.heroImage = document.querySelector('.hero-image');
        
        
        this.init();
    }

    checkIfMainPage() {
        // Only the root index page should be considered the main page
        // City pages like /city-name/index.html should NOT be main pages
        const pathname = window.location.pathname;
        return pathname === '/' || 
               pathname === '' || 
               pathname === '/index.html';
    }

    checkIfCityPage() {
        // Check for both legacy city.html format and new city subdirectory format
        if (window.location.pathname.includes('city.html')) {
            return true;
        }
        
        // Check if we're in a city subdirectory using app.js logic
        if (window.chunkyApp && window.chunkyApp.getCitySlugFromPath) {
            const citySlug = window.chunkyApp.getCitySlugFromPath();
            return !!citySlug;
        }
        
        // Fallback detection for city subdirectories
        const pathname = window.location.pathname;
        const pathSegments = pathname.split('/').filter(Boolean);
        
        if (pathSegments.length > 0) {
            const firstSegment = pathSegments[0].toLowerCase();
            // Check if first segment matches a known city
            if (window.CITY_CONFIG && window.CITY_CONFIG[firstSegment]) {
                return true;
            }
        }
        
        return false;
    }

    init() {
        logger.componentInit('PAGE', 'Page effects manager initializing');
        
        // Setup dynamic header for index pages
        this.setupDynamicHeader();
        
        // Page effects setup
        this.setupIntersectionObserver();
        this.setupInteractiveElements();
        this.setupPageLoadEffects();
        
        logger.componentLoad('PAGE', 'Page effects manager initialized');
    }


    setupDynamicHeader() {
        const isIndexPage = document.body.classList.contains('index-page');
        if (!isIndexPage || !this.header) {
            logger.debug('PAGE', 'Dynamic header not needed for this page');
            return;
        }

        logger.componentInit('PAGE', 'Setting up dynamic header for index page');
        
        let lastScrollY = window.scrollY;
        let ticking = false;

        const updateHeader = () => {
            const scrollY = window.scrollY;
            const heroHeight = window.innerHeight * 0.6; // Show header after scrolling 60% of viewport
            const scrollHint = document.querySelector('.hero-scroll-hint');
            
            if (scrollY > heroHeight) {
                if (!this.header.classList.contains('visible')) {
                    this.header.classList.add('visible');
                    this.showHeader(true, 'index page scroll reveal');
                    logger.debug('PAGE', 'Header shown on scroll');
                }
            } else {
                if (this.header.classList.contains('visible')) {
                    this.header.classList.remove('visible');
                    this.hideHeader(true, 'index page scroll hide');
                    logger.debug('PAGE', 'Header hidden on scroll up');
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
        logger.componentLoad('PAGE', 'Dynamic header scroll listener attached');
    }




    setupIntersectionObserver() {
        const observerOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const elementClass = entry.target.classList[0] || 'unknown';
                    logger.debug('PAGE', `Element animated: ${elementClass}`);
                    entry.target.classList.add('animate');
                }
            });
        }, observerOptions);

        const animationElements = document.querySelectorAll('.about-card, .gallery-item, .contact-item');
        animationElements.forEach(el => observer.observe(el));

        logger.componentLoad('PAGE', 'Intersection observer setup complete', {
            elementsObserved: animationElements.length
        });
    }

    setupInteractiveElements() {
        this.setupGalleryHoverEffects();
    }

    setupGalleryHoverEffects() {
        const galleryItems = document.querySelectorAll('.gallery-item');
        galleryItems.forEach(item => {
            item.addEventListener('mouseenter', function() {
                this.style.transform = 'translateY(-10px) scale(1.02)';
            });
            
            item.addEventListener('mouseleave', function() {
                this.style.transform = 'translateY(0) scale(1)';
            });
        });

        if (galleryItems.length > 0) {
            logger.componentLoad('PAGE', 'Gallery hover effects enabled', {
                itemCount: galleryItems.length
            });
        }
    }



    setupPageLoadEffects() {
        window.addEventListener('load', () => {
            logger.performance('PAGE', 'Page load complete - adding loaded class');
            document.body.classList.add('loaded');
            this.makeStickyHeader();
        });

        document.addEventListener('DOMContentLoaded', () => {
            logger.info('PAGE', 'DOM content loaded', {
                isMainPage: this.isMainPage,
                isCityPage: this.isCityPage,
                pathname: window.location.pathname
            });
            
            this.initializePageSpecificEffects();
        });
    }

    initializePageSpecificEffects() {
        if (this.isMainPage) {
            this.initializeMainPageEffects();
        } else if (this.isCityPage) {
            this.initializeCityPageEffects();
        }
    }

    initializeMainPageEffects() {
        logger.componentInit('PAGE', 'Main page initialization');
        
        // Cities section is now visible by default in CSS
        const citiesSection = document.querySelector('#cities');
        if (citiesSection) {
            citiesSection.classList.add('fade-in');
            logger.debug('PAGE', 'Cities section ready');
        }
        
        // Add typing effect for hero title
        const heroTitle = document.querySelector('.hero-content h2');
        if (heroTitle) {
            const originalText = heroTitle.textContent;
            logger.debug('PAGE', 'Starting hero title animation');
            setTimeout(() => {
                this.typeWriter(heroTitle, originalText, 60);
            }, 50);
        }

        // Setup scroll animations
        this.setupScrollAnimations();
        
        logger.componentLoad('PAGE', 'Main page initialization complete');
    }

    initializeCityPageEffects() {
        logger.componentInit('PAGE', 'City page initialization');
        
        // City pages: Make everything visible immediately but smoothly
        document.body.classList.add('city-page');
        const sections = document.querySelectorAll('section');
        sections.forEach(section => {
            section.classList.add('fade-in');
        });
        
        logger.componentLoad('PAGE', 'City page initialization complete', {
            sectionsAnimated: sections.length
        });
    }

    setupScrollAnimations() {
        if (!this.isMainPage) return;

        const fadeInOnScroll = () => {
            const sections = document.querySelectorAll('section');
            let animatedCount = 0;
            
            sections.forEach(section => {
                const sectionTop = section.offsetTop;
                const windowHeight = window.innerHeight;
                const scrollPosition = window.scrollY;
                
                // More generous threshold to ensure sections become visible
                if (scrollPosition + windowHeight > sectionTop + 50) {
                    if (!section.classList.contains('fade-in')) {
                        section.classList.add('fade-in');
                        animatedCount++;
                        logger.debug('PAGE', `Section animated: ${section.className || section.id || 'unknown'}`);
                    }
                }
            });
            
            if (animatedCount > 0) {
                logger.debug('PAGE', `Animated ${animatedCount} sections on scroll`);
            }
        };

        // Initial call to show visible sections immediately
        fadeInOnScroll();

        window.addEventListener('scroll', fadeInOnScroll);
        logger.componentLoad('PAGE', 'Main page scroll animations enabled');
    }

    typeWriter(element, text, speed = 100) {
        logger.debug('PAGE', `Starting typewriter effect for: ${text.substring(0, 20)}...`);
        let i = 0;
        element.innerHTML = '';
        
        const type = () => {
            if (i < text.length) {
                element.innerHTML += text.charAt(i);
                i++;
                setTimeout(type, speed);
            } else {
                logger.debug('PAGE', 'Typewriter effect completed');
            }
        };
        
        type();
    }

    // Reusable header animation methods
    showHeader(animated = true, reason = 'unknown') {
        if (!this.header) return;
        
        if (animated) {
            logger.debug('PAGE', `Showing header with animation: ${reason}`);
            this.header.style.transform = 'translateY(0)';
            this.header.style.opacity = '1';
        } else {
            logger.debug('PAGE', `Showing header instantly: ${reason}`);
            this.header.style.transform = 'translateY(0)';
            this.header.style.opacity = '1';
        }
    }

    hideHeader(animated = true, reason = 'unknown') {
        if (!this.header) return;
        
        if (animated) {
            logger.debug('PAGE', `Hiding header with animation: ${reason}`);
            this.header.style.transform = 'translateY(-100%)';
            this.header.style.opacity = '0';
        } else {
            logger.debug('PAGE', `Hiding header instantly: ${reason}`);
            this.header.style.transform = 'translateY(-100%)';
            this.header.style.opacity = '0';
        }
    }

    setHeaderVisible(visible, animated = true, reason = 'unknown') {
        if (visible) {
            this.showHeader(animated, reason);
        } else {
            this.hideHeader(animated, reason);
        }
    }

    makeStickyHeader() {
        // Make header sticky after page loads to prevent initial visibility issues
        // Skip this for index pages as they have their own dynamic header behavior
        if (this.header && !this.isMainPage) {
            const scrollY = window.scrollY;
            const shouldAnimate = scrollY > 100; // Only animate if user has scrolled away from top (more than header height)
            
            logger.debug('PAGE', 'Making header sticky after page load', { 
                scrollY, 
                shouldAnimate 
            });
            
            if (shouldAnimate) {
                // Start header hidden for slide-down animation
                this.hideHeader(false, 'preparing for sticky animation');
            }
            
            // Apply sticky positioning
            this.header.classList.add('sticky');
            document.body.classList.add('header-sticky');
            
            if (shouldAnimate) {
                // Trigger slide-down animation after a brief delay
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        this.showHeader(true, 'sticky header slide-down');
                    });
                });
            }
            
            logger.componentLoad('PAGE', 'Header made sticky after page load', { animated: shouldAnimate });
        } else if (this.isMainPage) {
            logger.debug('PAGE', 'Skipping sticky header for index page (has dynamic behavior)');
        }
    }

}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PageEffectsManager;
} else {
    window.PageEffectsManager = PageEffectsManager;
}