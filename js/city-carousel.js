// City Carousel Module - Handles city bubbles carousel with auto-sliding and touch support
class CityCarouselManager {
    constructor() {
        this.carousel = document.querySelector('.city-carousel');
        this.track = document.querySelector('.city-carousel-track');
        this.dots = document.querySelectorAll('.dot');
        this.bubbles = document.querySelectorAll('.city-bubble');
        
        if (!this.carousel || !this.track) {
            logger.debug('CITY', 'City carousel elements not found - skipping initialization');
            return;
        }

        if (this.bubbles.length === 0) {
            logger.warn('CITY', 'No city bubbles found - carousel will be empty');
            return;
        }

        this.currentSlide = 0;
        this.totalSlides = this.calculateTotalSlides();
        this.isAutoSliding = true;
        this.autoSlideInterval = null;
        this.autoSlideDelay = 4000; // 4 seconds
        this.touchStartX = 0;
        this.touchEndX = 0;
        this.isDragging = false;
        this.startTransform = 0;
        this.currentTransform = 0;
        this.isInitialized = false;
        
        this.init();
    }

    init() {
        logger.componentInit('CITY', 'City carousel initializing');
        
        try {
            this.generateDots();
            this.setupEventListeners();
            this.updateCarousel();
            
            // Start auto-slide after a brief delay to allow for smooth initialization
            setTimeout(() => {
                if (!this.isDragging) {
                    this.startAutoSlide();
                }
            }, 1000);
            
            this.isInitialized = true;
            logger.componentLoad('CITY', 'City carousel initialized successfully', {
                totalSlides: this.totalSlides,
                bubblesCount: this.bubbles.length
            });
        } catch (error) {
            logger.componentError('CITY', 'Failed to initialize city carousel', error);
        }
    }

    generateDots() {
        const dotsContainer = this.carousel.querySelector('.carousel-dots');
        if (!dotsContainer) return;
        
        // Clear existing dots
        dotsContainer.innerHTML = '';
        
        // Generate the correct number of dots based on calculated slides
        for (let i = 0; i < this.totalSlides; i++) {
            const dot = document.createElement('span');
            dot.classList.add('dot');
            if (i === 0) dot.classList.add('active');
            dot.setAttribute('data-slide', i);
            dotsContainer.appendChild(dot);
        }
        
        // Update dots reference
        this.dots = dotsContainer.querySelectorAll('.dot');
        
        logger.debug('CITY', `Generated ${this.totalSlides} carousel dots`);
    }

    calculateTotalSlides() {
        const containerWidth = this.carousel.offsetWidth;
        const bubbleWidth = window.innerWidth <= 768 ? 70 : 80; // Mobile vs desktop bubble width
        const gap = 16; // 1rem gap
        const totalBubbles = this.bubbles.length;
        
        // Calculate how many bubbles fit in one view
        const bubblesPerSlide = Math.floor(containerWidth / (bubbleWidth + gap));
        
        // On mobile, show fewer bubbles per slide for better visibility and touch interaction
        if (window.innerWidth <= 768) {
            const mobileBubblesPerSlide = Math.max(2, Math.floor(bubblesPerSlide * 0.6));
            return Math.max(1, Math.ceil(totalBubbles / mobileBubblesPerSlide));
        }
        
        // Desktop: show more bubbles per slide
        const desktopBubblesPerSlide = Math.max(3, bubblesPerSlide);
        return Math.max(1, Math.ceil(totalBubbles / desktopBubblesPerSlide));
    }

    setupEventListeners() {
        // Dot navigation
        this.dots.forEach((dot, index) => {
            dot.addEventListener('click', () => {
                this.goToSlide(index);
                this.pauseAutoSlide();
                logger.userInteraction('CITY', `Carousel dot clicked: slide ${index}`);
            });
        });

        // Touch/mouse events for swiping
        this.track.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
        this.track.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        this.track.addEventListener('touchend', this.handleTouchEnd.bind(this));

        // Mouse events for desktop dragging
        this.track.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.track.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.track.addEventListener('mouseup', this.handleMouseUp.bind(this));
        this.track.addEventListener('mouseleave', this.handleMouseUp.bind(this));

        // Pause auto-slide on hover (desktop)
        this.carousel.addEventListener('mouseenter', () => {
            this.pauseAutoSlide();
        });

        this.carousel.addEventListener('mouseleave', () => {
            this.resumeAutoSlide();
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            const oldTotalSlides = this.totalSlides;
            this.totalSlides = this.calculateTotalSlides();
            
            // Regenerate dots if the number of slides changed
            if (oldTotalSlides !== this.totalSlides) {
                this.generateDots();
            }
            
            this.currentSlide = Math.min(this.currentSlide, this.totalSlides - 1);
            this.updateCarousel();
        });

        // Prevent context menu on long press
        this.track.addEventListener('contextmenu', (e) => {
            if (this.isDragging) {
                e.preventDefault();
            }
        });
    }

    handleTouchStart(e) {
        this.touchStartX = e.touches[0].clientX;
        this.startTransform = this.currentTransform;
        this.isDragging = true;
        this.track.classList.add('swiping');
        this.pauseAutoSlide();
    }

    handleTouchMove(e) {
        if (!this.isDragging) return;
        
        e.preventDefault();
        this.touchEndX = e.touches[0].clientX;
        const diff = this.touchEndX - this.touchStartX;
        this.currentTransform = this.startTransform + diff;
        this.track.style.transform = `translateX(${this.currentTransform}px)`;
    }

    handleTouchEnd(e) {
        if (!this.isDragging) return;
        
        this.isDragging = false;
        this.track.classList.remove('swiping');
        
        const diff = this.touchEndX - this.touchStartX;
        const threshold = 50; // Minimum swipe distance
        
        if (Math.abs(diff) > threshold) {
            if (diff > 0 && this.currentSlide > 0) {
                this.goToSlide(this.currentSlide - 1);
                logger.userInteraction('CITY', 'Carousel swiped right (previous slide)');
            } else if (diff < 0 && this.currentSlide < this.totalSlides - 1) {
                this.goToSlide(this.currentSlide + 1);
                logger.userInteraction('CITY', 'Carousel swiped left (next slide)');
            } else {
                this.updateCarousel(); // Snap back to current position
            }
        } else {
            this.updateCarousel(); // Snap back to current position
        }
        
        this.resumeAutoSlide();
    }

    handleMouseDown(e) {
        this.touchStartX = e.clientX;
        this.startTransform = this.currentTransform;
        this.isDragging = true;
        this.track.classList.add('swiping');
        this.pauseAutoSlide();
        e.preventDefault();
    }

    handleMouseMove(e) {
        if (!this.isDragging) return;
        
        this.touchEndX = e.clientX;
        const diff = this.touchEndX - this.touchStartX;
        this.currentTransform = this.startTransform + diff;
        this.track.style.transform = `translateX(${this.currentTransform}px)`;
    }

    handleMouseUp(e) {
        if (!this.isDragging) return;
        
        this.isDragging = false;
        this.track.classList.remove('swiping');
        
        const diff = this.touchEndX - this.touchStartX;
        const threshold = 50;
        
        if (Math.abs(diff) > threshold) {
            if (diff > 0 && this.currentSlide > 0) {
                this.goToSlide(this.currentSlide - 1);
                logger.userInteraction('CITY', 'Carousel dragged right (previous slide)');
            } else if (diff < 0 && this.currentSlide < this.totalSlides - 1) {
                this.goToSlide(this.currentSlide + 1);
                logger.userInteraction('CITY', 'Carousel dragged left (next slide)');
            } else {
                this.updateCarousel();
            }
        } else {
            this.updateCarousel();
        }
        
        this.resumeAutoSlide();
    }

    goToSlide(slideIndex) {
        this.currentSlide = Math.max(0, Math.min(slideIndex, this.totalSlides - 1));
        this.updateCarousel();
    }

    updateCarousel() {
        // Calculate transform based on current slide
        const containerWidth = this.carousel.offsetWidth;
        const slideWidth = containerWidth * 0.8; // Show partial next slide
        
        // On mobile, use different sliding logic
        if (window.innerWidth <= 768) {
            const bubbleWidth = 70 + 16; // bubble width + gap
            const bubblesPerSlide = Math.floor(containerWidth / bubbleWidth);
            const offset = this.currentSlide * bubblesPerSlide * bubbleWidth;
            this.currentTransform = -Math.min(offset, (this.bubbles.length - bubblesPerSlide) * bubbleWidth);
        } else {
            // Desktop: slide by container width
            this.currentTransform = -this.currentSlide * slideWidth;
        }
        
        this.track.style.transform = `translateX(${this.currentTransform}px)`;
        
        // Update dots
        this.dots.forEach((dot, index) => {
            dot.classList.toggle('active', index === this.currentSlide);
        });
        
        logger.debug('CITY', `Carousel updated to slide ${this.currentSlide}`, {
            transform: this.currentTransform,
            totalSlides: this.totalSlides
        });
    }

    startAutoSlide() {
        if (this.autoSlideInterval) {
            clearInterval(this.autoSlideInterval);
        }
        
        this.autoSlideInterval = setInterval(() => {
            if (this.isAutoSliding && !this.isDragging) {
                const nextSlide = (this.currentSlide + 1) % this.totalSlides;
                this.goToSlide(nextSlide);
                logger.debug('CITY', `Auto-slide to slide ${nextSlide}`);
            }
        }, this.autoSlideDelay);
        
        logger.componentLoad('CITY', 'Auto-slide started', {
            delay: this.autoSlideDelay
        });
    }

    pauseAutoSlide() {
        this.isAutoSliding = false;
        logger.debug('CITY', 'Auto-slide paused');
    }

    resumeAutoSlide() {
        setTimeout(() => {
            this.isAutoSliding = true;
            logger.debug('CITY', 'Auto-slide resumed');
        }, 2000); // Resume after 2 seconds of inactivity
    }

    destroy() {
        if (this.autoSlideInterval) {
            clearInterval(this.autoSlideInterval);
        }
        logger.componentLoad('CITY', 'City carousel destroyed');
    }
}

// Initialize city carousel when DOM is ready
if (typeof window !== 'undefined') {
    window.CityCarouselManager = CityCarouselManager;
}