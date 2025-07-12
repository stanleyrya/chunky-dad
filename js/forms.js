// Forms Module - Handles form validation, submission, and user interactions
class FormsManager {
    constructor() {
        this.contactForm = document.querySelector('.contact-form');
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

        this.submitForm(formData);
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

    submitForm(formData) {
        const submitButton = this.contactForm.querySelector('button');
        const originalText = submitButton.textContent;
        
        logger.info('FORM', 'Form submission started');
        
        // Update button state
        submitButton.textContent = 'Sending...';
        submitButton.disabled = true;
        
        // Create mailto link with the form data
        const subject = encodeURIComponent(`Bear Intel Submission: ${formData.category || 'General'}`);
        const body = encodeURIComponent(
            `Name: ${formData.name}\n` +
            `Email: ${formData.email}\n` +
            `Category: ${formData.category || 'Not specified'}\n\n` +
            `Message:\n${formData.message}\n\n` +
            `---\nSubmitted via Chunky Dad website form`
        );
        
        const mailtoLink = `mailto:info@chunky.dad?subject=${subject}&body=${body}`;
        
        // Open email client
        try {
            window.location.href = mailtoLink;
            
            // Show success message after a short delay
            setTimeout(() => {
                logger.pageLoad('FORM', 'Form submission completed - email client opened');
                alert('Thank you! Your email client should open with your message. If it doesn\'t open automatically, please email us at info@chunky.dad');
                
                this.resetForm();
                
                // Restore button state
                submitButton.textContent = originalText;
                submitButton.disabled = false;
            }, 1000);
            
        } catch (error) {
            logger.componentError('FORM', 'Error opening email client', error);
            
            // Fallback: show email address
            alert(`Please send your message to: info@chunky.dad\n\nSubject: ${decodeURIComponent(subject)}\n\nMessage: ${formData.message}`);
            
            // Restore button state
            submitButton.textContent = originalText;
            submitButton.disabled = false;
        }
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