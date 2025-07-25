// Forms Module - Handles form validation, submission, and user interactions
class FormsManager {
    constructor() {
        this.contactForm = document.querySelector('.contact-form');
        this.bearIntelForm = null;
        this.bearIntelModal = null;
        this.shareIntelBtn = null;
        this.submitInfoBtn = null;
        this.modalCloseBtn = null;
        this.mailtoEmail = 'info@chunky.dad';
        this.modalSetupComplete = false;
        this.init();
    }

    init() {
        logger.componentInit('FORM', 'Forms manager initializing');
        this.setupContactForm();
        
        // Listen for components ready event
        document.addEventListener('componentsReady', () => {
            this.setupBearIntelModal();
        });
        
        // Also try to set up immediately in case components are already loaded
        this.setupBearIntelModal();
        
        // Listen for card rendering events to set up suggestion buttons
        document.addEventListener('cityCardsReady', () => {
            this.setupMoreCitiesButton();
        });
        
        document.addEventListener('eventCardsReady', () => {
            this.setupMoreEventsButton();
        });
        
        logger.componentLoad('FORM', 'Forms manager initialized');
    }

    setupContactForm() {
        if (!this.contactForm) {
            logger.debug('FORM', 'No legacy contact form found - skipping setup');
            return;
        }

        logger.componentInit('FORM', 'Legacy contact form found and initializing');
        
        this.contactForm.addEventListener('submit', (e) => {
            this.handleContactFormSubmission(e);
        });
        
        logger.componentLoad('FORM', 'Legacy contact form setup complete');
    }

    setupBearIntelModal() {
        // Skip if already set up
        if (this.modalSetupComplete) {
            logger.debug('FORM', 'Bear Intel modal already set up - skipping');
            return;
        }

        // Refresh element references in case they were just injected
        this.bearIntelModal = document.getElementById('bear-intel-modal');
        this.shareIntelBtn = document.getElementById('share-intel-btn');
        this.submitInfoBtn = document.getElementById('submit-info-btn');
        this.modalCloseBtn = document.getElementById('modal-close-btn');
        this.bearIntelForm = document.querySelector('.bear-intel-form');

        if (!this.bearIntelModal || !this.shareIntelBtn) {
            logger.debug('FORM', 'Bear Intel modal components not found - skipping setup');
            return;
        }

        logger.componentInit('FORM', 'Bear Intel modal found and initializing');

        // Open modal when share intel button is clicked
        this.shareIntelBtn.addEventListener('click', () => {
            this.openBearIntelModal();
        });

        // Open modal when submit info button is clicked (city pages)
        if (this.submitInfoBtn) {
            this.submitInfoBtn.addEventListener('click', () => {
                this.openBearIntelModal();
            });
        }

        // Close modal when close button is clicked
        if (this.modalCloseBtn) {
            this.modalCloseBtn.addEventListener('click', () => {
                this.closeBearIntelModal();
            });
        }

        // Close modal when clicking outside
        this.bearIntelModal.addEventListener('click', (e) => {
            if (e.target === this.bearIntelModal) {
                this.closeBearIntelModal();
            }
        });

        // Close modal on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.bearIntelModal.style.display !== 'none') {
                this.closeBearIntelModal();
            }
        });

        // Handle form submission
        if (this.bearIntelForm) {
            this.bearIntelForm.addEventListener('submit', (e) => {
                this.handleBearIntelFormSubmission(e);
            });
        }

        this.modalSetupComplete = true;
        logger.componentLoad('FORM', 'Bear Intel modal setup complete');
    }

    setupMoreCitiesButton() {
        const moreCitiesBtn = document.getElementById('more-cities-btn');
        if (!moreCitiesBtn) {
            logger.debug('FORM', 'More cities button not found - skipping setup');
            return;
        }

        logger.componentInit('FORM', 'More cities button found and initializing');

        moreCitiesBtn.addEventListener('click', () => {
            logger.userInteraction('FORM', 'More cities button clicked');
            this.openBearIntelModalWithCityPreset();
        });

        logger.componentLoad('FORM', 'More cities button setup complete');
    }

    setupMoreEventsButton() {
        const moreEventsBtn = document.getElementById('more-events-btn');
        if (!moreEventsBtn) {
            logger.debug('FORM', 'More events button not found - skipping setup');
            return;
        }

        logger.componentInit('FORM', 'More events button found and initializing');

        moreEventsBtn.addEventListener('click', () => {
            logger.userInteraction('FORM', 'More events button clicked');
            this.openBearIntelModalWithEventPreset();
        });

        logger.componentLoad('FORM', 'More events button setup complete');
    }

    openBearIntelModalWithCityPreset() {
        // Open the modal first
        this.openBearIntelModal();
        
        // Pre-select "New City Suggestion" in the dropdown
        setTimeout(() => {
            const selectElement = this.bearIntelForm.querySelector('select');
            if (selectElement) {
                selectElement.value = 'city';
                logger.debug('FORM', 'City preset applied to modal form');
            }
        }, 100);
    }

    openBearIntelModalWithEventPreset() {
        // Open the modal first
        this.openBearIntelModal();
        
        // Pre-select "New Event Suggestion" in the dropdown
        setTimeout(() => {
            const selectElement = this.bearIntelForm.querySelector('select');
            if (selectElement) {
                selectElement.value = 'event';
                logger.debug('FORM', 'Event preset applied to modal form');
            }
        }, 100);
    }

    openBearIntelModal() {
        logger.userInteraction('FORM', 'Bear Intel modal opened');
        this.bearIntelModal.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
        
        // Focus on first input
        const firstInput = this.bearIntelForm.querySelector('input[type="text"]');
        if (firstInput) {
            setTimeout(() => firstInput.focus(), 100);
        }
    }

    closeBearIntelModal() {
        logger.userInteraction('FORM', 'Bear Intel modal closed');
        this.bearIntelModal.style.display = 'none';
        document.body.style.overflow = ''; // Restore scrolling
    }

    handleContactFormSubmission(event) {
        event.preventDefault();
        logger.userInteraction('FORM', 'Legacy contact form submitted');
        
        const formData = this.collectFormData(this.contactForm);
        
        if (!this.validateFormData(formData)) {
            return;
        }

        this.submitViaEmail(formData, this.contactForm);
    }

    handleBearIntelFormSubmission(event) {
        event.preventDefault();
        logger.userInteraction('FORM', 'Bear Intel form submitted');
        
        const formData = this.collectFormData(this.bearIntelForm);
        
        if (!this.validateFormData(formData)) {
            return;
        }

        this.submitViaEmail(formData, this.bearIntelForm);
        this.closeBearIntelModal();
    }

    collectFormData(form) {
        const name = form.querySelector('input[type="text"]').value;
        const email = form.querySelector('input[type="email"]').value;
        const message = form.querySelector('textarea').value;
        const category = form.querySelector('select').value;
        
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

    submitViaEmail(formData, form) {
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
        this.resetForm(form);
        
        // Open email client
        window.location.href = mailtoUrl;
        
        logger.info('FORM', 'Email client opened with pre-filled content', {
            to: this.mailtoEmail,
            subject: `Bear Intel: ${formData.category}`,
            messageLength: formData.message.length
        });
    }

    resetForm(form) {
        if (form) {
            form.reset();
            logger.debug('FORM', 'Form reset successfully');
        }
    }

    // Public method to open modal from other components
    showBearIntelModal() {
        this.openBearIntelModal();
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