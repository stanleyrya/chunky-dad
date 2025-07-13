// God Mode - Debug and Admin Access System
class GodModeManager {
    constructor() {
        this.isGodModeActive = false;
        this.keySequence = [];
        this.targetSequence = ['g', 'o', 'd'];
        this.sequenceTimeout = null;
        this.godModePanel = null;
        
        this.init();
        
        logger.componentInit('SYSTEM', 'God Mode manager initialized');
    }

    init() {
        // Listen for key sequence
        document.addEventListener('keydown', (e) => {
            this.handleKeyPress(e.key.toLowerCase());
        });

        // Check for URL parameter activation
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('god') === 'true') {
            this.activateGodMode();
        }
    }

    handleKeyPress(key) {
        // Add key to sequence
        this.keySequence.push(key);
        
        // Keep only the last 3 keys
        if (this.keySequence.length > 3) {
            this.keySequence.shift();
        }
        
        // Check if sequence matches
        if (this.keySequence.join('') === this.targetSequence.join('')) {
            this.activateGodMode();
            this.keySequence = []; // Reset sequence
        }
        
        // Clear sequence after timeout
        clearTimeout(this.sequenceTimeout);
        this.sequenceTimeout = setTimeout(() => {
            this.keySequence = [];
        }, 2000);
    }

    activateGodMode() {
        if (this.isGodModeActive) return;
        
        this.isGodModeActive = true;
        this.createGodModePanel();
        
        logger.userInteraction('SYSTEM', 'God Mode activated');
        
        // Show activation message
        this.showNotification('🔧 God Mode Activated', 'success');
    }

    createGodModePanel() {
        this.godModePanel = document.createElement('div');
        this.godModePanel.id = 'god-mode-panel';
        this.godModePanel.innerHTML = `
            <div class="god-mode-header">
                <h3>🔧 God Mode</h3>
                <button class="god-mode-close" onclick="godMode.deactivateGodMode()">×</button>
            </div>
            <div class="god-mode-content">
                <div class="god-mode-section">
                    <h4>🛠️ Debug Tools</h4>
                    <button onclick="godMode.openCalendarDebugger()" class="god-mode-btn">
                        📅 Calendar Debugger
                    </button>
                    <button onclick="godMode.openViewDemo()" class="god-mode-btn">
                        👁️ View Configuration Demo
                    </button>
                    <button onclick="godMode.downloadDebugInfo()" class="god-mode-btn">
                        📋 Download Debug Info
                    </button>
                </div>
                
                <div class="god-mode-section">
                    <h4>🎯 Quick Actions</h4>
                    <button onclick="godMode.clearAllStorage()" class="god-mode-btn warning">
                        🗑️ Clear All Storage
                    </button>
                    <button onclick="godMode.toggleAllViews()" class="god-mode-btn">
                        🔄 Toggle All Views
                    </button>
                    <button onclick="godMode.exportCurrentData()" class="god-mode-btn">
                        💾 Export Current Data
                    </button>
                </div>
                
                <div class="god-mode-section">
                    <h4>📊 System Info</h4>
                    <div id="god-mode-system-info">
                        <div class="info-item">
                            <span>Page:</span>
                            <span id="current-page-info">${window.location.pathname}</span>
                        </div>
                        <div class="info-item">
                            <span>Views Active:</span>
                            <span id="active-views-info">Loading...</span>
                        </div>
                        <div class="info-item">
                            <span>Console Logs:</span>
                            <span id="console-logs-count">0</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        this.addGodModeStyles();
        document.body.appendChild(this.godModePanel);
        
        // Update system info
        this.updateSystemInfo();
        
        // Make draggable
        this.makeDraggable();
    }

    addGodModeStyles() {
        if (document.getElementById('god-mode-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'god-mode-styles';
        style.textContent = `
            #god-mode-panel {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 350px;
                background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
                border: 2px solid #FFA500;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(255, 165, 0, 0.3);
                z-index: 10000;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                color: #ffffff;
                backdrop-filter: blur(10px);
            }
            
            .god-mode-header {
                background: linear-gradient(90deg, #FFA500, #FF8C00);
                color: #000;
                padding: 15px 20px;
                border-radius: 10px 10px 0 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: move;
                font-weight: 600;
            }
            
            .god-mode-header h3 {
                margin: 0;
                font-size: 1.1rem;
            }
            
            .god-mode-close {
                background: none;
                border: none;
                font-size: 1.5rem;
                cursor: pointer;
                color: #000;
                padding: 0;
                width: 25px;
                height: 25px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background-color 0.2s;
            }
            
            .god-mode-close:hover {
                background: rgba(0, 0, 0, 0.1);
            }
            
            .god-mode-content {
                padding: 20px;
                max-height: 400px;
                overflow-y: auto;
            }
            
            .god-mode-section {
                margin-bottom: 20px;
            }
            
            .god-mode-section h4 {
                margin: 0 0 10px 0;
                color: #FFA500;
                font-size: 0.9rem;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            
            .god-mode-btn {
                display: block;
                width: 100%;
                padding: 8px 12px;
                margin-bottom: 8px;
                background: #333;
                color: #fff;
                border: 1px solid #555;
                border-radius: 6px;
                cursor: pointer;
                font-size: 0.85rem;
                transition: all 0.2s;
                text-align: left;
            }
            
            .god-mode-btn:hover {
                background: #444;
                border-color: #FFA500;
                transform: translateX(2px);
            }
            
            .god-mode-btn.warning {
                background: #663333;
                border-color: #ff4444;
            }
            
            .god-mode-btn.warning:hover {
                background: #884444;
                border-color: #ff6666;
            }
            
            #god-mode-system-info {
                font-size: 0.8rem;
                line-height: 1.4;
            }
            
            .info-item {
                display: flex;
                justify-content: space-between;
                padding: 4px 0;
                border-bottom: 1px solid #333;
            }
            
            .info-item:last-child {
                border-bottom: none;
            }
            
            .god-mode-notification {
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: #333;
                color: #fff;
                padding: 10px 20px;
                border-radius: 6px;
                z-index: 10001;
                font-size: 0.9rem;
                border: 1px solid #555;
                animation: slideInDown 0.3s ease;
            }
            
            .god-mode-notification.success {
                background: #4CAF50;
                border-color: #45a049;
            }
            
            .god-mode-notification.error {
                background: #f44336;
                border-color: #da190b;
            }
            
            @keyframes slideInDown {
                from {
                    transform: translateX(-50%) translateY(-100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(-50%) translateY(0);
                    opacity: 1;
                }
            }
        `;
        
        document.head.appendChild(style);
    }

    makeDraggable() {
        let isDragging = false;
        let dragOffset = { x: 0, y: 0 };
        
        const header = this.godModePanel.querySelector('.god-mode-header');
        
        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            dragOffset.x = e.clientX - this.godModePanel.offsetLeft;
            dragOffset.y = e.clientY - this.godModePanel.offsetTop;
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        });
        
        const handleMouseMove = (e) => {
            if (!isDragging) return;
            
            this.godModePanel.style.left = (e.clientX - dragOffset.x) + 'px';
            this.godModePanel.style.top = (e.clientY - dragOffset.y) + 'px';
            this.godModePanel.style.right = 'auto';
        };
        
        const handleMouseUp = () => {
            isDragging = false;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }

    updateSystemInfo() {
        const activeViewsInfo = document.getElementById('active-views-info');
        const consoleLogsCount = document.getElementById('console-logs-count');
        
        if (activeViewsInfo) {
            if (window.calendarLoader && window.calendarLoader.viewManager) {
                const activeViews = window.calendarLoader.getActiveViews();
                activeViewsInfo.textContent = activeViews.length > 0 
                    ? activeViews.map(v => v.name).join(', ')
                    : 'None';
            } else {
                activeViewsInfo.textContent = 'N/A';
            }
        }
        
        if (consoleLogsCount) {
            // This is a placeholder - you could implement actual console log counting
            consoleLogsCount.textContent = 'N/A';
        }
    }

    // God Mode Actions
    openCalendarDebugger() {
        const currentUrl = new URL(window.location);
        const city = currentUrl.searchParams.get('city') || 'new-york';
        window.open(`test-calendar-logging.html?city=${city}`, '_blank');
        
        logger.userInteraction('SYSTEM', 'Calendar debugger opened');
    }

    openViewDemo() {
        const currentUrl = new URL(window.location);
        const city = currentUrl.searchParams.get('city') || 'new-york';
        window.open(`view-configuration-demo.html?city=${city}`, '_blank');
        
        logger.userInteraction('SYSTEM', 'View demo opened');
    }

    downloadDebugInfo() {
        const debugInfo = {
            timestamp: new Date().toISOString(),
            url: window.location.href,
            userAgent: navigator.userAgent,
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight
            },
            calendarLoader: {
                type: window.calendarLoader ? window.calendarLoader.constructor.name : 'None',
                city: window.calendarLoader ? window.calendarLoader.currentCity : 'N/A',
                activeViews: window.calendarLoader ? window.calendarLoader.getActiveViews().map(v => v.name) : []
            },
            localStorage: Object.keys(localStorage).length,
            sessionStorage: Object.keys(sessionStorage).length
        };
        
        const blob = new Blob([JSON.stringify(debugInfo, null, 2)], {
            type: 'application/json'
        });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `debug-info-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.showNotification('📋 Debug info downloaded', 'success');
        logger.userInteraction('SYSTEM', 'Debug info downloaded');
    }

    clearAllStorage() {
        if (confirm('Are you sure you want to clear all stored data?')) {
            localStorage.clear();
            sessionStorage.clear();
            
            this.showNotification('🗑️ All storage cleared', 'success');
            logger.userInteraction('SYSTEM', 'All storage cleared');
        }
    }

    toggleAllViews() {
        if (window.calendarLoader && window.calendarLoader.viewManager) {
            const viewManager = window.calendarLoader.viewManager;
            const allViews = ['calendar', 'eventlist', 'map'];
            
            // Check if all views are active
            const allActive = allViews.every(view => viewManager.activeViews.has(view));
            
            if (allActive) {
                // Disable all views
                allViews.forEach(view => window.calendarLoader.disableView(view));
                this.showNotification('👁️ All views disabled', 'success');
            } else {
                // Enable all views
                allViews.forEach(view => window.calendarLoader.enableView(view));
                this.showNotification('👁️ All views enabled', 'success');
            }
            
            this.updateSystemInfo();
            logger.userInteraction('SYSTEM', `All views ${allActive ? 'disabled' : 'enabled'}`);
        }
    }

    exportCurrentData() {
        if (window.calendarLoader && window.calendarLoader.eventsData) {
            const exportData = {
                timestamp: new Date().toISOString(),
                city: window.calendarLoader.currentCity,
                cityConfig: window.calendarLoader.currentCityConfig,
                events: window.calendarLoader.allEvents,
                activeViews: window.calendarLoader.getActiveViews().map(v => v.name)
            };
            
            const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                type: 'application/json'
            });
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `events-data-${window.calendarLoader.currentCity}-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            
            this.showNotification('💾 Data exported', 'success');
            logger.userInteraction('SYSTEM', 'Current data exported');
        } else {
            this.showNotification('❌ No data to export', 'error');
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `god-mode-notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    deactivateGodMode() {
        if (this.godModePanel) {
            this.godModePanel.remove();
            this.godModePanel = null;
        }
        
        this.isGodModeActive = false;
        this.showNotification('🔧 God Mode deactivated', 'info');
        
        logger.userInteraction('SYSTEM', 'God Mode deactivated');
    }
}

// Initialize God Mode
const godMode = new GodModeManager();

// Make it globally accessible
window.godMode = godMode;