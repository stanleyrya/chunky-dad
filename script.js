// Mobile Navigation Toggle
const hamburger = document.querySelector('.hamburger');
const navMenu = document.querySelector('.nav-menu');

if (hamburger && navMenu) {
    logger.componentInit('NAV', 'Mobile navigation setup');
    
    hamburger.addEventListener('click', () => {
        logger.userInteraction('NAV', 'Mobile menu toggle clicked');
        hamburger.classList.toggle('active');
        navMenu.classList.toggle('active');
        
        const isActive = hamburger.classList.contains('active');
        logger.debug('NAV', `Mobile menu ${isActive ? 'opened' : 'closed'}`);
    });
} else {
    logger.warn('NAV', 'Mobile navigation elements not found');
}

// Close mobile menu when clicking on nav links
document.querySelectorAll('.nav-menu a').forEach((link, index) => {
    link.addEventListener('click', () => {
        logger.userInteraction('NAV', `Navigation link clicked: ${link.textContent}`);
        hamburger.classList.remove('active');
        navMenu.classList.remove('active');
        logger.debug('NAV', 'Mobile menu closed after link click');
    });
});

logger.componentLoad('NAV', 'Navigation setup complete', {
    mobileElements: !!(hamburger && navMenu),
    navLinks: document.querySelectorAll('.nav-menu a').length
});

// Smooth scrolling for navigation links
function scrollToSection(sectionId) {
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

// Add smooth scrolling to all anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const targetId = this.getAttribute('href').substring(1);
        logger.userInteraction('NAV', `Anchor link clicked: #${targetId}`);
        
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
            logger.debug('NAV', `Smooth scroll to ${targetId} initiated`);
        } else {
            logger.warn('NAV', `Anchor target not found: #${targetId}`);
        }
    });
});

// Contact Form Handling - Only if form exists
const contactForm = document.querySelector('.contact-form');
if (contactForm) {
    logger.componentInit('FORM', 'Contact form found and initializing');
    
    contactForm.addEventListener('submit', function(e) {
        e.preventDefault();
        logger.userInteraction('FORM', 'Contact form submitted');
        
        // Get form data
        const formData = new FormData(this);
        const name = this.querySelector('input[type="text"]').value;
        const email = this.querySelector('input[type="email"]').value;
        const message = this.querySelector('textarea').value;
        const category = this.querySelector('select').value;
        
        logger.debug('FORM', 'Form data collected', {
            name: name ? 'provided' : 'missing',
            email: email ? 'provided' : 'missing',
            message: message ? `${message.length} chars` : 'missing',
            category: category || 'not selected'
        });
        
        // Basic validation
        if (!name || !email || !message) {
            logger.warn('FORM', 'Form validation failed - missing required fields');
            alert('Please fill in all fields');
            return;
        }
        
        // Simulate form submission
        const submitButton = this.querySelector('button');
        const originalText = submitButton.textContent;
        
        logger.info('FORM', 'Form submission started');
        submitButton.textContent = 'Sending...';
        submitButton.disabled = true;
        
        setTimeout(() => {
            logger.pageLoad('FORM', 'Form submitted successfully');
            alert('Thank you for your message! We\'ll get back to you soon.');
            this.reset();
            submitButton.textContent = originalText;
            submitButton.disabled = false;
        }, 2000);
    });
    
    logger.componentLoad('FORM', 'Contact form setup complete');
} else {
    logger.debug('FORM', 'No contact form found on this page - skipping setup');
}

// Header scroll effect - simplified for city page with dynamic scroll interactions
const isMainPageHeader = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname === '';
const header = document.querySelector('header');

if (isMainPageHeader && header) {
    logger.componentInit('PAGE', 'Main page header scroll effects');
    
    window.addEventListener('scroll', () => {
        const scrollY = window.scrollY;
        if (scrollY > 100) {
            header.style.background = 'rgba(102, 126, 234, 0.95)';
            header.style.backdropFilter = 'blur(10px)';
        } else {
            header.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            header.style.backdropFilter = 'none';
        }
    });
    
    logger.componentLoad('PAGE', 'Header scroll effects enabled');
} else {
    logger.debug('PAGE', 'Header scroll effects not applied', {
        isMainPage: isMainPageHeader,
        headerExists: !!header
    });
}

// Add intersection observer for animations
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

// Observe all animation elements
const animationElements = document.querySelectorAll('.about-card, .gallery-item, .contact-item');
animationElements.forEach(el => {
    observer.observe(el);
});

logger.componentLoad('PAGE', 'Intersection observer setup complete', {
    elementsObserved: animationElements.length
});

// Add loading animation
window.addEventListener('load', () => {
    logger.performance('PAGE', 'Page load complete - adding loaded class');
    document.body.classList.add('loaded');
});

// Parallax effect for hero section
const heroImage = document.querySelector('.hero-image');
if (heroImage) {
    logger.componentInit('PAGE', 'Hero parallax effect setup');
    
    window.addEventListener('scroll', () => {
        const scrolled = window.pageYOffset;
        heroImage.style.transform = `translateY(${scrolled * 0.5}px)`;
    });
    
    logger.componentLoad('PAGE', 'Hero parallax effect enabled');
} else {
    logger.debug('PAGE', 'Hero image not found - parallax effect skipped');
}

// Add hover effects for gallery items
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

// Add click effects for CTA buttons
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

// Typing effect for main page hero title
function typeWriter(element, text, speed = 100) {
    logger.debug('PAGE', `Starting typewriter effect for: ${text.substring(0, 20)}...`);
    let i = 0;
    element.innerHTML = '';
    
    function type() {
        if (i < text.length) {
            element.innerHTML += text.charAt(i);
            i++;
            setTimeout(type, speed);
        } else {
            logger.debug('PAGE', 'Typewriter effect completed');
        }
    }
    
    type();
}

// Initialize effects based on page type
document.addEventListener('DOMContentLoaded', () => {
    const isMainPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname === '';
    const isCityPage = window.location.pathname.includes('city.html');
    
    logger.info('PAGE', 'DOM content loaded', {
        isMainPage,
        isCityPage,
        pathname: window.location.pathname
    });
    
    if (isMainPage) {
        logger.componentInit('PAGE', 'Main page initialization');
        
        // Main page: Add typing effect and smooth reveals
        const heroTitle = document.querySelector('.hero-content h2');
        if (heroTitle) {
            const originalText = heroTitle.textContent;
            logger.debug('PAGE', 'Starting hero title animation');
            setTimeout(() => {
                typeWriter(heroTitle, originalText, 60);
            }, 300);
        }
        
        logger.componentLoad('PAGE', 'Main page initialization complete');
    } else if (isCityPage) {
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
});

// Smooth fade-in effect for sections on main page only
function fadeInOnScroll() {
    const isMainPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname === '';
    if (!isMainPage) return;
    
    const sections = document.querySelectorAll('section');
    let animatedCount = 0;
    
    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        const windowHeight = window.innerHeight;
        const scrollPosition = window.scrollY;
        
        if (scrollPosition + windowHeight > sectionTop + 100) {
            if (!section.classList.contains('fade-in')) {
                section.classList.add('fade-in');
                animatedCount++;
            }
        }
    });
    
    if (animatedCount > 0) {
        logger.debug('PAGE', `Animated ${animatedCount} sections on scroll`);
    }
}

// Apply scroll effects only on main page
const isMainPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname === '';
if (isMainPage) {
    window.addEventListener('scroll', fadeInOnScroll);
    fadeInOnScroll(); // Initial call
    logger.componentLoad('PAGE', 'Main page scroll animations enabled');
}

// Add CSS for beautiful smooth effects on both pages
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
    }
    
    body:not(.city-page) section.fade-in {
        opacity: 1;
        transform: translateY(0);
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