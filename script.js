// Mobile Navigation Toggle
const hamburger = document.querySelector('.hamburger');
const navMenu = document.querySelector('.nav-menu');

hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('active');
    navMenu.classList.toggle('active');
});

// Close mobile menu when clicking on nav links
document.querySelectorAll('.nav-menu a').forEach(link => {
    link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navMenu.classList.remove('active');
    });
});

// Smooth scrolling for navigation links
function scrollToSection(sectionId) {
    const element = document.getElementById(sectionId);
    if (element) {
        element.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }
}

// Add smooth scrolling to all anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Contact Form Handling - Only if form exists
const contactForm = document.querySelector('.contact-form');
if (contactForm) {
    console.log('Contact form found, adding event listener');
    contactForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // Get form data
        const formData = new FormData(this);
        const name = this.querySelector('input[type="text"]').value;
        const email = this.querySelector('input[type="email"]').value;
        const message = this.querySelector('textarea').value;
        
        // Basic validation
        if (!name || !email || !message) {
            alert('Please fill in all fields');
            return;
        }
        
        // Simulate form submission
        const submitButton = this.querySelector('button');
        const originalText = submitButton.textContent;
        
        submitButton.textContent = 'Sending...';
        submitButton.disabled = true;
        
        setTimeout(() => {
            alert('Thank you for your message! We\'ll get back to you soon.');
            this.reset();
            submitButton.textContent = originalText;
            submitButton.disabled = false;
        }, 2000);
    });
} else {
    console.log('No contact form found on this page - skipping contact form setup');
}

// Header scroll effect
window.addEventListener('scroll', () => {
    const header = document.querySelector('header');
    if (window.scrollY > 100) {
        header.style.background = 'rgba(102, 126, 234, 0.95)';
        header.style.backdropFilter = 'blur(10px)';
    } else {
        header.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        header.style.backdropFilter = 'none';
    }
});

// Add intersection observer for animations
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('animate');
        }
    });
}, observerOptions);

// Observe all animation elements
document.querySelectorAll('.about-card, .gallery-item, .contact-item').forEach(el => {
    observer.observe(el);
});

// Add loading animation
window.addEventListener('load', () => {
    document.body.classList.add('loaded');
});

// Parallax effect for hero section
window.addEventListener('scroll', () => {
    const scrolled = window.pageYOffset;
    const heroImage = document.querySelector('.hero-image');
    if (heroImage) {
        heroImage.style.transform = `translateY(${scrolled * 0.5}px)`;
    }
});

// Add hover effects for gallery items
document.querySelectorAll('.gallery-item').forEach(item => {
    item.addEventListener('mouseenter', function() {
        this.style.transform = 'translateY(-10px) scale(1.02)';
    });
    
    item.addEventListener('mouseleave', function() {
        this.style.transform = 'translateY(0) scale(1)';
    });
});

// Add click effects for CTA buttons
document.querySelectorAll('.cta-button').forEach(button => {
    button.addEventListener('click', function() {
        this.style.transform = 'scale(0.95)';
        setTimeout(() => {
            this.style.transform = 'scale(1)';
        }, 150);
    });
});

// Typing effect for main page hero title
function typeWriter(element, text, speed = 100) {
    let i = 0;
    element.innerHTML = '';
    
    function type() {
        if (i < text.length) {
            element.innerHTML += text.charAt(i);
            i++;
            setTimeout(type, speed);
        }
    }
    
    type();
}

// Initialize effects based on page type
document.addEventListener('DOMContentLoaded', () => {
    const isMainPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname === '';
    const isCityPage = window.location.pathname.includes('city.html');
    
    if (isMainPage) {
        // Main page: Add typing effect and smooth reveals
        const heroTitle = document.querySelector('.hero-content h2');
        if (heroTitle) {
            const originalText = heroTitle.textContent;
            setTimeout(() => {
                typeWriter(heroTitle, originalText, 60);
            }, 300);
        }
    } else if (isCityPage) {
        // City pages: Make everything visible immediately but smoothly
        document.body.classList.add('city-page');
        const sections = document.querySelectorAll('section');
        sections.forEach(section => {
            section.classList.add('fade-in');
        });
    }
});

// Smooth fade-in effect for sections on main page only
function fadeInOnScroll() {
    const isMainPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname === '';
    if (!isMainPage) return;
    
    const sections = document.querySelectorAll('section');
    
    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        const windowHeight = window.innerHeight;
        const scrollPosition = window.scrollY;
        
        if (scrollPosition + windowHeight > sectionTop + 100) {
            section.classList.add('fade-in');
        }
    });
}

// Apply scroll effects only on main page
const isMainPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname === '';
if (isMainPage) {
    window.addEventListener('scroll', fadeInOnScroll);
    fadeInOnScroll(); // Initial call
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