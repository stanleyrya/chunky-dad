// Debug Overlay System for chunky.dad
// Shows screen size, breakpoints, and other useful debugging information
// Activated by adding ?debug=true to any URL

class DebugOverlay {
    constructor() {
        this.isVisible = this.shouldShowDebug();
        this.overlay = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.position = { x: 20, y: 20 }; // Default position
        this.updateInterval = null;
        
        // Breakpoint definitions matching the CSS
        this.breakpoints = {
            xs: { min: 0, max: 374, name: 'XS' },
            s: { min: 375, max: 767, name: 'S' },
            m: { min: 768, max: 1023, name: 'M' },
            l: { min: 1024, max: 1199, name: 'L' },
            xl: { min: 1200, max: Infinity, name: 'XL' }
        };
        
        if (this.isVisible) {
            this.init();
            logger.componentInit('SYSTEM', 'Debug overlay enabled');
        }
    }
    
    shouldShowDebug() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('debug') === 'true' || urlParams.has('debug');
    }
    
    init() {
        this.createOverlay();
        this.attachEventListeners();
        this.startUpdating();
        logger.componentLoad('SYSTEM', 'Debug overlay initialized');
    }
    
    createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'debug-overlay';
        this.overlay.innerHTML = `
            <div class="debug-header">
                <span class="debug-title">🐻 DEBUG</span>
                <button class="debug-close" aria-label="Close debug overlay">×</button>
            </div>
            <div class="debug-content">
                <div class="debug-info">
                    <div class="debug-row">
                        <span class="debug-label">Screen:</span>
                        <span class="debug-value" id="debug-screen-size">-</span>
                    </div>
                    <div class="debug-row">
                        <span class="debug-label">Breakpoint:</span>
                        <span class="debug-value" id="debug-breakpoint">-</span>
                    </div>
                    <div class="debug-row">
                        <span class="debug-label">Viewport:</span>
                        <span class="debug-value" id="debug-viewport">-</span>
                    </div>
                    <div class="debug-row">
                        <span class="debug-label">Page:</span>
                        <span class="debug-value" id="debug-page-type">-</span>
                    </div>
                    <div class="debug-row">
                        <span class="debug-label">URL:</span>
                        <span class="debug-value" id="debug-url">-</span>
                    </div>
                </div>
            </div>
        `;
        
        // Apply initial position
        this.overlay.style.left = `${this.position.x}px`;
        this.overlay.style.top = `${this.position.y}px`;
        
        document.body.appendChild(this.overlay);
        this.updateDebugInfo();
    }
    
    attachEventListeners() {
        // Close button
        const closeBtn = this.overlay.querySelector('.debug-close');
        closeBtn.addEventListener('click', () => this.hide());
        
        // Make draggable
        const header = this.overlay.querySelector('.debug-header');
        header.addEventListener('mousedown', (e) => this.startDrag(e));
        header.addEventListener('touchstart', (e) => this.startDrag(e.touches[0]));
        
        document.addEventListener('mousemove', (e) => this.drag(e));
        document.addEventListener('touchmove', (e) => this.drag(e.touches[0]));
        
        document.addEventListener('mouseup', () => this.endDrag());
        document.addEventListener('touchend', () => this.endDrag());
        
        // Window resize listener
        window.addEventListener('resize', () => this.updateDebugInfo());
        
        // URL change listener (for SPAs)
        window.addEventListener('popstate', () => this.updateDebugInfo());
    }
    
    startDrag(e) {
        this.isDragging = true;
        const rect = this.overlay.getBoundingClientRect();
        this.dragOffset.x = e.clientX - rect.left;
        this.dragOffset.y = e.clientY - rect.top;
        
        this.overlay.style.cursor = 'grabbing';
        this.overlay.style.userSelect = 'none';
        
        logger.userInteraction('SYSTEM', 'Debug overlay drag started');
    }
    
    drag(e) {
        if (!this.isDragging) return;
        
        e.preventDefault();
        
        let newX = e.clientX - this.dragOffset.x;
        let newY = e.clientY - this.dragOffset.y;
        
        // Keep within viewport bounds
        const maxX = window.innerWidth - this.overlay.offsetWidth;
        const maxY = window.innerHeight - this.overlay.offsetHeight;
        
        newX = Math.max(0, Math.min(newX, maxX));
        newY = Math.max(0, Math.min(newY, maxY));
        
        this.position.x = newX;
        this.position.y = newY;
        
        this.overlay.style.left = `${newX}px`;
        this.overlay.style.top = `${newY}px`;
    }
    
    endDrag() {
        if (!this.isDragging) return;
        
        this.isDragging = false;
        this.overlay.style.cursor = 'grab';
        this.overlay.style.userSelect = 'auto';
        
        logger.userInteraction('SYSTEM', 'Debug overlay drag ended', {
            position: this.position
        });
    }
    
    getCurrentBreakpoint() {
        const width = window.innerWidth;
        
        for (const [key, bp] of Object.entries(this.breakpoints)) {
            if (width >= bp.min && width <= bp.max) {
                return { key, ...bp };
            }
        }
        
        return { key: 'unknown', name: 'Unknown', min: 0, max: 0 };
    }
    
    getPageType() {
        const path = window.location.pathname;
        
        if (path.includes('city.html')) return 'City Guide';
        if (path.includes('bear-directory.html')) return 'Bear Directory';
        if (path.includes('test-')) return 'Test Page';
        if (path === '/' || path.includes('index.html')) return 'Home';
        
        return 'Unknown';
    }
    
    updateDebugInfo() {
        if (!this.overlay) return;
        
        const screenSize = document.getElementById('debug-screen-size');
        const breakpoint = document.getElementById('debug-breakpoint');
        const viewport = document.getElementById('debug-viewport');
        const pageType = document.getElementById('debug-page-type');
        const url = document.getElementById('debug-url');
        
        const currentBreakpoint = this.getCurrentBreakpoint();
        const currentPageType = this.getPageType();
        
        if (screenSize) {
            screenSize.textContent = `${window.innerWidth} × ${window.innerHeight}`;
        }
        
        if (breakpoint) {
            breakpoint.textContent = `${currentBreakpoint.name} (${currentBreakpoint.key})`;
            breakpoint.className = `debug-value debug-breakpoint-${currentBreakpoint.key.toLowerCase()}`;
        }
        
        if (viewport) {
            viewport.textContent = `${window.screen.width} × ${window.screen.height}`;
        }
        
        if (pageType) {
            pageType.textContent = currentPageType;
        }
        
        if (url) {
            const shortUrl = window.location.pathname + window.location.search;
            url.textContent = shortUrl.length > 25 ? shortUrl.substring(0, 25) + '...' : shortUrl;
            url.title = window.location.href; // Full URL on hover
        }
        
        logger.debug('SYSTEM', 'Debug overlay updated', {
            screenSize: `${window.innerWidth}×${window.innerHeight}`,
            breakpoint: currentBreakpoint.key,
            pageType: currentPageType
        });
    }
    
    startUpdating() {
        // Update every 500ms to catch dynamic changes
        this.updateInterval = setInterval(() => {
            this.updateDebugInfo();
        }, 500);
    }
    
    stopUpdating() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }
    
    show() {
        if (this.overlay) {
            this.overlay.style.display = 'block';
            this.startUpdating();
            logger.componentLoad('SYSTEM', 'Debug overlay shown');
        }
    }
    
    hide() {
        if (this.overlay) {
            this.overlay.style.display = 'none';
            this.stopUpdating();
            logger.componentLoad('SYSTEM', 'Debug overlay hidden');
        }
    }
    
    toggle() {
        if (this.overlay) {
            const isVisible = this.overlay.style.display !== 'none';
            if (isVisible) {
                this.hide();
            } else {
                this.show();
            }
        }
    }
    
    destroy() {
        this.stopUpdating();
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
        logger.componentLoad('SYSTEM', 'Debug overlay destroyed');
    }
}

// Create global debug overlay instance if debug mode is enabled
let debugOverlay = null;

function initializeDebugOverlay() {
    const urlParams = new URLSearchParams(window.location.search);
    const shouldShow = urlParams.get('debug') === 'true' || urlParams.has('debug');
    
    if (shouldShow && !debugOverlay) {
        debugOverlay = new DebugOverlay();
        window.debugOverlay = debugOverlay; // Make globally accessible
        logger.componentInit('SYSTEM', 'Debug overlay initialized from URL parameter');
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDebugOverlay);
} else {
    initializeDebugOverlay();
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DebugOverlay;
} else {
    window.DebugOverlay = DebugOverlay;
}