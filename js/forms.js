// Forms Module - Handles form validation, submission, and user interactions
class FormsManager {
    constructor() {
        this.contactForm = document.querySelector('.contact-form');
        // TODO: Replace with your actual Google Form URL
        // To create a Google Form:
        // 1. Go to forms.google.com
        // 2. Create a new form with fields: Name, Email, Category, Message
        // 3. Click "Send" and copy the form URL
        // 4. Replace the URL below
        this.googleFormUrl = 'https://forms.gle/YOUR_FORM_ID_HERE'; // Replace with actual Google Form URL
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

        this.showSubmissionOptions(formData);
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

    showSubmissionOptions(formData) {
        const modal = this.createSubmissionModal(formData);
        document.body.appendChild(modal);
        
        // Show modal with animation
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);
        
        logger.info('FORM', 'Submission options modal displayed');
    }

    createSubmissionModal(formData) {
        const modal = document.createElement('div');
        modal.className = 'submission-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Choose How to Submit</h3>
                    <button class="close-btn" onclick="this.closest('.submission-modal').remove()">×</button>
                </div>
                <div class="modal-body">
                    <p>We have two easy ways to submit your bear intel:</p>
                    
                    <div class="submission-options">
                        <div class="option-card" onclick="window.formsManager.submitToGoogleForm()">
                            <div class="option-icon">📝</div>
                            <h4>Google Form (Recommended)</h4>
                            <p>Quick and easy form submission</p>
                            <button class="option-btn">Use Google Form</button>
                        </div>
                        
                        <div class="option-card" onclick="window.formsManager.submitViaEmail()">
                            <div class="option-icon">📧</div>
                            <h4>Email Us Directly</h4>
                            <p>Send us an email with your info</p>
                            <button class="option-btn">Send Email</button>
                        </div>
                    </div>
                    
                    <div class="form-preview">
                        <h4>Your Message Preview:</h4>
                        <div class="preview-content">
                            <p><strong>From:</strong> ${formData.name} (${formData.email})</p>
                            <p><strong>Category:</strong> ${formData.category}</p>
                            <p><strong>Message:</strong> ${formData.message.substring(0, 100)}${formData.message.length > 100 ? '...' : ''}</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Store form data for later use
        modal.formData = formData;
        
        return modal;
    }

    submitToGoogleForm() {
        logger.userInteraction('FORM', 'User chose Google Form submission');
        
        // Close modal
        const modal = document.querySelector('.submission-modal');
        if (modal) {
            modal.remove();
        }
        
        // Reset form
        this.resetForm();
        
        // Check if Google Form URL is set up
        if (this.googleFormUrl.includes('YOUR_FORM_ID_HERE')) {
            this.showSuccessMessage('Google Form not set up yet. Please use the email option or contact info@chunky.dad directly.');
            return;
        }
        
        // Redirect to Google Form
        window.open(this.googleFormUrl, '_blank');
        
        // Show success message
        this.showSuccessMessage('Google Form opened in new tab! Please fill out the form there.');
    }

    submitViaEmail() {
        logger.userInteraction('FORM', 'User chose email submission');
        
        const modal = document.querySelector('.submission-modal');
        const formData = modal ? modal.formData : null;
        
        // Close modal
        if (modal) {
            modal.remove();
        }
        
        // Reset form
        this.resetForm();
        
        if (formData) {
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
            
            // Open email client
            window.location.href = mailtoUrl;
            
            this.showSuccessMessage('Email client opened! Please send the email to complete your submission.');
        } else {
            // Fallback to simple mailto
            window.location.href = `mailto:${this.mailtoEmail}`;
            this.showSuccessMessage('Email client opened! Please send us your bear intel.');
        }
    }

    showSuccessMessage(message) {
        const notification = document.createElement('div');
        notification.className = 'success-notification';
        notification.innerHTML = `
            <div class="notification-content">
                <span class="notification-icon">✅</span>
                <span class="notification-text">${message}</span>
                <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Show notification with animation
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentElement) {
                notification.classList.remove('show');
                setTimeout(() => {
                    if (notification.parentElement) {
                        notification.remove();
                    }
                }, 300);
            }
        }, 5000);
        
        logger.info('FORM', 'Success message displayed', { message });
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