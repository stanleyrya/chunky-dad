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

        this.sendEmail(formData);
    }

    collectFormData() {
        const name = document.getElementById('contact-name').value;
        const email = document.getElementById('contact-email').value;
        const message = document.getElementById('contact-message').value;
        const category = document.getElementById('contact-category').value;
        
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

    sendEmail(formData) {
        const { name, email, message, category } = formData;
        
        // Create a nicely formatted email
        const subject = encodeURIComponent(`🐻 Bear Intel: ${category}`);
        
        const emailBody = encodeURIComponent(`Hi chunky.dad team!

I have some bear intel to share:

📋 CONTACT INFO:
Name: ${name}
Email: ${email}

🏷️ CATEGORY: ${category}

💬 MESSAGE:
${message}

---
Sent from chunky.dad contact form
🐻 Keep it bear-y!`);

        // Create mailto link
        const mailtoLink = `mailto:info@chunky.dad?subject=${subject}&body=${emailBody}`;
        
        logger.info('FORM', 'Opening mailto link', { 
            to: 'info@chunky.dad', 
            category: category,
            messageLength: message.length 
        });
        
        // Open the user's default email client
        window.open(mailtoLink);
        
        // Show success message
        alert('Thanks! Your default email client should open with a pre-filled message. Just hit send to share your bear intel! 🐻');
        
        // Reset the form
        this.resetForm();
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