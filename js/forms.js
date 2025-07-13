// Forms Module - Handles form validation, submission, and user interactions
class FormsManager {
    constructor() {
        this.contactForm = document.querySelector('.contact-form');
        this.mailtoEmail = 'info@chunky.dad';
        this.init();
    }

    init() {
        logger.componentInit('FORM', 'Forms manager initializing');
        this.setupContactForm();
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
        event.preventDefault();
        logger.userInteraction('FORM', 'Contact form submitted');
        
        const formData = this.collectFormData();
        
        if (!this.validateFormData(formData)) {
            return;
        }

        this.submitViaEmail(formData);
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
            logger.warn('FORM', 'Form validation failed - missing required fields', {
                name: !!name,
                email: !!email,
                message: !!message
            });
            return false;
        }

        // Basic email validation
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(email)) {
            logger.warn('FORM', 'Form validation failed - invalid email format', { email });
            return false;
        }

        logger.debug('FORM', 'Form validation passed');
        return true;
    }

    submitViaEmail(formData) {
        logger.userInteraction('FORM', 'Form submitted via email');
        
        // Create email content
        const subject = encodeURIComponent(`Bear Intel: ${formData.category}`);
        const body = encodeURIComponent(`Name: ${formData.name}
Email: ${formData.email}
Category: ${formData.category}

Message:
${formData.message}

---
Sent from chunky.dad contact form`);
        
        const mailtoUrl = `mailto:${this.mailtoEmail}?subject=${subject}&body=${body}`;
        
        // Reset form
        this.resetForm();
        
        // Open email client
        window.location.href = mailtoUrl;
        
        logger.info('FORM', 'Email client opened with pre-filled content', {
            to: this.mailtoEmail,
            subject: `Bear Intel: ${formData.category}`,
            messageLength: formData.message.length
        });
    }

    resetForm() {
        if (this.contactForm) {
            this.contactForm.reset();
            logger.debug('FORM', 'Form reset successfully');
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