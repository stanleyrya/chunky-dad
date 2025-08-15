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
        
        // View state management
        this.viewState = 'compact'; // 'compact', 'full', 'minimized'
        this.isMobile = window.innerWidth <= 480;
        
        // Breakpoint definitions matching the CSS
        this.breakpoints = {
            xs: { min: 0, max: 374, name: 'XS' },
            s: { min: 375, max: 767, name: 'S' },
            m: { min: 768, max: 1023, name: 'M' },
            l: { min: 1024, max: 1199, name: 'L' },
            xl: { min: 1200, max: Infinity, name: 'XL' }
        };
        
        // Enhanced error tracking for debugging
        this.errorHistory = [];
        this.maxErrorHistory = 50;
        this.setupErrorTracking();
        
        // Debug initialization logging
        logger.info('SYSTEM', 'Debug overlay constructor called', {
            shouldShow: this.isVisible,
            url: window.location.href,
            debugParam: new URLSearchParams(window.location.search).get('debug'),
            hasDebugParam: new URLSearchParams(window.location.search).has('debug')
        });
        
        if (this.isVisible) {
            this.init();
            logger.componentInit('SYSTEM', 'Debug overlay enabled - optimized version');
        } else {
            logger.info('SYSTEM', 'Debug overlay not enabled - debug parameter not found');
        }
    }
    
    shouldShowDebug() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('debug') === 'true' || urlParams.has('debug');
    }
    
    setupErrorTracking() {
        // Track all errors with detailed context
        const originalConsoleError = console.error;
        const self = this;
        
        console.error = function(...args) {
            // Call original console.error
            originalConsoleError.apply(console, args);
            
            // Track error in debug overlay
            self.trackError('console.error', args);
        };
        
        // Enhanced window error tracking
        window.addEventListener('error', (event) => {
            this.trackError('window.error', {
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                error: event.error,
                stack: event.error?.stack,
                timestamp: new Date().toISOString(),
                type: 'script-error'
            });
        });
        
        // Enhanced promise rejection tracking
        window.addEventListener('unhandledrejection', (event) => {
            this.trackError('unhandled-rejection', {
                reason: event.reason,
                message: event.reason?.message,
                stack: event.reason?.stack,
                timestamp: new Date().toISOString(),
                type: 'promise-rejection'
            });
        });
    }
    
    trackError(source, errorData) {
        const errorEntry = {
            id: Date.now() + Math.random(),
            source,
            data: errorData,
            timestamp: new Date().toISOString(),
            url: window.location.href
        };
        
        this.errorHistory.unshift(errorEntry);
        
        // Keep only recent errors
        if (this.errorHistory.length > this.maxErrorHistory) {
            this.errorHistory = this.errorHistory.slice(0, this.maxErrorHistory);
        }
        
        // Update error panel if visible
        this.updateErrorPanel();
    }
    
    addErrorTrackingPanel() {
        const errorPanel = document.createElement('div');
        errorPanel.id = 'debug-error-panel';
        errorPanel.innerHTML = `
            <div class="debug-section">
                <h3>🚨 Error Tracking</h3>
                <div class="debug-controls">
                    <button onclick="debugOverlay.clearErrorHistory()">Clear Errors</button>
                    <button onclick="debugOverlay.exportErrorHistory()">Export Errors</button>
                    <span class="error-count">Errors: <span id="error-count">0</span></span>
                </div>
                <div id="error-list" class="error-list"></div>
            </div>
        `;
        
        this.overlay.appendChild(errorPanel);
        this.updateErrorPanel();
    }
    
    updateErrorPanel() {
        const errorCountElement = document.getElementById('error-count');
        const errorListElement = document.getElementById('error-list');
        
        if (!errorCountElement || !errorListElement) return;
        
        errorCountElement.textContent = this.errorHistory.length;
        
        if (this.errorHistory.length === 0) {
            errorListElement.innerHTML = '<div class="no-errors">✅ No errors detected</div>';
            return;
        }
        
        const errorHtml = this.errorHistory.slice(0, 10).map(error => {
            const isScriptError = error.data?.message === 'Script error.' || error.data?.type === 'script-error';
            const isCorsError = error.data?.message?.includes('CORS') || error.data?.message?.includes('cross-origin');
            const isNetworkError = error.data?.message?.includes('fetch') || error.data?.message?.includes('network');
            
            let errorType = 'Unknown';
            let errorClass = 'error-unknown';
            
            if (isScriptError) {
                errorType = 'Script Error';
                errorClass = 'error-script';
            } else if (isCorsError) {
                errorType = 'CORS Error';
                errorClass = 'error-cors';
            } else if (isNetworkError) {
                errorType = 'Network Error';
                errorClass = 'error-network';
            }
            
            return `
                <div class="error-entry ${errorClass}">
                    <div class="error-header">
                        <span class="error-type">${errorType}</span>
                        <span class="error-time">${new Date(error.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div class="error-message">${error.data?.message || 'No message'}</div>
                    <div class="error-details">
                        <small>Source: ${error.source} | File: ${error.data?.filename || 'Unknown'}</small>
                    </div>
                </div>
            `;
        }).join('');
        
        errorListElement.innerHTML = errorHtml;
    }
    
    clearErrorHistory() {
        this.errorHistory = [];
        this.updateErrorPanel();
        logger.info('SYSTEM', 'Debug overlay error history cleared');
    }
    
    exportErrorHistory() {
        const exportData = {
            timestamp: new Date().toISOString(),
            url: window.location.href,
            userAgent: navigator.userAgent,
            errorCount: this.errorHistory.length,
            errors: this.errorHistory
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chunky-dad-errors-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        logger.info('SYSTEM', 'Error history exported', {errorCount: this.errorHistory.length});
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
        
        // Start in compact mode on mobile, full mode on desktop
        this.viewState = this.isMobile ? 'compact' : 'full';
        
        this.overlay.innerHTML = `
            <div class="debug-header">
                <span class="debug-title"><img src="Rising_Star_Ryan_Head_Compressed.png" alt="chunky.dad" class="debug-icon"> DEBUG</span>
                <div class="debug-header-controls">
                    <button class="debug-toggle" aria-label="Toggle debug view" title="Toggle view">⌃</button>
                    <button class="debug-minimize" aria-label="Minimize debug overlay" title="Minimize">-</button>
                    <button class="debug-close" aria-label="Close debug overlay" title="Close">×</button>
                </div>
            </div>
            <div class="debug-content">
                <!-- Essential info (always visible in compact mode) -->
                <div class="debug-info debug-essential">
                    <div class="debug-row debug-compact-row">
                        <span class="debug-label">Size:</span>
                        <span class="debug-value" id="debug-screen-size">-</span>
                        <span class="debug-label">BP:</span>
                        <span class="debug-value" id="debug-breakpoint">-</span>
                    </div>
                </div>
                
                <!-- Extended info (hidden in compact mode) -->
                <div class="debug-info debug-extended">
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
                        <span class="debug-label">Zoom:</span>
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
                
                <!-- Controls (hidden in compact mode) -->
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
        
        // Set initial view state
        this.updateViewState();
        
        document.body.appendChild(this.overlay);
        
        // Add error tracking panel after overlay is created
        this.addErrorTrackingPanel();
        
        this.updateDebugInfo();
        
        logger.info('SYSTEM', 'Debug overlay DOM created and attached', {
            overlayExists: !!this.overlay,
            overlayVisible: this.overlay.style.display !== 'none',
            overlayParent: this.overlay.parentNode?.tagName
        });
    }
    
    attachEventListeners() {
        // Header control buttons
        const closeBtn = this.overlay.querySelector('.debug-close');
        const toggleBtn = this.overlay.querySelector('.debug-toggle');
        const minimizeBtn = this.overlay.querySelector('.debug-minimize');
        
        closeBtn.addEventListener('click', () => this.hide());
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent drag start
            this.toggleView();
        });
        minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent drag start
            this.minimizeToggle();
        });
        
        // Make draggable (but not on control buttons)
        const header = this.overlay.querySelector('.debug-header');
        header.addEventListener('mousedown', (e) => {
            if (!e.target.matches('.debug-close, .debug-toggle, .debug-minimize')) {
                this.startDrag(e);
            }
        });
        header.addEventListener('touchstart', (e) => {
            if (!e.target.matches('.debug-close, .debug-toggle, .debug-minimize')) {
                this.startDrag(e.touches[0]);
            }
        });
        
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
        
        // Handle window resize to update mobile state
        window.addEventListener('resize', () => {
            const wasMobile = this.isMobile;
            this.isMobile = window.innerWidth <= 480;
            
            // If switching between mobile/desktop, adjust view if needed
            if (wasMobile !== this.isMobile && this.viewState === 'compact') {
                // Auto-expand to full view on desktop if currently compact
                if (!this.isMobile) {
                    this.viewState = 'full';
                    this.updateViewState();
                }
            }
        });
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
                logger.info('SYSTEM', '🔍 DEBUG_OVERLAY: Getting character calculation data from calendar loader');
                
                // Use cached values from calendar loader - DON'T re-calculate
                const charsPerPixel = window.calendarLoader.charsPerPixel; // Use cached value only
                const availableWidth = window.calendarLoader.cachedEventTextWidth; // Use cached value only
                
                if (charsPerPixel && availableWidth) {
                    const charLimitPerLine = Math.floor(availableWidth * charsPerPixel);
                    
                    charLimitInfo = charLimitPerLine.toString();
                    eventWidthInfo = `${availableWidth.toFixed(0)}px`;
                    
                    logger.info('SYSTEM', '🔍 DEBUG_OVERLAY: Using cached calculation data', {
                        charsPerPixel: charsPerPixel.toFixed(4),
                        availableWidth: availableWidth.toFixed(2),
                        charLimitPerLine,
                        source: 'cached_values'
                    });
                } else {
                    logger.warn('SYSTEM', '🔍 DEBUG_OVERLAY: Calendar loader measurements not ready yet', {
                        hasCharsPerPixel: !!charsPerPixel,
                        hasCachedWidth: !!availableWidth
                    });
                    charLimitInfo = 'Measuring...';
                    eventWidthInfo = 'Measuring...';
                }
            } catch (e) {
                logger.warn('SYSTEM', '🔍 DEBUG_OVERLAY: Error accessing calendar loader data', e);
                charLimitInfo = 'Error';
                eventWidthInfo = 'Error';
            }
        } else {
            logger.debug('SYSTEM', '🔍 DEBUG_OVERLAY: Calendar loader not available');
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
        
        // Get zoom level info using simple visual viewport detection
        let zoomInfo = '100%';
        try {
            const visualZoom = (window.visualViewport && window.visualViewport.scale) || 1;
            zoomInfo = `${(visualZoom * 100).toFixed(0)}%`;
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
    
    // View state management methods
    updateViewState() {
        if (!this.overlay) return;
        
        // Remove all state classes
        this.overlay.classList.remove('debug-compact', 'debug-full', 'debug-minimized');
        
        // Add current state class
        this.overlay.classList.add(`debug-${this.viewState}`);
        
        // Update toggle button icon
        const toggleBtn = this.overlay.querySelector('.debug-toggle');
        if (toggleBtn) {
            switch (this.viewState) {
                case 'compact':
                    toggleBtn.textContent = '⌃';
                    toggleBtn.title = 'Expand to full view';
                    break;
                case 'full':
                    toggleBtn.textContent = '⌄';
                    toggleBtn.title = 'Collapse to compact view';
                    break;
                case 'minimized':
                    toggleBtn.textContent = '⌃';
                    toggleBtn.title = 'Expand debug overlay';
                    break;
            }
        }
        
        // Update minimize button
        const minimizeBtn = this.overlay.querySelector('.debug-minimize');
        if (minimizeBtn) {
            if (this.viewState === 'minimized') {
                minimizeBtn.textContent = '+';
                minimizeBtn.title = 'Restore debug overlay';
            } else {
                minimizeBtn.textContent = '-';
                minimizeBtn.title = 'Minimize debug overlay';
            }
        }
        
        logger.userInteraction('SYSTEM', `Debug overlay view changed to: ${this.viewState}`);
    }
    
    toggleView() {
        if (this.viewState === 'minimized') {
            // If minimized, restore to previous state (compact on mobile, full on desktop)
            this.viewState = this.isMobile ? 'compact' : 'full';
        } else if (this.viewState === 'compact') {
            this.viewState = 'full';
        } else {
            this.viewState = 'compact';
        }
        
        this.updateViewState();
    }
    
    minimizeToggle() {
        if (this.viewState === 'minimized') {
            // Restore to previous state
            this.viewState = this.isMobile ? 'compact' : 'full';
        } else {
            this.viewState = 'minimized';
        }
        
        this.updateViewState();
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