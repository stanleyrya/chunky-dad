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
        this.lastUpdateData = {}; // Cache to prevent unnecessary updates
        this.logUpdateFrequency = 5000; // Only log updates every 5 seconds
        this.lastLogTime = 0;
        
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
            logger.componentInit('SYSTEM', 'Debug overlay enabled - optimized version');
        }
    }
    
    shouldShowDebug() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('debug') === 'true' || urlParams.has('debug');
    }
    
    init() {
        this.createOverlay();
        this.attachEventListeners();
        this.startEventDrivenUpdates(); // Use event-driven updates instead of polling
        logger.componentLoad('SYSTEM', 'Debug overlay initialized with smart updates');
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
                    <div class="debug-row">
                        <span class="debug-label">Chars/Line:</span>
                        <span class="debug-value" id="debug-char-limit">-</span>
                    </div>
                    <div class="debug-row">
                        <span class="debug-label">Event Width:</span>
                        <span class="debug-value" id="debug-event-width">-</span>
                    </div>
                    <div class="debug-row">
                        <span class="debug-label">Zoom Level:</span>
                        <span class="debug-value" id="debug-zoom-level">-</span>
                    </div>
                    <div class="debug-row">
                        <span class="debug-label">Performance:</span>
                        <span class="debug-value" id="debug-performance">-</span>
                    </div>
                    <div class="debug-row">
                        <span class="debug-label">Network:</span>
                        <span class="debug-value" id="debug-network">-</span>
                    </div>
                    <div class="debug-row">
                        <span class="debug-label">Memory:</span>
                        <span class="debug-value" id="debug-memory">-</span>
                    </div>
                </div>
                <div class="debug-controls">
                    <button id="debug-clear-console" class="debug-btn">Clear Console</button>
                    <button id="debug-export-logs" class="debug-btn">Export Logs</button>
                    <button id="debug-toggle-updates" class="debug-btn">Pause Updates</button>
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
        document.addEventListener('touchmove', (e) => {
            if (this.isDragging) {
                e.preventDefault(); // Prevent scrolling while dragging
                this.drag(e.touches[0]);
            }
        }, { passive: false });
        
        document.addEventListener('mouseup', () => this.endDrag());
        document.addEventListener('touchend', () => this.endDrag());
        
        // Control buttons
        const clearConsoleBtn = this.overlay.querySelector('#debug-clear-console');
        const exportLogsBtn = this.overlay.querySelector('#debug-export-logs');
        const toggleUpdatesBtn = this.overlay.querySelector('#debug-toggle-updates');
        
        if (clearConsoleBtn) {
            clearConsoleBtn.addEventListener('click', () => {
                console.clear();
                logger.info('SYSTEM', 'Console cleared via debug overlay');
            });
        }
        
        if (exportLogsBtn) {
            exportLogsBtn.addEventListener('click', () => this.exportDebugInfo());
        }
        
        if (toggleUpdatesBtn) {
            toggleUpdatesBtn.addEventListener('click', () => this.toggleUpdates());
        }
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
        
        // Only call preventDefault if it's available (Event object, not Touch object)
        if (e.preventDefault && typeof e.preventDefault === 'function') {
            e.preventDefault();
        }
        
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
    
    updateDebugInfo(shouldLog = true) {
        if (!this.overlay) return;
        
        const screenSize = document.getElementById('debug-screen-size');
        const breakpoint = document.getElementById('debug-breakpoint');
        const viewport = document.getElementById('debug-viewport');
        const pageType = document.getElementById('debug-page-type');
        const url = document.getElementById('debug-url');
        const charLimit = document.getElementById('debug-char-limit');
        const eventWidth = document.getElementById('debug-event-width');
        const zoomLevel = document.getElementById('debug-zoom-level');
        const performance = document.getElementById('debug-performance');
        const network = document.getElementById('debug-network');
        const memory = document.getElementById('debug-memory');
        
        const currentBreakpoint = this.getCurrentBreakpoint();
        const currentPageType = this.getPageType();
        
        // Get character limit info from calendar loader if available
        let charLimitInfo = '-';
        let eventWidthInfo = '-';
        if (window.calendarLoader) {
            try {
                const charsPerPixel = window.calendarLoader.charsPerPixel || window.calendarLoader.calculateCharsPerPixel();
                const availableWidth = window.calendarLoader.getEventTextWidth();
                const charLimitPerLine = Math.floor(availableWidth * charsPerPixel);
                
                charLimitInfo = charLimitPerLine.toString();
                eventWidthInfo = `${availableWidth.toFixed(0)}px`;
            } catch (e) {
                // Ignore errors if calendar loader methods aren't available
            }
        }
        
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
        
        if (charLimit) {
            charLimit.textContent = charLimitInfo;
        }
        
        if (eventWidth) {
            eventWidth.textContent = eventWidthInfo;
        }
        
        // Get zoom level info
        let zoomInfo = '100%';
        try {
            // Try Visual Viewport API first (mobile pinch zoom)
            if (window.visualViewport && window.visualViewport.scale !== undefined && window.visualViewport.scale !== 1) {
                zoomInfo = `${(window.visualViewport.scale * 100).toFixed(0)}% (pinch)`;
            } else if (window.devicePixelRatio) {
                // Use devicePixelRatio for browser zoom detection
                const baseRatio = window.screen && window.screen.width ? 
                    Math.round(window.screen.width / window.innerWidth * 100) / 100 : 1;
                if (Math.abs(window.devicePixelRatio - baseRatio) > 0.1) {
                    zoomInfo = `${Math.round(window.devicePixelRatio * 100)}% (browser)`;
                }
            }
        } catch (e) {
            // Fallback if zoom detection fails
            zoomInfo = 'Unknown';
        }
        
        if (zoomLevel) {
            zoomLevel.textContent = zoomInfo;
        }
        
        // Performance information
        let performanceInfo = '-';
        try {
            if (performance.now) {
                const timing = performance.timing;
                if (timing && timing.loadEventEnd && timing.navigationStart) {
                    const loadTime = timing.loadEventEnd - timing.navigationStart;
                    performanceInfo = loadTime > 0 ? `${loadTime}ms load` : 'Loading...';
                }
            }
        } catch (e) {
            performanceInfo = 'Unavailable';
        }
        
        if (performance) {
            performance.textContent = performanceInfo;
        }
        
        // Network information
        let networkInfo = '-';
        try {
            if (navigator.connection) {
                const conn = navigator.connection;
                const speed = conn.effectiveType || conn.type || 'unknown';
                const downlink = conn.downlink ? `${conn.downlink}Mbps` : '';
                networkInfo = downlink ? `${speed} (${downlink})` : speed;
            } else if (navigator.onLine !== undefined) {
                networkInfo = navigator.onLine ? 'Online' : 'Offline';
            }
        } catch (e) {
            networkInfo = 'Unknown';
        }
        
        if (network) {
            network.textContent = networkInfo;
        }
        
        // Memory information
        let memoryInfo = '-';
        try {
            if (performance.memory) {
                const mem = performance.memory;
                const used = Math.round(mem.usedJSHeapSize / 1024 / 1024);
                const total = Math.round(mem.totalJSHeapSize / 1024 / 1024);
                memoryInfo = `${used}/${total}MB`;
            }
        } catch (e) {
            memoryInfo = 'Unavailable';
        }
        
        if (memory) {
            memory.textContent = memoryInfo;
        }
        
        // Smart logging - only log when data changes and respect frequency limits
        const currentData = {
            screenSize: `${window.innerWidth}×${window.innerHeight}`,
            breakpoint: currentBreakpoint.key,
            pageType: currentPageType,
            zoomInfo: zoomInfo
        };
        
        const hasDataChanged = JSON.stringify(currentData) !== JSON.stringify(this.lastUpdateData);
        const now = Date.now();
        const shouldLogFrequency = (now - this.lastLogTime) >= this.logUpdateFrequency;
        
        if (shouldLog && (hasDataChanged || shouldLogFrequency)) {
            const logMessage = hasDataChanged ? 'Debug overlay updated - data changed' : 'Debug overlay periodic update';
            logger.debug('SYSTEM', logMessage, {
                ...currentData,
                changed: hasDataChanged,
                timeSinceLastLog: `${((now - this.lastLogTime) / 1000).toFixed(1)}s`
            });
            this.lastLogTime = now;
        }
        
        this.lastUpdateData = currentData;
    }
    
    startEventDrivenUpdates() {
        // Initial update
        this.updateDebugInfo();
        
        // Event-driven updates for better performance
        window.addEventListener('resize', () => this.debounceUpdate());
        window.addEventListener('orientationchange', () => this.debounceUpdate());
        
        // Listen for visual viewport changes (mobile zoom)
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => this.debounceUpdate());
            window.visualViewport.addEventListener('scroll', () => this.debounceUpdate());
        }
        
        // Listen for navigation changes
        window.addEventListener('popstate', () => this.debounceUpdate());
        
        // Listen for calendar updates if available
        document.addEventListener('calendarUpdated', () => this.debounceUpdate());
        
        // Fallback polling at much lower frequency (every 10 seconds) for edge cases
        this.updateInterval = setInterval(() => {
            this.updateDebugInfo(false); // Don't log frequent fallback updates
        }, 10000);
        
        logger.info('SYSTEM', 'Debug overlay using smart event-driven updates', {
            events: ['resize', 'orientationchange', 'visualViewport', 'popstate', 'calendarUpdated'],
            fallbackInterval: '10s'
        });
    }
    
    debounceUpdate() {
        // Debounce rapid updates (like during resize)
        clearTimeout(this.debounceTimeout);
        this.debounceTimeout = setTimeout(() => {
            this.updateDebugInfo(true);
        }, 100);
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
            this.startEventDrivenUpdates(); // Use event-driven updates instead of polling
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
    
    // Utility methods for control buttons
    exportDebugInfo() {
        const debugData = {
            timestamp: new Date().toISOString(),
            url: window.location.href,
            userAgent: navigator.userAgent,
            screenSize: `${window.innerWidth}×${window.innerHeight}`,
            viewport: `${window.screen.width}×${window.screen.height}`,
            breakpoint: this.getCurrentBreakpoint(),
            pageType: this.getPageType(),
            performance: window.performance ? {
                timing: window.performance.timing,
                memory: window.performance.memory,
                navigation: window.performance.navigation
            } : 'Not available',
            network: navigator.connection ? {
                effectiveType: navigator.connection.effectiveType,
                downlink: navigator.connection.downlink,
                rtt: navigator.connection.rtt
            } : 'Not available'
        };
        
        const dataStr = JSON.stringify(debugData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `debug-info-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        logger.info('SYSTEM', 'Debug information exported', { filename: a.download });
    }
    
    toggleUpdates() {
        const btn = document.getElementById('debug-toggle-updates');
        if (!btn) return;
        
        if (this.updateInterval) {
            // Pause updates
            clearInterval(this.updateInterval);
            this.updateInterval = null;
            btn.textContent = 'Resume Updates';
            btn.style.backgroundColor = '#f44336';
            logger.info('SYSTEM', 'Debug overlay updates paused');
        } else {
            // Resume updates
            this.updateInterval = setInterval(() => {
                this.updateDebugInfo(false);
            }, 10000);
            btn.textContent = 'Pause Updates';
            btn.style.backgroundColor = '';
            logger.info('SYSTEM', 'Debug overlay updates resumed');
        }
    }
}

// Create global debug overlay instance if debug mode is enabled
let debugOverlay = null;

function initializeDebugOverlay() {
    // Prevent double initialization
    if (debugOverlay) {
        logger.debug('SYSTEM', 'Debug overlay already initialized, skipping');
        return;
    }
    
    const urlParams = new URLSearchParams(window.location.search);
    const shouldShow = urlParams.get('debug') === 'true' || urlParams.has('debug');
    
    if (shouldShow) {
        debugOverlay = new DebugOverlay();
        window.debugOverlay = debugOverlay; // Make globally accessible
        logger.componentInit('SYSTEM', 'Debug overlay initialized from URL parameter');
    }
}

// NOTE: Automatic initialization removed to prevent duplication with app.js
// The debug overlay is now only initialized through app.js to avoid double creation

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DebugOverlay;
} else {
    window.DebugOverlay = DebugOverlay;
}