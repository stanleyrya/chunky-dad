// Forms Module - Handles form validation, submission, and user interactions
class FormsManager {
    constructor() {
        this.contactForm = document.querySelector('.contact-form');
        this.init();
    }

    init() {
        logger.componentInit('FORM', 'Forms manager initializing');
        this.setupContactForm();
        this.checkForFormResponse();
        logger.componentLoad('FORM', 'Forms manager initialized');
    }

    setupContactForm() {
        if (!this.contactForm) {
            logger.debug('FORM', 'No contact form found on this page - skipping setup');
            return;
        }

        logger.componentInit('FORM', 'Contact form found and initializing');
        
        this.contactForm.addEventListener('submit', (e) => {
            this.handleContactFormSubmission(e);
        });
        
        logger.componentLoad('FORM', 'Contact form setup complete');
    }

    handleContactFormSubmission(event) {
        logger.userInteraction('FORM', 'Contact form submitted');
        
        const formData = this.collectFormData();
        
        if (!this.validateFormData(formData)) {
            event.preventDefault();
            return;
        }

        // Check if Formspree is properly configured
        const formAction = this.contactForm.action;
        if (formAction.includes('YOUR_FORM_ID_HERE')) {
            event.preventDefault();
            logger.componentError('FORM', 'Formspree not configured - showing setup instructions');
            alert('Email feature not yet configured. Please contact the site administrator to set up email functionality.');
            return;
        }

        // Let the form submit naturally to Formspree
        this.updateButtonState('Sending...', true);
        logger.info('FORM', 'Form submission started - sending to Formspree');
    }

    collectFormData() {
        const name = this.contactForm.querySelector('input[type="text"]').value;
        const email = this.contactForm.querySelector('input[type="email"]').value;
        const message = this.contactForm.querySelector('textarea').value;
        const category = this.contactForm.querySelector('select').value;
        
        const formData = { name, email, message, category };
        
        logger.debug('FORM', 'Form data collected', {
            name: name ? 'provided' : 'missing',
            email: email ? 'provided' : 'missing',
            message: message ? `${message.length} chars` : 'missing',
            category: category || 'not selected'
        });

        return formData;
    }

    validateFormData(formData) {
        const { name, email, message } = formData;
        
        if (!name || !email || !message) {
            logger.warn('FORM', 'Form validation failed - missing required fields');
            alert('Please fill in all fields');
            return false;
        }

        // Basic email validation
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(email)) {
            logger.warn('FORM', 'Form validation failed - invalid email format');
            alert('Please enter a valid email address');
            return false;
        }

        logger.debug('FORM', 'Form validation passed');
        return true;
    }

    updateButtonState(text, disabled = false) {
        const submitButton = this.contactForm.querySelector('button');
        if (submitButton) {
            submitButton.textContent = text;
            submitButton.disabled = disabled;
        }
    }

    // Handle form submission success/failure
    handleFormResponse(success = true) {
        if (success) {
            logger.pageLoad('FORM', 'Form submitted successfully via Formspree');
            alert('Thank you for your message! We\'ll get back to you soon.');
            this.resetForm();
        } else {
            logger.componentError('FORM', 'Form submission failed');
            alert('Sorry, there was an error sending your message. Please try again.');
        }
        
        this.updateButtonState('Send the Tea ☕', false);
    }

    resetForm() {
        if (this.contactForm) {
            this.contactForm.reset();
            logger.debug('FORM', 'Form reset successfully');
        }
    }

    // Check for form submission response from Formspree redirect
    checkForFormResponse() {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('success') === 'true') {
            logger.pageLoad('FORM', 'Form submission successful - redirected from Formspree');
            alert('Thank you for your message! We\'ll get back to you soon.');
            // Clean up the URL
            window.history.replaceState({}, document.title, window.location.pathname);
        } else if (urlParams.get('success') === 'false') {
            logger.componentError('FORM', 'Form submission failed - redirected from Formspree');
            alert('Sorry, there was an error sending your message. Please try again.');
            // Clean up the URL
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }

    // Method to add more form handlers in the future
    addFormHandler(selector, handler) {
        const form = document.querySelector(selector);
        if (form) {
            form.addEventListener('submit', handler);
            logger.debug('FORM', `Form handler added for ${selector}`);
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FormsManager;
} else {
    window.FormsManager = FormsManager;
}