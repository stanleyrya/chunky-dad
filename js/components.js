// Components Module - Handles reusable UI components
class ComponentsManager {
    constructor() {
        this.init();
    }

    init() {
        logger.componentInit('SYSTEM', 'Components manager initializing');
        this.injectFooter();
        this.injectBearIntelModal();
        
        // Dispatch event to notify other modules that components are ready
        const event = new CustomEvent('componentsReady');
        document.dispatchEvent(event);
        
        logger.componentLoad('SYSTEM', 'Components manager initialized');
    }

    injectFooter() {
        const footerElements = document.querySelectorAll('footer .container');
        
        if (footerElements.length === 0) {
            logger.debug('SYSTEM', 'No footer containers found - skipping footer injection');
            return;
        }

        const footerHTML = `
            <p>&copy; 2025 chunky.dad</p>
            <p>All info is community-sourced.</p>
            <button id="share-intel-btn" class="share-intel-footer-btn">Share Bear 📧</button>
        `;

        footerElements.forEach((container, index) => {
            container.innerHTML = footerHTML;
            logger.debug('SYSTEM', `Footer injected into container ${index + 1}`);
        });

        logger.componentLoad('SYSTEM', `Footer injected into ${footerElements.length} containers`);
    }

    injectBearIntelModal() {
        // Check if modal already exists
        if (document.getElementById('bear-intel-modal')) {
            logger.debug('SYSTEM', 'Bear Intel modal already exists - skipping injection');
            return;
        }

        const logoPath = window.pathUtils ? window.pathUtils.getLogoPath() : 'Rising_Star_Ryan_Head_Compressed.png';
        const eventBuilderPath = window.pathUtils
            ? window.pathUtils.resolvePath('testing/event-builder.html')
            : 'testing/event-builder.html';
        const modalHTML = `
            <div id="bear-intel-modal" class="bear-intel-modal" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3><img src="${logoPath}" alt="chunky.dad" class="modal-icon"> Share Bear Intel</h3>
                        <button class="modal-close" id="modal-close-btn">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form class="bear-intel-form">
                            <select required>
                                <option value="">What are you sharing?</option>
                                <option value="event">Bear Event</option>
                                <option value="business">Bear-Owned Business</option>
                                <option value="venue">Bar or Venue Info</option>
                                <option value="city">Suggest a New City 🌍</option>
                                <option value="other">Other Bear Intel</option>
                            </select>
                            <div class="bear-intel-event-option" id="event-builder-option" aria-hidden="true">
                                <p>Prefer to build the full event yourself?</p>
                                <a class="event-builder-link" href="${eventBuilderPath}" target="_blank" rel="noopener">Open Event Builder</a>
                            </div>
                            <textarea placeholder="Tell us about it! Include city, address, and any special details..." rows="4" required></textarea>
                            <button type="submit">Send Bear Intel <img src="${logoPath}" alt="chunky.dad" class="button-icon"></button>
                        </form>
                    </div>
                </div>
            </div>
        `;

        // Inject modal at the end of body
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        logger.componentLoad('SYSTEM', 'Bear Intel modal injected into page');
    }

    // Method to get the modal HTML for pages that need it before JS loads
    static getModalHTML() {
        const logoPath = window.pathUtils ? window.pathUtils.getLogoPath() : 'Rising_Star_Ryan_Head_Compressed.png';
        const eventBuilderPath = window.pathUtils
            ? window.pathUtils.resolvePath('testing/event-builder.html')
            : 'testing/event-builder.html';
        return `
            <div id="bear-intel-modal" class="bear-intel-modal" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3><img src="${logoPath}" alt="chunky.dad" class="modal-icon"> Share Bear Intel</h3>
                        <button class="modal-close" id="modal-close-btn">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form class="bear-intel-form">
                            <select required>
                                <option value="">What are you sharing?</option>
                                <option value="event">Bear Event</option>
                                <option value="business">Bear-Owned Business</option>
                                <option value="venue">Bar or Venue Info</option>
                                <option value="city">Suggest a New City 🌍</option>
                                <option value="other">Other Bear Intel</option>
                            </select>
                            <div class="bear-intel-event-option" id="event-builder-option" aria-hidden="true">
                                <p>Prefer to build the full event yourself?</p>
                                <a class="event-builder-link" href="${eventBuilderPath}" target="_blank" rel="noopener">Open Event Builder</a>
                            </div>
                            <textarea placeholder="Tell us about it! Include city, address, and any special details..." rows="4" required></textarea>
                            <button type="submit">Send Bear Intel <img src="${logoPath}" alt="chunky.dad" class="button-icon"></button>
                        </form>
                    </div>
                </div>
            </div>
        `;
    }


}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ComponentsManager;
} else {
    window.ComponentsManager = ComponentsManager;
}