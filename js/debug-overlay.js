// Enhanced Debug Overlay System for chunky.dad
// Modern, mobile-optimized debugging tool with improved UI and functionality
// Activated by adding ?debug=true to any URL

class DebugOverlay {
    constructor() {
        // Safe localStorage wrapper for private mode compatibility
        this.safeStorage = {
            getItem: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
            setItem: (key, value) => { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
            removeItem: (key) => { try { localStorage.removeItem(key); } catch { /* ignore */ } }
        };
        
        this.isVisible = this.shouldShowDebug();
        this.overlay = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.position = this.loadPosition() || { x: 20, y: 20 };
        this.updateInterval = null;
        this.lastUpdateData = {};
        
        // Enhanced view state management
        this.viewState = this.safeStorage.getItem('debug-view-state') || 'compact';
        this.isMobile = window.innerWidth <= 480;
        
        // Enhanced breakpoint definitions
        this.breakpoints = {
            xs: { min: 0, max: 374, name: 'XS', color: '#ff4444' },
            s: { min: 375, max: 767, name: 'S', color: '#ff8800' },
            m: { min: 768, max: 1023, name: 'M', color: '#ffdd00' },
            l: { min: 1024, max: 1199, name: 'L', color: '#88ff00' },
            xl: { min: 1200, max: Infinity, name: 'XL', color: '#00ff88' }
        };
        
        // Enhanced debugging features
        this.performanceMetrics = {
            pageLoadTime: performance.now(),
            resourceTiming: [],
            userInteractions: 0,
            errors: []
        };
        
        this.setupErrorTracking();
        this.setupPerformanceTracking();
        
        if (this.isVisible) {
            this.init();
            logger.componentInit('SYSTEM', 'Enhanced debug overlay initialized');
        }
    }
    
    shouldShowDebug() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.has('debug') || this.safeStorage.getItem('debug-enabled') === 'true';
    }
    
    init() {
        logger.debug('SYSTEM', 'Debug overlay initializing...');
        this.createOverlay();
        this.setupEventListeners();
        this.startUpdateLoop();
        
        // Enhanced mobile touch handling
        if (this.isMobile) {
            this.setupMobileOptimizations();
        }
        
        logger.info('SYSTEM', 'Debug overlay initialization complete', {
            isVisible: this.isVisible,
            viewState: this.viewState,
            isMobile: this.isMobile
        });
    }
    
    createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.className = `debug-overlay debug-${this.viewState}`;
        this.overlay.style.left = `${this.position.x}px`;
        this.overlay.style.top = `${this.position.y}px`;
        
        this.overlay.innerHTML = `
            <div class="debug-header">
                <div class="debug-title">🐻 Debug Panel</div>
                <div class="debug-header-controls">
                    <button class="debug-minimize" title="Minimize">−</button>
                    <button class="debug-toggle" title="Toggle View">⚙</button>
                    <button class="debug-close" title="Close">×</button>
                </div>
            </div>
            <div class="debug-content">
                <div class="debug-info">
                    <div class="debug-essential">
                        <div class="debug-compact-row">
                            <span class="debug-label">Screen:</span>
                            <span class="debug-value" id="debug-screen">-</span>
                            <span class="debug-label">BP:</span>
                            <span class="debug-value debug-breakpoint" id="debug-breakpoint">-</span>
                        </div>
                        <div class="debug-compact-row">
                            <span class="debug-label">Scroll:</span>
                            <span class="debug-value" id="debug-scroll">-</span>
                            <span class="debug-label">Perf:</span>
                            <span class="debug-value" id="debug-perf">-</span>
                        </div>
                    </div>
                    
                    <div class="debug-extended">
                        <div class="debug-row">
                            <span class="debug-label">URL:</span>
                            <span class="debug-value" id="debug-url">-</span>
                        </div>
                        <div class="debug-row">
                            <span class="debug-label">User Agent:</span>
                            <span class="debug-value" id="debug-ua">-</span>
                        </div>
                        <div class="debug-row">
                            <span class="debug-label">Errors:</span>
                            <span class="debug-value" id="debug-errors">0</span>
                        </div>
                        <div class="debug-row">
                            <span class="debug-label">Interactions:</span>
                            <span class="debug-value" id="debug-interactions">0</span>
                        </div>
                        <div class="debug-row">
                            <span class="debug-label">Memory:</span>
                            <span class="debug-value" id="debug-memory">-</span>
                        </div>
                    </div>
                </div>
                
                <div class="debug-controls">
                    <button class="debug-btn" id="debug-clear-console">Clear Console</button>
                    <button class="debug-btn" id="debug-export-logs">Export Logs</button>
                    <button class="debug-btn" id="debug-toggle-persistence">Toggle Persistence</button>
                    <button class="debug-btn" id="debug-network-info">Network Info</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(this.overlay);
    }
    
    setupEventListeners() {
        const header = this.overlay.querySelector('.debug-header');
        const closeBtn = this.overlay.querySelector('.debug-close');
        const toggleBtn = this.overlay.querySelector('.debug-toggle');
        const minimizeBtn = this.overlay.querySelector('.debug-minimize');
        
        // Enhanced drag functionality
        header.addEventListener('mousedown', this.startDrag.bind(this));
        header.addEventListener('touchstart', this.startDrag.bind(this), { passive: false });
        
        // Double-click header to expand from minimized state
        header.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.viewState === 'minimized') {
                this.expand();
            }
        });
        
        // Control buttons with improved event handling
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.hide();
        });
        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleView();
        });
        minimizeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.minimize();
        });
        
        // Global events
        document.addEventListener('mousemove', this.handleDrag.bind(this));
        document.addEventListener('touchmove', this.handleDrag.bind(this), { passive: false });
        document.addEventListener('mouseup', this.stopDrag.bind(this));
        document.addEventListener('touchend', this.stopDrag.bind(this));
        
        // Enhanced window events
        window.addEventListener('resize', () => {
            this.isMobile = window.innerWidth <= 480;
            this.updateInfo();
        });
        
        // Track user interactions
        document.addEventListener('click', () => {
            this.performanceMetrics.userInteractions++;
        });
        
        // Debug control buttons
        this.setupDebugControlButtons();
    }
    
    setupDebugControlButtons() {
        // Set up event listeners for debug control buttons
        const buttons = [
            { id: 'debug-clear-console', method: 'clearConsole' },
            { id: 'debug-export-logs', method: 'exportLogs' },
            { id: 'debug-toggle-persistence', method: 'togglePersistence' },
            { id: 'debug-network-info', method: 'showNetworkInfo' }
        ];
        
        // Add small delay to ensure DOM is fully ready
        setTimeout(() => {
            buttons.forEach(({ id, method }) => {
                const button = this.overlay.querySelector(`#${id}`);
                if (button) {
                    // Ensure button is clickable
                    button.style.pointerEvents = 'auto';
                    button.style.cursor = 'pointer';
                    
                    button.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                            console.log(`Debug button clicked: ${method}`); // Add console log for immediate feedback
                            this[method]();
                            logger.userInteraction('SYSTEM', `Debug button clicked: ${method}`);
                        } catch (error) {
                            logger.error('SYSTEM', `Debug button error: ${method}`, error);
                            console.error(`Debug overlay button error (${method}):`, error);
                        }
                    });
                    
                    // Also add mousedown event for better responsiveness
                    button.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log(`Debug button mousedown: ${method}`);
                    });
                    
                    logger.debug('SYSTEM', `Debug button initialized: ${id}`);
                } else {
                    logger.warn('SYSTEM', `Debug button not found: ${id}`);
                }
            });
        }, 100); // Small delay to ensure DOM is ready
    }
    
    setupMobileOptimizations() {
        // Enhanced touch handling for mobile
        this.overlay.style.touchAction = 'none';
        
        // Prevent accidental scrolling while dragging
        this.overlay.addEventListener('touchmove', (e) => {
            if (this.isDragging) {
                e.preventDefault();
            }
        }, { passive: false });
        
        // Add haptic feedback if available
        if ('vibrate' in navigator) {
            this.overlay.querySelector('.debug-header').addEventListener('touchstart', () => {
                navigator.vibrate(10);
            });
        }
    }
    
    setupErrorTracking() {
        const originalError = console.error;
        console.error = (...args) => {
            this.performanceMetrics.errors.push({
                message: args.join(' '),
                timestamp: Date.now(),
                stack: new Error().stack
            });
            originalError.apply(console, args);
        };
        
        window.addEventListener('error', (e) => {
            this.performanceMetrics.errors.push({
                message: e.message,
                filename: e.filename,
                line: e.lineno,
                column: e.colno,
                timestamp: Date.now()
            });
        });
    }
    
    setupPerformanceTracking() {
        // Track resource loading
        if ('PerformanceObserver' in window) {
            const observer = new PerformanceObserver((list) => {
                this.performanceMetrics.resourceTiming = list.getEntries();
            });
            observer.observe({ entryTypes: ['resource'] });
        }
    }
    
    startDrag(e) {
        this.isDragging = true;
        const rect = this.overlay.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        
        this.dragOffset = {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
        
        this.overlay.style.cursor = 'grabbing';
        e.preventDefault();
    }
    
    handleDrag(e) {
        if (!this.isDragging) return;
        
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        
        this.position.x = Math.max(0, Math.min(window.innerWidth - 200, clientX - this.dragOffset.x));
        this.position.y = Math.max(0, Math.min(window.innerHeight - 100, clientY - this.dragOffset.y));
        
        this.overlay.style.left = `${this.position.x}px`;
        this.overlay.style.top = `${this.position.y}px`;
        
        e.preventDefault();
    }
    
    stopDrag() {
        if (this.isDragging) {
            this.isDragging = false;
            this.overlay.style.cursor = '';
            this.savePosition();
        }
    }
    
    toggleView() {
        const states = ['compact', 'full', 'minimized'];
        const currentIndex = states.indexOf(this.viewState);
        this.viewState = states[(currentIndex + 1) % states.length];
        
        this.overlay.className = `debug-overlay debug-${this.viewState}`;
        this.safeStorage.setItem('debug-view-state', this.viewState);
        
        // Ensure the toggle button is always visible and clickable
        const toggleBtn = this.overlay.querySelector('.debug-toggle');
        if (toggleBtn) {
            toggleBtn.style.display = 'flex';
            toggleBtn.style.pointerEvents = 'auto';
        }
        
        logger.userInteraction('SYSTEM', `Debug view changed to ${this.viewState}`);
    }
    
    minimize() {
        this.viewState = 'minimized';
        this.overlay.className = `debug-overlay debug-${this.viewState}`;
        this.safeStorage.setItem('debug-view-state', this.viewState);
        
        // Ensure the toggle button is always visible and clickable when minimized
        const toggleBtn = this.overlay.querySelector('.debug-toggle');
        if (toggleBtn) {
            toggleBtn.style.display = 'flex';
            toggleBtn.style.pointerEvents = 'auto';
        }
    }
    
    // Add method to force expand from minimized state
    expand() {
        this.viewState = 'compact';
        this.overlay.className = `debug-overlay debug-${this.viewState}`;
        this.safeStorage.setItem('debug-view-state', this.viewState);
        logger.userInteraction('SYSTEM', 'Debug overlay expanded from minimized state');
    }
    
    hide() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        this.safeStorage.removeItem('debug-enabled');
    }
    
    show() {
        if (!this.overlay) {
            this.init();
            logger.info('SYSTEM', 'Debug overlay shown');
        }
    }
    
    startUpdateLoop() {
        this.updateInfo();
        this.updateInterval = setInterval(() => {
            this.updateInfo();
        }, 1000);
    }
    
    updateInfo() {
        if (!this.overlay) return;
        
        const width = window.innerWidth;
        const height = window.innerHeight;
        const scrollY = window.scrollY;
        const breakpoint = this.getCurrentBreakpoint();
        
        // Update essential info
        this.updateElement('debug-screen', `${width}×${height}`);
        this.updateElement('debug-scroll', `${Math.round(scrollY)}px`);
        this.updateElement('debug-perf', `${Math.round(performance.now())}ms`);
        
        // Update breakpoint with color
        const bpElement = this.overlay.querySelector('#debug-breakpoint');
        if (bpElement) {
            bpElement.textContent = breakpoint.name;
            bpElement.style.color = breakpoint.color;
        }
        
        // Update extended info
        this.updateElement('debug-url', window.location.pathname);
        this.updateElement('debug-ua', this.getShortUA());
        this.updateElement('debug-errors', this.performanceMetrics.errors.length);
        this.updateElement('debug-interactions', this.performanceMetrics.userInteractions);
        this.updateElement('debug-memory', this.getMemoryInfo());
    }
    
    updateElement(id, value) {
        const element = this.overlay.querySelector(`#${id}`);
        if (element && element.textContent !== value) {
            element.textContent = value;
        }
    }
    
    getCurrentBreakpoint() {
        const width = window.innerWidth;
        for (const [key, bp] of Object.entries(this.breakpoints)) {
            if (width >= bp.min && width <= bp.max) {
                return bp;
            }
        }
        return this.breakpoints.xl;
    }
    
    getShortUA() {
        const ua = navigator.userAgent;
        if (ua.includes('Mobile')) return 'Mobile';
        if (ua.includes('Chrome')) return 'Chrome';
        if (ua.includes('Firefox')) return 'Firefox';
        if (ua.includes('Safari')) return 'Safari';
        return 'Unknown';
    }
    
    getMemoryInfo() {
        if ('memory' in performance) {
            const memory = performance.memory;
            return `${Math.round(memory.usedJSHeapSize / 1024 / 1024)}MB`;
        }
        return 'N/A';
    }
    
    // Enhanced utility methods
    clearConsole() {
        console.clear();
        logger.userInteraction('SYSTEM', 'Console cleared via debug overlay');
    }
    
    exportLogs() {
        const logs = {
            errors: this.performanceMetrics.errors,
            performance: {
                loadTime: this.performanceMetrics.pageLoadTime,
                interactions: this.performanceMetrics.userInteractions,
                resources: this.performanceMetrics.resourceTiming.length
            },
            environment: {
                url: window.location.href,
                userAgent: navigator.userAgent,
                screen: `${window.innerWidth}×${window.innerHeight}`,
                breakpoint: this.getCurrentBreakpoint().name
            },
            timestamp: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `debug-logs-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        logger.userInteraction('SYSTEM', 'Debug logs exported');
    }
    
    togglePersistence() {
        const isEnabled = this.safeStorage.getItem('debug-enabled') === 'true';
        if (isEnabled) {
            this.safeStorage.removeItem('debug-enabled');
            logger.info('SYSTEM', 'Debug persistence disabled');
        } else {
            this.safeStorage.setItem('debug-enabled', 'true');
            logger.info('SYSTEM', 'Debug persistence enabled');
        }
    }
    
    showNetworkInfo() {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        let info = 'Network Info:\n';
        
        if (connection) {
            info += `Type: ${connection.effectiveType || 'unknown'}\n`;
            info += `Downlink: ${connection.downlink || 'unknown'} Mbps\n`;
            info += `RTT: ${connection.rtt || 'unknown'} ms\n`;
        } else {
            info += 'Network API not supported';
        }
        
        info += `\nOnline: ${navigator.onLine ? 'Yes' : 'No'}`;
        
        alert(info);
        logger.userInteraction('SYSTEM', 'Network info displayed');
    }
    
    savePosition() {
        this.safeStorage.setItem('debug-position', JSON.stringify(this.position));
    }
    
    loadPosition() {
        const saved = this.safeStorage.getItem('debug-position');
        return saved ? JSON.parse(saved) : null;
    }
    
    // Utility method to reset debug overlay state
    resetState() {
        this.safeStorage.removeItem('debug-view-state');
        this.safeStorage.removeItem('debug-position');
        this.viewState = 'compact';
        this.position = { x: 20, y: 20 };
        if (this.overlay) {
            this.overlay.className = `debug-overlay debug-${this.viewState}`;
            this.overlay.style.left = `${this.position.x}px`;
            this.overlay.style.top = `${this.position.y}px`;
        }
        logger.info('SYSTEM', 'Debug overlay state reset to defaults');
    }
}

// Initialize debug overlay
let debugOverlay;
document.addEventListener('DOMContentLoaded', () => {
    debugOverlay = new DebugOverlay();
    
    // Global access for console debugging
    window.debugOverlay = debugOverlay;
    
    // Console helper commands
    window.debugHelp = () => {
        console.log(`
🐻 Debug Overlay Console Commands:
- debugOverlay.expand() - Force expand from minimized
- debugOverlay.toggleView() - Cycle through view states
- debugOverlay.resetState() - Reset to default state
- debugOverlay.hide() - Hide the overlay
- debugOverlay.show() - Show the overlay (if hidden)
- Double-click header to expand when minimized
- Current state: ${debugOverlay ? debugOverlay.viewState : 'not initialized'}
        `);
    };
    
    // Show help on initialization if debug is enabled
    if (debugOverlay && debugOverlay.isVisible) {
        console.log('🐻 Debug overlay initialized. Type debugHelp() for commands.');
    }
});