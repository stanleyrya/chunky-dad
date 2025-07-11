// Form Handler Module - Handles contact form functionality
class FormHandler {
    constructor() {
        this.initializeContactForm();
    }

    initializeContactForm() {
        const contactForm = document.querySelector('.contact-form');
        if (contactForm) {
            console.log('Contact form found, adding event listener');
            contactForm.addEventListener('submit', (e) => this.handleContactFormSubmission(e));
        } else {
            console.log('No contact form found on this page - skipping contact form setup');
        }
    }

    handleContactFormSubmission(e) {
        e.preventDefault();
        
        const form = e.target;
        
        // Get form data
        const formData = new FormData(form);
        const name = form.querySelector('input[type="text"]').value;
        const email = form.querySelector('input[type="email"]').value;
        const message = form.querySelector('textarea').value;
        
        // Basic validation
        if (!this.validateForm(name, email, message)) {
            return;
        }
        
        // Simulate form submission
        this.submitForm(form, { name, email, message });
    }

    validateForm(name, email, message) {
        if (!name || !email || !message) {
            alert('Please fill in all fields');
            return false;
        }
        
        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            alert('Please enter a valid email address');
            return false;
        }
        
        return true;
    }

    async submitForm(form, data) {
        const submitButton = form.querySelector('button');
        const originalText = submitButton.textContent;
        
        // Update button state
        submitButton.textContent = 'Sending...';
        submitButton.disabled = true;
        
        try {
            // Simulate API call delay
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Show success message
            alert('Thank you for your message! We\'ll get back to you soon.');
            form.reset();
            
        } catch (error) {
            console.error('Form submission error:', error);
            alert('Sorry, there was an error sending your message. Please try again.');
        } finally {
            // Restore button state
            submitButton.textContent = originalText;
            submitButton.disabled = false;
        }
    }
}

// Initialize form handler when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.formHandler = new FormHandler();
    });
} else {
    window.formHandler = new FormHandler();
}