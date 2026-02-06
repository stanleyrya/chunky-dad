// Forms Module - Handles form validation, submission, and user interactions
class FormsManager {
    constructor() {
        this.contactForm = document.querySelector('.contact-form');
        this.bearIntelForm = null;
        this.bearIntelModal = null;
        this.shareIntelBtn = null;
        this.submitInfoBtn = null;
        this.modalCloseBtn = null;
        this.eventBuilderOption = null;
        this.bearIntelTypeSelect = null;
        this.defaultMailtoEmail = 'info@chunky.dad';
        this.categoryEmailMap = {
            event: 'events@chunky.dad',
            venue: 'bars@chunky.dad',
            business: 'businesses@chunky.dad',
            city: 'cities@chunky.dad',
            other: 'info@chunky.dad'
        };
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
        this.eventBuilderOption = document.getElementById('event-builder-option');
        this.bearIntelTypeSelect = this.bearIntelForm ? this.bearIntelForm.querySelector('select') : null;

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

        if (this.bearIntelTypeSelect) {
            this.bearIntelTypeSelect.addEventListener('change', () => {
                this.updateEventBuilderOption();
            });
            this.updateEventBuilderOption();
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
                this.updateEventBuilderOption();
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
                this.updateEventBuilderOption();
            }
        }, 100);
    }

    updateEventBuilderOption() {
        if (!this.eventBuilderOption || !this.bearIntelTypeSelect) {
            return;
        }
        const isEvent = this.bearIntelTypeSelect.value === 'event';
        this.eventBuilderOption.classList.toggle('is-visible', isEvent);
        this.eventBuilderOption.setAttribute('aria-hidden', String(!isEvent));
    }

    openBearIntelModal() {
        logger.userInteraction('FORM', 'Bear Intel modal opened');
        this.bearIntelModal.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
        
        // Focus on first interactive field
        const firstField = this.bearIntelForm.querySelector('select, textarea, input');
        if (firstField) {
            setTimeout(() => firstField.focus(), 100);
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
        const nameInput = form.querySelector('input[type="text"]');
        const emailInput = form.querySelector('input[type="email"]');
        const messageInput = form.querySelector('textarea');
        const categorySelect = form.querySelector('select');

        const name = nameInput ? nameInput.value.trim() : '';
        const email = emailInput ? emailInput.value.trim() : '';
        const message = messageInput ? messageInput.value.trim() : '';
        const category = categorySelect ? categorySelect.value : '';

        const formData = {
            name,
            email,
            message,
            category,
            hasNameField: Boolean(nameInput),
            hasEmailField: Boolean(emailInput),
            hasCategoryField: Boolean(categorySelect),
            hasMessageField: Boolean(messageInput)
        };

        logger.debug('FORM', 'Form data collected', {
            name: formData.hasNameField ? (name ? 'provided' : 'missing') : 'not requested',
            email: formData.hasEmailField ? (email ? 'provided' : 'missing') : 'not requested',
            message: message ? `${message.length} chars` : 'missing',
            category: category || 'not selected'
        });

        return formData;
    }

    validateFormData(formData) {
        const {
            name,
            email,
            message,
            category,
            hasNameField,
            hasEmailField,
            hasCategoryField,
            hasMessageField
        } = formData;

        const missingFields = [];
        if (hasNameField && !name) {
            missingFields.push('name');
        }
        if (hasEmailField && !email) {
            missingFields.push('email');
        }
        if (hasMessageField && !message) {
            missingFields.push('message');
        }
        if (hasCategoryField && !category) {
            missingFields.push('category');
        }

        if (missingFields.length > 0) {
            logger.warn('FORM', 'Form validation failed - missing required fields', {
                missingFields
            });
            return false;
        }

        if (hasEmailField && email) {
            // Basic email validation
            const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailPattern.test(email)) {
                logger.warn('FORM', 'Form validation failed - invalid email format', { email });
                return false;
            }
        }

        logger.debug('FORM', 'Form validation passed');
        return true;
    }

    submitViaEmail(formData, form) {
        logger.userInteraction('FORM', 'Form submitted via email');
        const mailtoEmail = this.getMailtoEmail(formData.category);

        // Create email content
        const subjectLabel = formData.category ? `Bear Intel: ${formData.category}` : 'Bear Intel';
        const subject = encodeURIComponent(subjectLabel);
        const bodyLines = [];

        if (formData.name) {
            bodyLines.push(`Name: ${formData.name}`);
        }
        if (formData.email) {
            bodyLines.push(`Email: ${formData.email}`);
        }
        if (formData.category) {
            bodyLines.push(`Category: ${formData.category}`);
        }
        bodyLines.push('', 'Message:', formData.message || '', '', '---', 'Sent from chunky.dad contact form');
        const body = encodeURIComponent(bodyLines.join('\r\n'));
        
        const mailtoUrl = `mailto:${mailtoEmail}?subject=${subject}&body=${body}`;
        
        // Reset form
        this.resetForm(form);
        
        // Open email client
        window.location.href = mailtoUrl;
        
        logger.info('FORM', 'Email client opened with pre-filled content', {
            to: mailtoEmail,
            subject: subjectLabel,
            messageLength: formData.message ? formData.message.length : 0
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

    getMailtoEmail(category) {
        if (!category) {
            return this.defaultMailtoEmail;
        }
        return this.categoryEmailMap[category] || this.defaultMailtoEmail;
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