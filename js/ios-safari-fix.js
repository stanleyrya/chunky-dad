// iOS Safari Header Bug Fix - Handles iOS 18/26 Safari bug with fixed/sticky headers
class IOSSafariFix {
    constructor() {
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        this.isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        this.isIOSSafari = this.isIOS && this.isSafari;
        this.header = null;
        this.originalHeaderStyle = {};
        this.isFixActive = false;
        
        logger.componentInit('IOS_FIX', 'iOS Safari fix initializing', {
            isIOS: this.isIOS,
            isSafari: this.isSafari,
            isIOSSafari: this.isIOSSafari,
            userAgent: navigator.userAgent.substring(0, 100)
        });
        
        if (this.isIOSSafari) {
            this.init();
        } else {
            logger.debug('IOS_FIX', 'Not iOS Safari - fix not needed');
        }
    }
    
    init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupFix());
        } else {
            this.setupFix();
        }
    }
    
    setupFix() {
        this.header = document.querySelector('header');
        if (!this.header) {
            logger.warn('IOS_FIX', 'Header element not found');
            return;
        }
        
        // Store original header styles
        const computedStyle = window.getComputedStyle(this.header);
        this.originalHeaderStyle = {
            position: computedStyle.position,
            top: computedStyle.top,
            paddingTop: computedStyle.paddingTop,
            transform: computedStyle.transform
        };
        
        logger.componentInit('IOS_FIX', 'Setting up iOS Safari header fix', {
            originalStyles: this.originalHeaderStyle
        });
        
        // Apply the main fixes
        this.setupViewportFix();
        this.setupScrollFix();
        this.setupOverflowFix();
        this.setupKeyboardFix();
        
        logger.componentLoad('IOS_FIX', 'iOS Safari header fixes applied');
    }
    
    setupViewportFix() {
        // Fix for visual viewport position bug
        const handleViewportChange = () => {
            if (!this.header) return;
            
            const rect = this.header.getBoundingClientRect();
            const expectedTop = 0;
            
            // Check if header is misaligned
            if (Math.abs(rect.top - expectedTop) > 1) {
                logger.debug('IOS_FIX', 'Header misalignment detected, applying fix', {
                    currentTop: rect.top,
                    expectedTop: expectedTop,
                    offset: rect.top - expectedTop
                });
                
                // Apply padding adjustment to compensate for misalignment
                const offsetFix = -rect.top;
                this.header.style.paddingTop = `${offsetFix}px`;
                this.isFixActive = true;
                
                // Reset after a short delay to avoid permanent styling
                setTimeout(() => {
                    if (this.header && this.isFixActive) {
                        const newRect = this.header.getBoundingClientRect();
                        if (Math.abs(newRect.top) < 1) {
                            this.header.style.paddingTop = this.originalHeaderStyle.paddingTop;
                            this.isFixActive = false;
                            logger.debug('IOS_FIX', 'Header alignment restored, fix removed');
                        }
                    }
                }, 500);
            }
        };
        
        // Listen for scroll events (recommended fix from research)
        const handleScroll = () => {
            handleViewportChange();
        };
        
        // Listen for visual viewport changes
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', handleViewportChange);
            window.visualViewport.addEventListener('scroll', handleViewportChange);
        }
        
        // Listen for regular scroll events
        window.addEventListener('scroll', handleScroll, { passive: true });
        
        // Listen for orientation changes
        window.addEventListener('orientationchange', () => {
            setTimeout(handleViewportChange, 300);
        });
        
        logger.debug('IOS_FIX', 'Viewport fix listeners attached');
    }
    
    setupScrollFix() {
        // Force scroll recalculation on page load to trigger header repositioning
        const forceScrollRecalc = () => {
            const currentScroll = window.pageYOffset;
            window.scrollTo(0, currentScroll + 1);
            window.scrollTo(0, currentScroll);
            
            logger.debug('IOS_FIX', 'Forced scroll recalculation to fix header positioning');
        };
        
        // Apply fix after page load
        window.addEventListener('load', () => {
            setTimeout(forceScrollRecalc, 100);
        });
        
        // Apply fix when returning from background (common trigger for the bug)
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                setTimeout(forceScrollRecalc, 100);
            }
        });
    }
    
    setupOverflowFix() {
        // Apply overflow fixes to prevent the bug (based on research)
        const body = document.body;
        const html = document.documentElement;
        
        // Store original overflow values
        const originalBodyOverflow = body.style.overflow;
        const originalHtmlOverflow = html.style.overflow;
        
        // Apply iOS-specific overflow fixes
        if (this.isIOSSafari) {
            // Some versions of the bug are fixed by setting overflow: hidden on containers
            // We'll be more conservative and only apply this if we detect the bug
            const checkAndApplyOverflowFix = () => {
                if (this.header) {
                    const rect = this.header.getBoundingClientRect();
                    if (Math.abs(rect.top) > 5) { // Only apply if significantly misaligned
                        body.style.overflow = 'hidden';
                        html.style.overflow = 'hidden';
                        
                        setTimeout(() => {
                            body.style.overflow = originalBodyOverflow;
                            html.style.overflow = originalHtmlOverflow;
                        }, 100);
                        
                        logger.debug('IOS_FIX', 'Applied temporary overflow fix for header misalignment');
                    }
                }
            };
            
            // Check after keyboard events
            document.addEventListener('focusout', () => {
                setTimeout(checkAndApplyOverflowFix, 300);
            });
        }
    }
    
    setupKeyboardFix() {
        // Fix for header misalignment after keyboard dismissal
        let keyboardVisible = false;
        
        const handleResize = () => {
            const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
            const windowHeight = window.innerHeight;
            
            // Detect if keyboard is likely visible (viewport significantly smaller than window)
            const wasKeyboardVisible = keyboardVisible;
            keyboardVisible = viewportHeight < windowHeight * 0.8;
            
            // If keyboard was just dismissed, apply header fix
            if (wasKeyboardVisible && !keyboardVisible) {
                logger.debug('IOS_FIX', 'Keyboard dismissed, checking header alignment');
                
                setTimeout(() => {
                    if (this.header) {
                        const rect = this.header.getBoundingClientRect();
                        if (Math.abs(rect.top) > 1) {
                            logger.debug('IOS_FIX', 'Header misaligned after keyboard dismissal, applying fix');
                            
                            // Force a reflow to fix positioning
                            this.header.style.transform = 'translateZ(0)';
                            this.header.offsetHeight; // Force reflow
                            this.header.style.transform = this.originalHeaderStyle.transform;
                        }
                    }
                }, 100);
            }
        };
        
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', handleResize);
        } else {
            window.addEventListener('resize', handleResize);
        }
        
        logger.debug('IOS_FIX', 'Keyboard fix listeners attached');
    }
    
    // Public method to manually trigger header fix
    fixHeaderPosition() {
        if (!this.isIOSSafari || !this.header) {
            return false;
        }
        
        const rect = this.header.getBoundingClientRect();
        if (Math.abs(rect.top) > 1) {
            logger.info('IOS_FIX', 'Manual header fix triggered', {
                currentTop: rect.top,
                offset: rect.top
            });
            
            // Apply immediate fix
            this.header.style.paddingTop = `${-rect.top}px`;
            this.isFixActive = true;
            
            // Reset after delay
            setTimeout(() => {
                if (this.header && this.isFixActive) {
                    this.header.style.paddingTop = this.originalHeaderStyle.paddingTop;
                    this.isFixActive = false;
                }
            }, 500);
            
            return true;
        }
        
        return false;
    }
    
    // Public method to check if fix is needed
    isFixNeeded() {
        if (!this.isIOSSafari || !this.header) {
            return false;
        }
        
        const rect = this.header.getBoundingClientRect();
        return Math.abs(rect.top) > 1;
    }
}

// Initialize the fix immediately if on iOS Safari
let iosSafariFix = null;

if (typeof window !== 'undefined') {
    iosSafariFix = new IOSSafariFix();
    window.iosSafariFix = iosSafariFix;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = IOSSafariFix;
} else {
    window.IOSSafariFix = IOSSafariFix;
}