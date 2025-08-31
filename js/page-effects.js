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
        this.injectDynamicStyles();
        this.setupParallaxEffects();
        this.setupIntersectionObserver();
        this.setupInteractiveElements();
        this.setupCityBubbles();
        this.setupPageLoadEffects();
        logger.componentLoad('PAGE', 'Page effects manager initialized');
    }



    setupParallaxEffects() {
        if (this.heroImage) {
            logger.componentInit('PAGE', 'Hero parallax effect setup');
            
            window.addEventListener('scroll', () => {
                const scrolled = window.pageYOffset;
                this.heroImage.style.transform = `translateY(${scrolled * 0.5}px)`;
            });
            
            logger.componentLoad('PAGE', 'Hero parallax effect enabled');
        } else {
            logger.debug('PAGE', 'Hero image not found - parallax effect skipped');
        }
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
        this.setupCTAButtonEffects();
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

    setupCTAButtonEffects() {
        const ctaButtons = document.querySelectorAll('.cta-button');
        ctaButtons.forEach(button => {
            button.addEventListener('click', function() {
                logger.userInteraction('PAGE', `CTA button clicked: ${this.textContent}`);
                this.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    this.style.transform = 'scale(1)';
                }, 150);
            });
        });

        if (ctaButtons.length > 0) {
            logger.componentLoad('PAGE', 'CTA button interactions enabled', {
                buttonCount: ctaButtons.length
            });
        }
    }

    setupCityBubbles() {
        // Initialize the new city carousel manager
        if (typeof CityCarouselManager !== 'undefined') {
            this.cityCarousel = new CityCarouselManager();
            logger.componentLoad('PAGE', 'Modern city carousel initialized');
        } else {
            logger.warn('PAGE', 'CityCarouselManager not available - falling back to basic interactions');
            this.setupBasicCityBubbles();
        }
    }

    setupBasicCityBubbles() {
        const cityBubbles = document.querySelectorAll('.city-bubble:not(.coming-soon)');
        cityBubbles.forEach(bubble => {
            bubble.addEventListener('mouseenter', () => {
                logger.userInteraction('PAGE', 'City bubble hovered', {
                    city: bubble.getAttribute('title')
                });
            });
        });

        logger.componentLoad('PAGE', 'Basic city bubble interactions enabled', {
            bubbleCount: cityBubbles.length
        });
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
        
        // Immediately show the cities section which is critical
        const citiesSection = document.querySelector('#cities');
        if (citiesSection) {
            citiesSection.classList.add('fade-in');
            logger.debug('PAGE', 'Cities section made visible immediately');
        }
        
        // Add typing effect for hero title
        const heroTitle = document.querySelector('.hero-content h2');
        if (heroTitle) {
            const originalText = heroTitle.textContent;
            logger.debug('PAGE', 'Starting hero title animation');
            setTimeout(() => {
                this.typeWriter(heroTitle, originalText, 60);
            }, 300);
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
        setTimeout(() => {
            fadeInOnScroll();
        }, 100);

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

    injectDynamicStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Main page smooth fade-in effects */
            section {
                transition: opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1), transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            /* Main page sections start hidden and fade in smoothly */
            body:not(.city-page) section:not(.hero) {
                opacity: 0;
                transform: translateY(40px);
                transition: opacity 0.8s ease-out, transform 0.8s ease-out;
            }
            
            body:not(.city-page) section.fade-in,
            body:not(.city-page) section:nth-child(-n+3) {
                opacity: 1;
                transform: translateY(0);
            }
            
            /* Ensure critical sections are always visible after a delay */
            body:not(.city-page) section {
                animation: ensureVisible 1s ease-out 2s both;
            }
            
            @keyframes ensureVisible {
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            /* City pages: all sections visible immediately with smooth transitions */
            body.city-page section {
                opacity: 1;
                transform: translateY(0);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            .hero {
                opacity: 1;
                transform: translateY(0);
            }
            
            .animate {
                animation: fadeInUp 0.6s ease-out;
            }
            
            body.loaded {
                overflow-x: hidden;
            }
            
            /* Enhanced smooth transitions for all interactive elements */
            .city-card, .event-card, .category-card, .contact-item {
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                will-change: transform;
            }
            
            .city-card:hover, .event-card:hover, .category-card:hover {
                transform: translateY(-8px) scale(1.02);
                box-shadow: 0 15px 35px rgba(0,0,0,0.15);
            }
            
            .contact-item:hover {
                transform: translateY(-4px);
                box-shadow: 0 8px 25px rgba(0,0,0,0.12);
            }
            
            /* Smooth button interactions */
            .cta-button {
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                will-change: transform;
            }
            
            .cta-button:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 25px rgba(102, 126, 234, 0.3);
            }
            
            /* Smooth calendar day interactions */
            .calendar-day {
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                will-change: transform;
            }
            
            .calendar-day:hover {
                transform: translateY(-4px);
                box-shadow: 0 8px 25px rgba(0,0,0,0.12);
            }
            
            /* Smooth event card interactions */
            .event-card.detailed {
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                will-change: transform;
            }
            
            .event-card.detailed:hover {
                transform: translateY(-5px);
                box-shadow: 0 15px 40px rgba(0,0,0,0.15);
            }
        `;
        document.head.appendChild(style);

        logger.componentLoad('PAGE', 'Dynamic styles injected successfully');
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PageEffectsManager;
} else {
    window.PageEffectsManager = PageEffectsManager;
}