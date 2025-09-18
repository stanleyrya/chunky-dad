// Page Effects Module - Handles animations, scroll effects, visual enhancements
class PageEffectsManager {
    constructor() {
        this.isMainPage = this.checkIfMainPage();
        this.isCityPage = this.checkIfCityPage();
        this.header = document.querySelector('header');
        this.heroImage = document.querySelector('.hero-image');
        this.init();
    }

    checkIfMainPage() {
        return window.location.pathname.endsWith('index.html') || 
               window.location.pathname === '/' || 
               window.location.pathname === '';
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
        this.setupIntersectionObserver();
        this.setupInteractiveElements();
        this.setupPageLoadEffects();
        logger.componentLoad('PAGE', 'Page effects manager initialized');
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

}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PageEffectsManager;
} else {
    window.PageEffectsManager = PageEffectsManager;
}