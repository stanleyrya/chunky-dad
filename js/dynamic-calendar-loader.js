// Icon paths used by the aurora event cards (Bootstrap Icons geometry, inlined).
// Inlined rather than fetched as a webfont/sprite so the information rows always
// render, even when the Bootstrap-icons CDN is slow or blocked.
const AURORA_CARD_ICONS = {
    clock: [
        'M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z',
        'M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z'
    ],
    pin: [
        'M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z'
    ],
    cash: [
        'M4 10.781c.148 1.667 1.513 2.85 3.591 3.003V15h1.043v-1.216c2.27-.179 3.678-1.438 3.678-3.29 0-1.53-.9-2.377-2.849-2.838l-.829-.194V3.885c1.135.148 1.856.749 2.028 1.578h1.549c-.14-1.577-1.475-2.759-3.577-2.912V1H7.591v1.55c-1.9.192-3.328 1.396-3.328 3.156 0 1.462.943 2.472 2.653 2.873l.674.163v3.949c-1.156-.168-1.918-.789-2.09-1.91H4zm3.559-1.66c-1.086-.263-1.663-.766-1.663-1.545 0-.784.598-1.386 1.6-1.512v3.057h.063zm1.184 1.35c1.303.325 1.94.813 1.94 1.71 0 .952-.716 1.585-1.94 1.71v-3.42z'
    ],
    repeat: [
        'M11 5.466V4H5a4 4 0 0 0-3.584 5.777.5.5 0 1 1-.896.446A5 5 0 0 1 5 3h6V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192zm3.584.757a.5.5 0 0 1 .658.257A5 5 0 0 1 11 13H5v1.466a.25.25 0 0 1-.41.192l-2.36-1.966a.25.25 0 0 1 0-.384l2.36-1.966a.25.25 0 0 1 .41.192V12h6a4 4 0 0 0 3.584-5.777.5.5 0 0 1 .257-.657z'
    ]
};

// ── Aurora gradient tuning ───────────────────────────────────────────────────
// The card's base colour, the floor every stop is blended toward (#171a33).
const AURORA_BASE_RGB = { r: 23, g: 26, b: 51 };
// Palette entries carry `c` = OKLab chroma ×100 (see tools/extract-favicon-colors.js).
// Below this a colour is a grey/near-grey and can't carry a gradient stop.
const AURORA_MIN_CHROMA = 0.05;
// A second stop has to cover a real part of the artwork; anything smaller is an
// anti-aliasing fringe (the pale pinks around Animal's red "A") and makes a
// washed-out blob rather than a second colour.
// A second stop must be a real presence in the artwork, not a speck: Bear
// Happy Hour's palette carries a 1%-coverage yellow (#f6e529) that was
// defining half its card, and orange->yellow blends through olive.
const AURORA_MIN_STOP_SHARE = 0.10;
// Below this separation two stops read as one colour and the "gradient" is a
// flat wash — the Bearracuda/Animal failure the palette was built to fix.
const AURORA_MIN_SEPARATION = 0.2;
// Hue rotation (degrees) and lightness factor used to invent a sibling stop when
// the artwork genuinely has only one colour in it.
// Single-colour artwork gets a DEEPER sibling of the same hue rather than a
// rotated one: rotating a warm accent (Animal's red) lands in the yellow-olive
// band and reads muddy, while darkening stays on-brand.
const AURORA_SIBLING_LIGHTNESS = 0.55;
const AURORA_SIBLING_CHROMA_BOOST = 1.12;

// Every event field that holds a flyer URL. `image` is the primary; the two
// orientation slots are optional (orientation is only knowable for a minority
// of URLs) and a portrait primary legitimately appears in both `image` and
// `imageVertical`.
const IMAGE_SLOT_FIELDS = ['image', 'imageVertical', 'imageHorizontal'];

// Move a flyer <img> onto its next candidate after a load failure. Events can
// carry up to three flyer URLs (image / imageVertical / imageHorizontal), so a
// dead CDN link no longer makes the artwork vanish — the card walks the
// remaining candidates (queued in data-flyer-fallbacks by the card renderer)
// and only removes the container once every one of them has failed, which is
// exactly the pre-existing behaviour for the single-URL case.
function advanceFlyerImage(img) {
    const flyer = img && img.parentNode;
    if (!flyer || typeof flyer.getAttribute !== 'function') {
        if (img && typeof img.remove === 'function') img.remove();
        return;
    }
    let queue = [];
    try {
        const raw = flyer.getAttribute('data-flyer-fallbacks');
        if (raw) queue = JSON.parse(raw);
    } catch (error) {
        queue = [];
    }
    const remaining = Array.isArray(queue)
        ? queue.filter(candidate => candidate && typeof candidate.u === 'string' && candidate.u)
        : [];
    const next = remaining.shift();
    if (!next) {
        flyer.remove();
        return;
    }
    if (remaining.length) {
        flyer.setAttribute('data-flyer-fallbacks', JSON.stringify(remaining));
    } else {
        flyer.removeAttribute('data-flyer-fallbacks');
    }
    flyer.setAttribute('data-flyer-url', next.u);
    if (next.o) {
        flyer.setAttribute('data-flyer-orientation', next.o);
    } else {
        flyer.removeAttribute('data-flyer-orientation');
    }
    img.src = next.u;
}

// Dynamic Google Calendar Loader - Supports multiple cities and calendars
class DynamicCalendarLoader extends CalendarCore {
    constructor() {
        super();
        this.currentCity = null;
        this.currentCityConfig = null;
        
        // Initialization state to prevent multiple inits
        this.isInitialized = false;
        this.isInitializing = false;
        this.controlsSetup = false;
        
        // View state management - enhanced with new calendar overview
        this.currentView = 'week'; // 'week' or 'month'
        this.currentDate = new Date();
        
        // Event selection state (for URL sync)
        this.selectedEventSlug = null;
        this.selectedEventDateISO = null;
        
        // Enhanced swipe functionality
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.touchCurrentX = 0;
        this.touchCurrentY = 0;
        this.touchEndX = 0;
        this.touchEndY = 0;
        this.minSwipeDistance = 30; // Minimum distance for a swipe (reduced for better responsiveness)
        this.maxSwipeTime = 300; // Maximum time for a swipe (ms)
        this.touchStartTime = 0;
        this.isSwiping = false;
        this.swipeThreshold = 80; // Distance to trigger navigation (reduced for better responsiveness)
        this.swipeVelocity = 0;

        // Continuous calendar strip state (see generateCalendarEvents):
        // the grid renders wider than the visible period and scrolls
        // natively; cards/map/label/URL follow on scroll settle only.
        this.stripStartDate = null;   // week strip: date of column 0
        this.stripDayCount = 63;      // week strip: visible week ± 28 days
        this.stripMonths = [];        // month strip: rendered month firsts
        this.lastStripEvents = [];    // events across the rendered strip
        this.suppressGridScrollUntil = 0;
        this.gridScrollTimer = 0;
        this.gridTouchActive = false;
        this.pendingStripAnchor = null;
        this.lastTouchTime = 0;
        this.lastTouchX = 0;
        
        // Set up message listener for testing interface
        this.setupMessageListener();
        
        // Cache for event names - only recalculate on screen size change
        this.cachedEventNames = new Map();
        this.lastScreenWidth = window.innerWidth;
        this.currentBreakpoint = this.getCurrentBreakpoint();
        
        // Location features
        this.userLocation = null;
        this.locationFeaturesEnabled = false;
        this.hasWarnedMissingFilenameUtils = false;

        // Per-event favicon colors (data/event-colors/<city>.json), keyed by city
        // then by event slug. Populated lazily; see loadEventColors().
        this.eventColorsByCity = new Map();
        this.eventColorsRequests = new Map();
        
        // Set up window resize listener to clear measurement cache
        this.setupResizeListener();
        
        logger.componentInit('CALENDAR', 'Dynamic CalendarLoader initialized');
    }

    // Enhanced swipe detection methods
    setupSwipeHandlers() {
        // The continuous calendar strip owns grid gestures now: the grid is
        // a native scroller (week slides day-by-day, month drags freely), so
        // the old swipe-to-flip-period handlers must not attach — their
        // touchmove preventDefault would kill native scrolling outright.
        return;
        // eslint-disable-next-line no-unreachable
        const calendarGrid = document.querySelector('.calendar-grid');
        if (!calendarGrid) {
            logger.warn('CALENDAR', 'Calendar grid not found for swipe setup');
            return;
        }

        // Touch start
        calendarGrid.addEventListener('touchstart', (e) => {
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
            this.touchCurrentX = this.touchStartX;
            this.touchCurrentY = this.touchStartY;
            this.touchStartTime = Date.now();
            this.isSwiping = false;
            this.swipeVelocity = 0;
            this.lastTouchTime = this.touchStartTime;
            this.lastTouchX = this.touchStartX;
            
            logger.userInteraction('CALENDAR', 'Touch start detected', {
                x: this.touchStartX,
                y: this.touchStartY,
                timestamp: this.touchStartTime
            });
        }, { passive: true });

        // Touch move - track finger movement in real-time
        calendarGrid.addEventListener('touchmove', (e) => {
            if (!this.touchStartX) return; // No active touch
            
            this.touchCurrentX = e.touches[0].clientX;
            this.touchCurrentY = e.touches[0].clientY;
            const currentTime = Date.now();
            
            // Calculate velocity
            const timeDelta = currentTime - this.lastTouchTime;
            if (timeDelta > 0) {
                const distanceDelta = this.touchCurrentX - this.lastTouchX;
                this.swipeVelocity = distanceDelta / timeDelta;
            }
            
            this.lastTouchTime = currentTime;
            this.lastTouchX = this.touchCurrentX;
            
            // Calculate horizontal movement
            const deltaX = this.touchCurrentX - this.touchStartX;
            const deltaY = this.touchCurrentY - this.touchStartY;
            
            // Check if this is a horizontal swipe (reduced threshold for better responsiveness)
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 5) {
                this.isSwiping = true;
                
                // Apply visual feedback - move the calendar with the finger
                this.updateSwipeVisualFeedback(deltaX);
                
                // Prevent default to avoid scrolling
                e.preventDefault();
                
                logger.debug('CALENDAR', 'Swipe in progress', {
                    deltaX,
                    deltaY,
                    velocity: this.swipeVelocity,
                    progress: Math.min(Math.abs(deltaX) / (window.innerWidth * 0.4), 1)
                });
            }
        }, { passive: false });

        // Touch end
        calendarGrid.addEventListener('touchend', (e) => {
            if (!this.touchStartX) return; // No active touch
            
            this.touchEndX = e.changedTouches[0].clientX;
            this.touchEndY = e.changedTouches[0].clientY;
            const touchEndTime = Date.now();
            const duration = touchEndTime - this.touchStartTime;
            
            logger.userInteraction('CALENDAR', 'Touch end detected', {
                x: this.touchEndX,
                y: this.touchEndY,
                duration,
                isSwiping: this.isSwiping,
                totalDistance: Math.sqrt(
                    Math.pow(this.touchEndX - this.touchStartX, 2) + 
                    Math.pow(this.touchEndY - this.touchStartY, 2)
                )
            });
            
            if (this.isSwiping) {
                this.handleSwipe(duration);
            } else {
                // Only reset visual feedback if not swiping
                this.resetSwipeVisualFeedback();
            }
            
            // Reset touch state
            this.touchStartX = 0;
            this.touchStartY = 0;
            this.touchCurrentX = 0;
            this.touchCurrentY = 0;
            this.isSwiping = false;
        }, { passive: true });

        // Touch cancel
        calendarGrid.addEventListener('touchcancel', (e) => {
            this.resetSwipeVisualFeedback();
            this.touchStartX = 0;
            this.touchStartY = 0;
            this.touchCurrentX = 0;
            this.touchCurrentY = 0;
            this.isSwiping = false;
        }, { passive: true });

        logger.componentLoad('CALENDAR', 'Enhanced swipe handlers setup complete');
    }

    // Update visual feedback during swipe
    updateSwipeVisualFeedback(deltaX) {
        const calendarGrid = document.querySelector('.calendar-grid');
        if (!calendarGrid) return;
        
        // Calculate opacity and transform based on swipe distance
        const maxDistance = window.innerWidth * 0.4; // 40% of screen width for better visual feedback
        const progress = Math.min(Math.abs(deltaX) / maxDistance, 1);
        const opacity = 1 - (progress * 0.2); // Reduce opacity as user swipes (less dramatic)
        const translateX = deltaX * 0.5; // Move calendar with finger (50% of finger movement for more responsive feel)
        
        // Apply transform, opacity, subtle scale, and rotation effects
        const scale = 1 - (progress * 0.05); // Slight scale down as user swipes
        const rotation = (deltaX / window.innerWidth) * 2; // Subtle rotation based on swipe distance
        calendarGrid.style.transform = `translateX(${translateX}px) scale(${scale}) rotateY(${rotation}deg)`;
        calendarGrid.style.opacity = opacity;
        
        // Keep the same styling without background color changes
        
        // Add subtle shadow effect for depth
        const shadowBlur = Math.min(progress * 20, 10);
        const shadowOffset = Math.min(progress * 10, 5);
        calendarGrid.style.boxShadow = `0 ${shadowOffset}px ${shadowBlur}px rgba(0,0,0,${progress * 0.3})`;
        
    }

    // Reset visual feedback
    resetSwipeVisualFeedback() {
        const calendarGrid = document.querySelector('.calendar-grid');
        if (!calendarGrid) return;
        
        // Only reset if we're not in the middle of a transition animation
        if (calendarGrid.style.transition && calendarGrid.style.transition.includes('0.3s')) {
            logger.debug('CALENDAR', 'Skipping visual feedback reset during transition animation');
            return;
        }
        
        // Reset transform, opacity, scale, and rotation with smooth transition
        calendarGrid.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
        calendarGrid.style.transform = 'translateX(0) scale(1) rotateY(0deg)';
        calendarGrid.style.opacity = '1';
        calendarGrid.style.boxShadow = '';
        
        // Remove transition after animation completes
        setTimeout(() => {
            calendarGrid.style.transition = '';
        }, 200);
        
    }

    handleSwipe(duration) {
        const deltaX = this.touchEndX - this.touchStartX;
        const deltaY = this.touchEndY - this.touchStartY;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        // Check if it's a valid swipe
        if (duration > this.maxSwipeTime || distance < this.minSwipeDistance) {
            logger.debug('CALENDAR', 'Swipe invalid - too slow or too short', {
                duration,
                distance,
                maxTime: this.maxSwipeTime,
                minDistance: this.minSwipeDistance
            });
            // Reset visual feedback for invalid swipe
            this.resetSwipeVisualFeedback();
            return;
        }
        
        // Check if it's more horizontal than vertical (swipe vs scroll)
        if (Math.abs(deltaX) < Math.abs(deltaY)) {
            logger.debug('CALENDAR', 'Swipe ignored - more vertical than horizontal');
            // Reset visual feedback for vertical swipe
            this.resetSwipeVisualFeedback();
            return;
        }
        
        // Determine swipe direction based on distance or velocity
        const shouldNavigate = Math.abs(deltaX) > this.swipeThreshold || 
                              Math.abs(this.swipeVelocity) > 0.3; // Lower velocity threshold for better responsiveness
        
        if (shouldNavigate) {
            const direction = deltaX > 0 ? 'prev' : 'next';
            logger.userInteraction('CALENDAR', `Swipe ${direction === 'prev' ? 'right' : 'left'} detected - navigating to ${direction} period`, {
                distance: deltaX,
                velocity: this.swipeVelocity
            });
            
            // Animate the swipe transition
            this.animateSwipeTransition(direction, deltaX);
        } else {
            logger.debug('CALENDAR', 'Swipe distance/velocity insufficient for navigation', {
                distance: deltaX,
                threshold: this.swipeThreshold,
                velocity: this.swipeVelocity
            });
            // Reset visual feedback for insufficient swipe
            this.resetSwipeVisualFeedback();
        }
    }

    // Animate swipe transition with smooth off-screen movement
    animateSwipeTransition(direction, deltaX) {
        const calendarGrid = document.querySelector('.calendar-grid');
        if (!calendarGrid) return;
        
        logger.debug('CALENDAR', 'Starting swipe transition animation', {
            direction,
            deltaX,
            currentTransform: calendarGrid.style.transform
        });
        
        // Calculate the target position (off-screen)
        const screenWidth = window.innerWidth;
        const targetTranslateX = direction === 'prev' ? screenWidth : -screenWidth;
        
        // Remove transition temporarily to set initial position
        calendarGrid.style.transition = 'none';
        
        // Set the current position from the swipe
        const currentTranslateX = deltaX * 0.5; // Match the visual feedback position
        calendarGrid.style.transform = `translateX(${currentTranslateX}px) scale(1) rotateY(0deg)`;
        
        // Force a reflow to ensure the position is set
        calendarGrid.offsetHeight;
        
        // Add smooth transition for the animation
        calendarGrid.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out';
        
        // Animate to off-screen position
        requestAnimationFrame(() => {
            calendarGrid.style.transform = `translateX(${targetTranslateX}px) scale(0.95) rotateY(${direction === 'prev' ? 5 : -5}deg)`;
            calendarGrid.style.opacity = '0.7';
            
            // After animation completes, update content and animate new content in
            setTimeout(async () => {
                // Update the calendar content (skip immediate display update)
                this.navigatePeriod(direction, false);
                
                // Update the display to get new content
                await this.updateCalendarDisplay();
                
                // Prepare new content to slide in from opposite direction
                const newCalendarGrid = document.querySelector('.calendar-grid');
                if (newCalendarGrid) {
                    // Set initial position (off-screen from opposite direction)
                    const initialTranslateX = direction === 'prev' ? -screenWidth : screenWidth;
                    newCalendarGrid.style.transition = 'none';
                    newCalendarGrid.style.transform = `translateX(${initialTranslateX}px) scale(0.95) rotateY(${direction === 'prev' ? -5 : 5}deg)`;
                    newCalendarGrid.style.opacity = '0.7';
                    
                    // Force reflow
                    newCalendarGrid.offsetHeight;
                    
                    // Animate to center position
                    newCalendarGrid.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out';
                    requestAnimationFrame(() => {
                        newCalendarGrid.style.transform = 'translateX(0) scale(1) rotateY(0deg)';
                        newCalendarGrid.style.opacity = '1';
                        
                        // Clean up after animation
                        setTimeout(() => {
                            newCalendarGrid.style.transition = '';
                            newCalendarGrid.style.transform = '';
                            newCalendarGrid.style.opacity = '';
                        }, 300);
                    });
                }
            }, 300);
        });
    }

    // Get city from URL parameters
    getCityFromURL() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const cityParam = urlParams.get('city');
            const resolveAlias = (rawSlug) => {
                if (!rawSlug) return null;
                const slug = String(rawSlug).trim().toLowerCase();
                const cityConfig = (typeof window !== 'undefined' && window.CITY_CONFIG) ? window.CITY_CONFIG : {};
                if (cityConfig && cityConfig[slug]) return slug;
                for (const [key, cfg] of Object.entries(cityConfig || {})) {
                    if (cfg && Array.isArray(cfg.aliases)) {
                        if (cfg.aliases.map(a => String(a).toLowerCase()).includes(slug)) return key;
                    }
                }
                return null;
            };
            if (cityParam) return resolveAlias(cityParam) || cityParam;

            // Fallback: detect from first path segment (supports aliases)
            const slug = this.getCitySlugFromPath();
            if (slug) return slug;

            // Legacy: hash or default
            const hash = window.location.hash.replace('#', '');
            return resolveAlias(hash) || hash || 'nyc';
        } catch (e) {
            logger.warn('CITY', 'Failed to resolve city from URL, defaulting to nyc', { error: e?.message });
            return 'nyc';
        }
    }

    // ======== URL STATE HELPERS ========
    // Parse initial state (date/view/event) from URL and apply to loader
    parseStateFromUrl() {
        try {
            const url = new URL(window.location.href);
            const dateParam = url.searchParams.get('date');
            const viewParam = url.searchParams.get('view');
            const eventParam = url.searchParams.get('event');
            
            // View
            if (viewParam === 'week' || viewParam === 'month') {
                this.currentView = viewParam;
                // The static markup hardcodes WEEK as the active toggle and
                // nothing else ever syncs it from the URL — a deep-linked
                // month page kept the wrong underline forever.
                document.querySelectorAll('.view-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.getAttribute('data-view') === viewParam);
                });
            }
            
            // Date (YYYY-MM-DD)
            if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
                const parts = dateParam.split('-');
                const parsed = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
                if (!isNaN(parsed.getTime())) {
                    this.currentDate = parsed;
                }
            }
            
            // Event selection from URL (no slug->date inference)
            if (eventParam) {
                this.selectedEventSlug = eventParam;
                // If date provided, bind selection to that date; else leave date undefined
                if (url.searchParams.get('date')) {
                    this.selectedEventDateISO = url.searchParams.get('date');
                }
            }
        } catch (e) {
            logger.warn('CALENDAR', 'Failed to parse state from URL', { error: e?.message });
        }
    }
    
    // Build ISO date string from Date
    formatDateToISO(date) {
        try {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        } catch (_) {
            return '';
        }
    }
    
    // Sync current state to URL (replaceState to avoid history spam)
    syncUrl(replace = true) {
        try {
            const url = new URL(window.location.href);
            // Always ensure we are at the city path; preserve other params except we control these keys
            const params = url.searchParams;
            // View + date
            params.set('view', this.currentView);
            params.set('date', this.formatDateToISO(this.currentDate));
            
            // Event parameter only when selected
            if (this.selectedEventSlug) {
                params.set('event', this.selectedEventSlug);
            } else {
                params.delete('event');
            }
            
            // Apply and replace
            const newUrl = `${url.pathname}?${params.toString()}${url.hash || ''}`;
            if (replace) {
                history.replaceState({}, '', newUrl);
            } else {
                history.pushState({}, '', newUrl);
            }
            logger.debug('CALENDAR', 'URL synced', { url: newUrl, view: this.currentView, date: params.get('date'), event: params.get('event') || null });
        } catch (e) {
            logger.warn('CALENDAR', 'Failed to sync URL', { error: e?.message });
        }
    }
    
    // Clear current event selection
    clearEventSelection() {
        const hadSelection = !!this.selectedEventSlug;
        const previousSlug = this.selectedEventSlug;
        this.selectedEventSlug = null;
        this.selectedEventDateISO = null;
        if (hadSelection) {
            logger.userInteraction('EVENT', 'Event selection cleared', { previousSlug });
            // Update visual selection state across all views
            this.updateSelectionVisualState();
        }
    }
    
    // Toggle/select event for URL/state.
    // options.deferUrl: skip the URL write — the caller owns it (the mobile
    // rail selects live while the finger is still down and must not spam
    // history.replaceState per frame; it flushes one syncUrl on settle).
    toggleEventSelection(eventSlug, eventDateISO, options = {}) {
        if (!eventSlug) return;
        const normalizedDateISO = eventDateISO && /^\d{4}-\d{2}-\d{2}$/.test(eventDateISO) ? eventDateISO : this.formatDateToISO(this.currentDate);
        
        // Check if this event is already selected
        const wasAlreadySelected = this.selectedEventSlug === eventSlug && this.selectedEventDateISO === normalizedDateISO;
        
        logger.debug('EVENT', 'Toggle event selection', {
            eventSlug,
            date: normalizedDateISO,
            wasAlreadySelected,
            currentSelection: this.selectedEventSlug
        });
        
        // Always clear current selection first (but don't call updateSelectionVisualState yet)
        const hadSelection = !!this.selectedEventSlug;
        const previousSlug = this.selectedEventSlug;
        this.selectedEventSlug = null;
        this.selectedEventDateISO = null;
        
        // If the clicked event wasn't already selected, select it
        if (!wasAlreadySelected) {
            this.selectedEventSlug = eventSlug;
            this.selectedEventDateISO = normalizedDateISO;
            // currentDate is now the VISIBLE WINDOW's anchor (continuous
            // strip) — an in-window selection must not move it (it used to
            // shift the week to start on the tapped day, and the tap's own
            // settle then churned the whole panel). A selection OUTSIDE the
            // window slides the week strip to include it, or re-anchors the
            // month.
            const parts = normalizedDateISO.split('-');
            const parsed = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            // deferUrl marks RAIL-driven live selections: the user is mid
            // card-swipe, so the calendar must never slide or re-anchor
            // under them regardless of which occurrence's date resolved
            if (!isNaN(parsed.getTime()) && !options.deferUrl) {
                const { start, end } = this.getCurrentPeriodBounds();
                if (parsed < start || parsed > end) {
                    if (this.currentView === 'week') {
                        this.scrollWeekStripToDate(parsed);
                    } else {
                        this.currentDate = parsed;
                    }
                }
            }
            logger.userInteraction('EVENT', 'Event selected', { eventSlug, date: normalizedDateISO });
        } else {
            logger.userInteraction('EVENT', 'Event deselected (was already selected)', { eventSlug, date: normalizedDateISO });
        }
        
        // Update visual selection state once (handles both selection and deselection)
        this.updateSelectionVisualState();

        // Reflect selection in URL
        if (!options.deferUrl) {
            this.syncUrl(true);
        }
    }

    // Update visual selection state across all views (calendar, list, map)
    updateSelectionVisualState() {
        logger.debug('EVENT', 'Updating visual selection state', {
            selectedEventSlug: this.selectedEventSlug,
            mapExists: !!window.eventsMap,
            markersBySlugExists: !!window.eventsMapMarkersBySlug
        });
        
        // Clear all previous selections
        const selectedElements = document.querySelectorAll('.event-card.selected, .event-item.selected');
        logger.debug('EVENT', 'Clearing previous selections', { 
            count: selectedElements.length,
            elements: Array.from(selectedElements).map(el => ({
                tagName: el.tagName,
                className: el.className,
                dataSlug: el.getAttribute('data-event-slug')
            }))
        });
        selectedElements.forEach(el => {
            el.classList.remove('selected');
        });
        
        const eventsList = document.querySelector('.events-list');

        if (this.selectedEventSlug) {
            // Mark selected event card in list view
            // prefer the card for the SELECTED occurrence (the timeline rail
            // holds one card per occurrence); slug-only remains the fallback
            const slugSel = `.event-card[data-event-slug="${CSS.escape(this.selectedEventSlug)}"]`;
            const selectedCard = (this.selectedEventDateISO
                    && document.querySelector(`${slugSel}[data-occurrence="${CSS.escape(this.selectedEventDateISO)}"]`))
                || document.querySelector(slugSel);
            if (selectedCard) {
                selectedCard.classList.add('selected');
                this.ensureFlyerLoaded(selectedCard);
            }

            if (eventsList) {
                eventsList.classList.add('selection-mode');
            }
            
            // Mark the selected OCCURRENCE's pill in the calendar — the strip
            // renders a weekly event once per week, and marking every pill
            // with the slug lit them all, so the in-window occurrence read as
            // "the" selection even when a past/future one was chosen. The
            // pill's day cell carries data-date; slug-wide stays the fallback
            // for a selection without a date.
            const slugItems = document.querySelectorAll(`.event-item[data-event-slug="${CSS.escape(this.selectedEventSlug)}"]`);
            let calendarItems = [];
            if (this.selectedEventDateISO) {
                calendarItems = Array.from(slugItems).filter(item => {
                    const dayEl = item.closest('[data-date]');
                    return dayEl && dayEl.getAttribute('data-date') === this.selectedEventDateISO;
                });
            }
            if (calendarItems.length === 0) calendarItems = Array.from(slugItems);
            calendarItems.forEach(item => {
                item.classList.add('selected');
            });
            
            // Highlight map marker
            this.highlightMapMarker(this.selectedEventSlug);
            
            logger.debug('EVENT', 'Updated selection visual state', { 
                selectedSlug: this.selectedEventSlug,
                cardFound: !!selectedCard,
                calendarItemsFound: calendarItems.length,
                cardElement: selectedCard ? {
                    tagName: selectedCard.tagName,
                    className: selectedCard.className,
                    dataSlug: selectedCard.getAttribute('data-event-slug')
                } : null
            });
        } else {
            if (eventsList) {
                eventsList.classList.remove('selection-mode');
            }

            // Reset all markers to normal appearance
            this.resetAllMapMarkers();
            
            // Explicitly ensure all calendar event items are unselected
            // This is important to handle cases where the calendar is re-rendered
            const allCalendarItems = document.querySelectorAll('.event-item');
            logger.debug('EVENT', 'Explicitly clearing all calendar items', { 
                count: allCalendarItems.length,
                items: Array.from(allCalendarItems).map(item => ({
                    tagName: item.tagName,
                    className: item.className,
                    dataSlug: item.getAttribute('data-event-slug'),
                    hasSelected: item.classList.contains('selected')
                }))
            });
            allCalendarItems.forEach(item => {
                item.classList.remove('selected');
            });
            
            logger.debug('EVENT', 'Cleared all selections and ensured calendar events are unselected');
        }

        // Selection changed and every view is painted — modules that layer on
        // top (the mobile rail) listen for this instead of observing the DOM
        document.dispatchEvent(new CustomEvent('chunky:selection-changed', {
            detail: { slug: this.selectedEventSlug, dateISO: this.selectedEventDateISO }
        }));
    }

    // Lazily create the flyer <img> the first time a card is selected.
    // Deselection re-hides it via CSS; a load failure walks the remaining
    // candidates (see advanceFlyerImage) before the container is removed.
    ensureFlyerLoaded(selectedCard) {
        const flyer = selectedCard.querySelector('.event-flyer[data-flyer-url]');
        if (!flyer || flyer.querySelector('img')) {
            return;
        }
        const img = document.createElement('img');
        img.alt = 'event flyer';
        img.decoding = 'async';
        img.onerror = () => advanceFlyerImage(img);
        img.src = flyer.getAttribute('data-flyer-url');
        flyer.appendChild(img);
    }

    

    // Helper method to highlight a specific map marker
    highlightMapMarker(eventSlug) {
        if (!window.eventsMap || !window.eventsMapMarkersBySlug) {
            logger.debug('MAP', 'Cannot highlight map marker - map or markers not ready', {
                eventSlug,
                mapExists: !!window.eventsMap,
                markersBySlugExists: !!window.eventsMapMarkersBySlug
            });
            return;
        }
        
        // If the selected event doesn't have a map marker, dim all markers (selection is still active)
        if (!window.eventsMapMarkersBySlug[eventSlug]) {
            logger.debug('MAP', 'Selected event has no map marker, dimming all markers', { eventSlug });
            // Dim all markers since selection is active but no marker is selected
            Object.values(window.eventsMapMarkersBySlug).forEach(marker => {
                if (marker.getElement()) {
                    marker.getElement().classList.remove('marker-selected');
                    marker.getElement().classList.add('marker-dimmed');
                }
            });
            logger.userInteraction('MAP', 'All markers dimmed (selection active but no marker selected)', { eventSlug });
            applyMapSoloVisibility();
            return;
        }
        
        // Use CSS classes instead of inline styles
        if (window.eventsMapMarkersBySlug) {
            Object.entries(window.eventsMapMarkersBySlug).forEach(([slug, marker]) => {
                if (marker.getElement()) {
                    // Remove all marker state classes
                    marker.getElement().classList.remove('marker-selected', 'marker-dimmed');
                    
                    if (slug === eventSlug) {
                        // Highlight the selected marker
                        marker.getElement().classList.add('marker-selected');
                    } else {
                        // Dim unselected markers
                        marker.getElement().classList.add('marker-dimmed');
                    }
                }
            });
        }
        
        logger.debug('MAP', 'Selected marker highlighted, unselected markers dimmed', { eventSlug });
        logger.userInteraction('MAP', 'Marker highlighted and unselected markers dimmed', { eventSlug });
        applyMapSoloVisibility();
    }

    // Helper method to reset all map markers to normal appearance
    resetAllMapMarkers() {
        if (window.eventsMapMarkersBySlug) {
            const markerCount = Object.keys(window.eventsMapMarkersBySlug).length;
            Object.values(window.eventsMapMarkersBySlug).forEach(marker => {
                if (marker.getElement()) {
                    // Remove all marker state classes
                    marker.getElement().classList.remove('marker-selected', 'marker-dimmed');
                }
            });
            logger.debug('MAP', 'All markers reset to normal appearance', { markerCount });
            logger.userInteraction('MAP', 'All map markers reset to normal appearance', { markerCount });
        }
        applyMapSoloVisibility();
    }


    // Helper: detect slug from first path segment, similar to app-level logic
    getCitySlugFromPath() {
        try {
            const path = window.location.pathname || '/';
            const parts = path.split('/').filter(Boolean);
            if (parts.length === 0) return null;
            const candidates = [];
            if (parts.length >= 1) candidates.push(parts[0].toLowerCase());
            if (parts.length >= 2 && parts[1].toLowerCase() !== 'index.html') candidates.push(parts[1].toLowerCase());
            const cityConfig = (typeof window !== 'undefined' && window.CITY_CONFIG) ? window.CITY_CONFIG : {};
            for (const slug of candidates) {
                if (cityConfig && cityConfig[slug]) return slug;
                for (const [key, cfg] of Object.entries(cityConfig || {})) {
                    if (cfg && Array.isArray(cfg.aliases)) {
                        if (cfg.aliases.map(a => String(a).toLowerCase()).includes(slug)) return key;
                    }
                }
            }
            return null;
        } catch (_) {
            return null;
        }
    }

    // Set up city selector and populate with available cities
    setupCitySelector() {
        const availableCitiesList = document.getElementById('available-cities-list');
        


        // Populate available cities list for error page
        if (availableCitiesList) {
            availableCitiesList.innerHTML = getAvailableCities()
                .filter(city => hasCityCalendar(city.key))
                .map(city => `
                    <a href="${city.key}/" class="city-link">
                        ${city.emoji} ${city.name}
                    </a>
                `).join('');
        }
    }

    // Show error when city is not found or unavailable
    showCityNotFound() {
        const cityNotFound = document.querySelector('.city-not-found');
        const cityPage = document.querySelector('.city-page');
        
        if (cityNotFound && cityPage) {
            cityNotFound.style.display = 'block';
            cityPage.style.display = 'none';
        }
        
        document.title = 'City Not Found - chunky.dad';
    }


    // Override parseEventData to add city-specific data and short-name
    parseEventData(calendarEvent) {
        const eventData = super.parseEventData(calendarEvent);
        if (eventData) {
            eventData.citySlug = this.currentCity;
            
            // Only generate short-name if not provided by user
            // This prevents double-trimming when user has already provided a shortName
            if (!eventData.shortName) {
                eventData.shortName = eventData.name || eventData.bar || '';
            }
            
            // Convert image URLs based on data source. Every flyer slot is
            // rewritten, not just the primary — filenames are content-hash
            // derived, so two candidates for one event never collide.
            IMAGE_SLOT_FIELDS.forEach(field => {
                const originalImageUrl = eventData[field];
                if (!originalImageUrl) return;
                if (this.dataSource === 'cached') {
                    // Remember where this slot CAME FROM before the rewrite.
                    // The local filename is a hash of the full URL, so two
                    // delivery variants of one stored file (…/x.jpg?rect=A and
                    // …/x.jpg?rect=B) land on two unrelated local paths and
                    // nothing downstream can tell they are the same artwork.
                    // getFlyerCandidates needs that fact to refuse a crop of
                    // the image it already has. Underscore-prefixed, so
                    // formatEventNotes can never write it to a calendar.
                    if (!eventData._imageSourceUrls) eventData._imageSourceUrls = {};
                    eventData._imageSourceUrls[field] = originalImageUrl;
                    eventData[field] = this.convertImageUrlToLocal(originalImageUrl, eventData);

                    logger.debug('CALENDAR', 'Converted image URL for cached data', {
                        eventName: eventData.name,
                        field,
                        originalUrl: originalImageUrl,
                        localPath: eventData[field],
                        dataSource: this.dataSource
                    });
                } else if (this.dataSource === 'proxy' || this.dataSource === 'fallback') {
                    logger.debug('CALENDAR', 'Using external image URL for external data', {
                        eventName: eventData.name,
                        field,
                        imageUrl: originalImageUrl,
                        dataSource: this.dataSource
                    });
                }
            });
        }
        return eventData;
    }


    // ========== SOFT HYPHENATION METHODS ==========
    
    /**
     * Insert soft hyphens at intelligent break points
     * @param {string} text - The text to process
     * @param {boolean} isShortName - Whether this is a shortened name (affects hyphenation strategy)
     * @returns {string} Text with soft hyphens inserted
     */
    insertSoftHyphens(text, isShortName = false) {
        if (!text) return text;
        
        // For shortName: unescaped '-' => &shy;, '\-' stays '-'
        if (isShortName) {
            const softHyphen = '&shy;';
            let processed = text.replace(/\\-/g, '§HARD_HYPHEN§');
            processed = processed.replace(/-/g, softHyphen);
            return processed.replace(/§HARD_HYPHEN§/g, '-');
        }
        
        // For fullName: unchanged
        return text;
    }
    

    




    getSmartEventNameForBreakpoint(event, breakpoint) {
        logger.info('CALENDAR', `🔍 SMART_NAME: Starting getSmartEventNameForBreakpoint for breakpoint: ${breakpoint}`);
        
        const fullName = event.name || '';
        const shorterName = event.shorter || '';
        const shortName = event.shortName || event.nickname || '';
        
        logger.info('CALENDAR', `🔍 SMART_NAME: Event names`, { fullName, shorterName, shortName, breakpoint });
        
        const charsPerPixel = this.charsPerPixel || this.calculateCharsPerPixel();
        const availableWidth = this.getEventTextWidth();
        
        logger.info('CALENDAR', `🔍 SMART_NAME: Got measurement data`, {
            charsPerPixel: charsPerPixel?.toFixed(4),
            availableWidth: availableWidth?.toFixed(2),
            breakpoint
        });
        
        // Measurement not ready → use full name as fallback
        if (availableWidth === null) {
            logger.debug('CALENDAR', `🔍 SMART_NAME: Measurement not ready, using fullName as fallback`);
            return fullName;
        }
        
        const charLimitPerLine = Math.floor(availableWidth * charsPerPixel);
        
        logger.info('CALENDAR', `🔍 SMART_NAME: Character limit calculation`, {
            availableWidth: availableWidth?.toFixed(2),
            charsPerPixel: charsPerPixel?.toFixed(4),
            charLimitPerLine,
            fullNameLength: fullName.length,
            shorterNameLength: shorterName?.length || 0,
            shortNameLength: shortName?.length || 0
        });
        
        // Check if the name can fit properly by considering word wrapping
        // For names longer than one line, we need to be more conservative
        const canFitInOneLineWithBreaking = (name) => {
            // If the entire name fits in one line, it's definitely okay
            if (name.length <= charLimitPerLine) {
                return true;
            }
            
            // For longer names, check if they can break nicely across lines
            // We need to account for word boundaries and hyphenation
            const words = name.split(/[\s-]+/);
            const longestWord = Math.max(...words.map(word => word.length));
            
            // If the longest word fits in one line, the name can wrap
            return longestWord <= charLimitPerLine;
        };
        
        // 1. Use full title if it can fit properly with word wrapping
        if (canFitInOneLineWithBreaking(fullName)) {
            logger.info('CALENDAR', `🔍 SMART_NAME: Full title can fit with proper wrapping, using: "${fullName}"`);
            return fullName;
        }
        
        // 2. Use shorter name if we have one and it fits properly
        if (shorterName && canFitInOneLineWithBreaking(shorterName)) {
            logger.info('CALENDAR', `🔍 SMART_NAME: Shorter name fits with proper wrapping, using: "${shorterName}"`);
            return shorterName;
        }
        
        // 3. Otherwise use short name with soft hyphens (fallback)
        if (shortName) {
            logger.info('CALENDAR', `🔍 SMART_NAME: Using short name with soft hyphens: "${shortName}"`);
            return this.insertSoftHyphens(shortName, true);
        }
        
        // Final fallback to full name
        logger.info('CALENDAR', `🔍 SMART_NAME: No short names available, using full name as final fallback: "${fullName}"`);
        return fullName;
    }



    


    // Calculate characters per pixel ratio for dynamic text fitting
    calculateCharsPerPixel() {
        logger.info('CALENDAR', '🔍 CALCULATION: Starting calculateCharsPerPixel()');
        
        try {
            // Create a temporary element to measure character width
            const testElement = document.createElement('div');
            testElement.className = 'event-name'; // Use the same class as actual event names
            testElement.style.cssText = `
                position: absolute;
                visibility: hidden;
                white-space: nowrap;
                font-family: 'Poppins', sans-serif;
                font-size: var(--event-name-font-size);
                font-weight: var(--event-name-font-weight);
                line-height: var(--event-name-line-height);
            `;
            
            // Use a string that better represents actual event names 
            // Focus on uppercase letters without spaces (spaces are narrow and skew the average)
            const testString = 'BEARHAPPYHOURNIGHTOUTWEEKLYSOCIALEVENTS';
            testElement.textContent = testString;
            document.body.appendChild(testElement);
            
            const width = testElement.getBoundingClientRect().width;
            const charCount = testElement.textContent.length;
            const pixelsPerChar = width / charCount;
            // Apply defensive reduction of 0.02 to prevent edge overflow
            const charsPerPixel = (1 / pixelsPerChar) - 0.02;
            
            // Get the computed styles to verify what we're actually using
            const computedStyles = window.getComputedStyle(testElement);
            const actualFontSize = computedStyles.fontSize;
            const actualFontWeight = computedStyles.fontWeight;
            const actualFontFamily = computedStyles.fontFamily;
            
            // Get visual zoom for logging purposes only - don't adjust calculation
            const visualZoom = (window.visualViewport && window.visualViewport.scale) || 1;
            
            document.body.removeChild(testElement);
            
            logger.info('CALENDAR', `🔍 CALCULATION: Calculated chars per pixel: ${charsPerPixel.toFixed(4)} (${pixelsPerChar.toFixed(2)}px per char, zoom: ${visualZoom.toFixed(2)})`, {
                width: width.toFixed(2),
                charCount,
                pixelsPerChar: pixelsPerChar.toFixed(2),
                charsPerPixel: charsPerPixel.toFixed(4),
                visualZoom: visualZoom.toFixed(2),
                zoomDirection: visualZoom > 1 ? 'zoomed in' : visualZoom < 1 ? 'zoomed out' : 'normal',
                actualFontSize,
                actualFontWeight,
                actualFontFamily,
                screenWidth: window.innerWidth,
                testString: testString,
                note: 'Base calculation with 0.02 defensive reduction applied directly to charsPerPixel'
            });
            
            // Cache the result
            this.charsPerPixel = charsPerPixel;
            logger.info('CALENDAR', `🔍 CALCULATION: Cached charsPerPixel = ${charsPerPixel.toFixed(4)}`);
            return charsPerPixel;
        } catch (error) {
            logger.componentError('CALENDAR', 'Error calculating chars per pixel', error);
            return 0.1; // Conservative fallback
        }
    }

    // Get the actual width available for event text from the fake event rendered invisibly
    getEventTextWidth() {
        logger.info('CALENDAR', '🔍 MEASUREMENT: Starting getEventTextWidth()');
        
        // Check if we already have a cached measurement
        if (this.cachedEventTextWidth) {
            logger.info('CALENDAR', `🔍 MEASUREMENT: Using cached event text width: ${this.cachedEventTextWidth}px`);
            return this.cachedEventTextWidth;
        }
        
        // Find ALL event-name elements to understand what we're measuring
        const allEventNames = document.querySelectorAll('.event-name');
        logger.info('CALENDAR', `🔍 MEASUREMENT: Found ${allEventNames.length} .event-name elements`);
        
        // Find the first visible event-name element (should be our measurement element)
        const eventName = document.querySelector('.event-name');
        
        // If the element doesn't exist yet, we can't measure - return null to indicate measurement not ready
        if (!eventName) {
            logger.debug('CALENDAR', '🔍 MEASUREMENT: Event name element not found for measurement - DOM not ready yet');
            return null;
        }
        
        // Log details about the element we're measuring
        const isVisible = eventName.offsetParent !== null;
        const hasContent = eventName.textContent && eventName.textContent.trim().length > 0;
        
        logger.info('CALENDAR', `🔍 MEASUREMENT: Measuring event-name element`, {
            elementFound: true,
            isVisible,
            hasContent,
            textContent: eventName.textContent,
            tagName: eventName.tagName,
            className: eventName.className
        });
        
        // Measure the event name element directly - this IS the text container
        const eventNameRect = eventName.getBoundingClientRect();
        const eventNameStyle = window.getComputedStyle(eventName);
        const paddingLeft = parseFloat(eventNameStyle.paddingLeft) || 0;
        const paddingRight = parseFloat(eventNameStyle.paddingRight) || 0;
        const borderLeft = parseFloat(eventNameStyle.borderLeftWidth) || 0;
        const borderRight = parseFloat(eventNameStyle.borderRightWidth) || 0;
        
        // Calculate the actual available width for text content
        const rawAvailableWidth = eventNameRect.width - paddingLeft - paddingRight - borderLeft - borderRight;
        
        // No defensive padding applied to width - defensive reduction is applied directly to charsPerPixel calculation
        const availableWidth = rawAvailableWidth;
        
        this.cachedEventTextWidth = Math.max(availableWidth, 20); // Minimum 20px
        
        logger.info('CALENDAR', `🔍 MEASUREMENT: Measured actual event text width from .event-name element: ${this.cachedEventTextWidth}px`, {
            elementRect: {
                width: eventNameRect.width,
                height: eventNameRect.height,
                left: eventNameRect.left,
                top: eventNameRect.top
            },
            computedStyle: {
                paddingLeft,
                paddingRight,
                borderLeft,
                borderRight,
                fontSize: eventNameStyle.fontSize,
                fontWeight: eventNameStyle.fontWeight,
                fontFamily: eventNameStyle.fontFamily
            },
            calculations: {
                rawWidth: eventNameRect.width,
                totalPadding: paddingLeft + paddingRight,
                totalBorders: borderLeft + borderRight,
                rawAvailableWidth: rawAvailableWidth,
                finalAvailableWidth: availableWidth,
                finalCachedWidth: this.cachedEventTextWidth,
                note: 'No width padding applied - defensive reduction applied directly to charsPerPixel'
            }
        });
        
        return this.cachedEventTextWidth;
    }

    // Clear cached measurements (call when layout changes)
    clearMeasurementCache() {
        const hadCachedWidth = !!this.cachedEventTextWidth;
        const hadCharsPerPixel = !!this.charsPerPixel;
        
        this.cachedEventTextWidth = null;
        this.charsPerPixel = null;
        
        logger.info('CALENDAR', '🔍 CACHE_CLEAR: Measurement cache cleared', {
            hadCachedWidth,
            hadCharsPerPixel,
            reason: 'layout_change'
        });
    }

    // Clear cached event names (call when screen size changes)
    clearEventNameCache() {
        const cacheSize = this.cachedEventNames.size;
        this.cachedEventNames.clear();
        
        logger.info('CALENDAR', '🔍 CACHE_CLEAR: Event name cache cleared', {
            previousCacheSize: cacheSize,
            reason: 'screen_size_change'
        });
    }

    // Get current breakpoint based on screen width
    getCurrentBreakpoint() {
        const width = window.innerWidth;
        if (width <= 374) return 'xs';
        if (width <= 767) return 'sm'; 
        if (width <= 1023) return 'md';
        return 'lg';
    }


    
    // Generate event name element for current breakpoint only
    generateEventNameElements(event, hideEvents = false) {
        const fullName = event.name || '';
        const hasShortName = !!(event.shortName || event.nickname);
        
        logger.info('CALENDAR', `🔍 EVENT_NAME_GEN: Generating event name elements`, {
            eventName: fullName,
            hasShortName,
            hideEvents,
            mode: hideEvents ? 'MEASUREMENT' : 'DISPLAY'
        });
        
        // For measurement mode, use full name to get accurate width measurement
        // This gives us a realistic event name length for proper width calculation
        if (hideEvents) {
            logger.info('CALENDAR', '🔍 EVENT_NAME_GEN: Measurement mode - using full name for accurate measurement', {
                eventName: fullName,
                shortName: event.shortName || event.nickname || '',
                hideEvents: true,
                reason: 'measurement_mode_uses_full_name'
            });
            return `<div class="event-name">${fullName}</div>`;
        }
        
        // DISPLAY MODE: Use full smart name logic with caching
        
        // If no shortname, just return the full name
        if (!hasShortName) {
            logger.info('CALENDAR', '🔍 EVENT_NAME_GEN: No shortname available, using full name', {
                eventName: fullName,
                hideEvents,
                reason: 'no_shortname_available'
            });
            return `<div class="event-name">${fullName}</div>`;
        }
        
        // Create a cache key for this event + current breakpoint
        const eventKey = `${event.name || ''}-${event.shortName || ''}-${event.nickname || ''}-${this.currentBreakpoint}`;
        
        // For display mode, check cache first
        if (this.cachedEventNames.has(eventKey)) {
            const cachedName = this.cachedEventNames.get(eventKey);
            logger.info('CALENDAR', '🔍 EVENT_NAME_GEN: Using cached event name', { 
                eventKey, 
                breakpoint: this.currentBreakpoint, 
                cachedName: cachedName,
                hideEvents: false,
                source: 'cache'
            });
            return `<div class="event-name">${cachedName}</div>`;
        }
        
        // Calculate name for current breakpoint (display mode only)
        logger.info('CALENDAR', '🔍 EVENT_NAME_GEN: Calculating event name for current breakpoint', { 
            eventKey, 
            breakpoint: this.currentBreakpoint,
            hideEvents,
            source: 'fresh_calculation'
        });
        const eventName = this.getSmartEventNameForBreakpoint(event, this.currentBreakpoint);
        
        // Cache the result for display mode
        this.cachedEventNames.set(eventKey, eventName);
        logger.info('CALENDAR', '🔍 EVENT_NAME_GEN: Cached calculated event name', {
            eventKey,
            calculatedName: eventName,
            shortName: event.shortName || event.nickname || '',
            fullName: fullName,
            cached: true
        });
        
        return `<div class="event-name">${eventName}</div>`;
    }

    // Format time for mobile display with simplified format (4a-5p)
    formatTimeForMobile(timeString) {
        if (!timeString) return '';
        
        // Check if it's a time range
        const timeRangeRegex = /(\d{1,2}(?::\d{2})?(?:AM|PM))-(\d{1,2}(?::\d{2})?(?:AM|PM))/i;
        const match = timeString.match(timeRangeRegex);
        
        if (match) {
            const startTime = match[1];
            const endTime = match[2];
            return this.simplifyTimeFormat(startTime) + '-' + this.simplifyTimeFormat(endTime);
        }
        
        // For single times, just simplify
        return this.simplifyTimeFormat(timeString);
    }

    // Convert time format to simplified version (4 AM -> 4a, 5 PM -> 5p)
    simplifyTimeFormat(timeString) {
        if (!timeString) return '';
        
        return timeString.replace(/(\d{1,2}(?::\d{2})?)\s*(AM|PM)/gi, (match, time, period) => {
            return time + (period.toLowerCase() === 'am' ? 'a' : 'p');
        });
    }


    // Derive an event's favicon URL (local cached path or remote URL) from
    // event.favicon || event.website, or null when neither is available.
    // May throw on malformed URLs — callers handle errors.
    getEventFaviconUrl(event) {
        let faviconUrl = null;

        if (event.favicon) {
            let url = event.favicon;
            // Ensure URL has protocol
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }
            if (this.dataSource === 'cached' && !event.isTestEvent) {
                faviconUrl = window.FilenameUtils.convertWebsiteUrlToFaviconPath(url, '/img/favicons');
            } else {
                faviconUrl = url;
            }
        }

        if (!faviconUrl && event.website) {
            let url = event.website;
            // Ensure URL has protocol
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }
            // A website that is really a TICKETING page (Eventbrite, DICE, …)
            // would contribute the platform's glyph as this event's identity —
            // wrong on the card, wrong on the map. An explicitly curated
            // event.favicon above is always honoured; only the website-derived
            // fallback is filtered.
            const isPlatform = window.FilenameUtils.isPlatformFaviconUrl
                ? window.FilenameUtils.isPlatformFaviconUrl(url)
                : false;
            // A website that is really an IMAGE URL (a scraped flyer/CDN asset
            // that slipped into the field) is junk as an identity source —
            // convertWebsiteUrlToFaviconPath would adopt the image itself as
            // the "favicon". That treatment is right for an explicitly curated
            // event.favicon above, wrong for the website-derived fallback.
            const isImage = window.FilenameUtils.isImageUrl
                ? window.FilenameUtils.isImageUrl(url)
                : false;
            if (!isPlatform && !isImage) {
                faviconUrl = window.FilenameUtils.convertWebsiteUrlToFaviconPath(url, '/img/favicons');
            }
        }

        return faviconUrl || null;
    }

    // Small inline favicon chip for event rows; empty string when no favicon is available
    generateFaviconChipHtml(event) {
        let faviconUrl = null;
        try {
            faviconUrl = this.getEventFaviconUrl(event);
        } catch (error) {
            return '';
        }
        if (!faviconUrl) {
            return '';
        }
        return `<img class="event-favicon-chip" src="${faviconUrl}" alt="" loading="lazy" onerror="this.style.display='none'">`;
    }

    // Create marker icon with favicon or three letters
    createMarkerIcon(event) {
        if (event.favicon || event.website) {
            try {
                logger.debug('MAP', 'Creating favicon marker', {
                    eventName: event.name,
                    website: event.website,
                    favicon: event.favicon,
                    dataSource: this.dataSource
                });
                
                const faviconUrl = this.getEventFaviconUrl(event);

                let fallbackFaviconUrl = '';

                // We only do live google fallback on the test flow
                if (event.isTestEvent && !event.favicon && event.website) {
                    let url = event.website;
                    // Ensure URL has protocol
                    if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                    }
                    try {
                        const hostname = new URL(url).hostname;
                        fallbackFaviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
                    } catch(e) {}
                }
                
                const textFallback = this.getMarkerText(event);
                
                logger.debug('MAP', 'Favicon URL generated', {
                    website: event.website,
                    favicon: event.favicon,
                    faviconUrl,
                    fallbackFaviconUrl,
                    textFallback,
                    dataSource: this.dataSource
                });
                
                const el = document.createElement('div');
                el.className = 'favicon-marker';
                // Markers use the same plate as the card tiles (Stanley:
                // "Same for map btw!"), so one favicon looks like one object
                // wherever it appears.
                const markerPlate = this.getFaviconPlateForEvent(event);
                if (markerPlate) el.style.setProperty('--fav-plate', markerPlate);
                // Markers are often built BEFORE the colour file resolves, and
                // unlike cards they aren't re-rendered — so tag them with the
                // slug and let the colour load repaint them in place.
                if (event.slug) el.setAttribute('data-event-slug', event.slug);

                let onErrorStr = `this.parentElement.innerHTML='<span class=\\'marker-text\\'>${textFallback}</span>'; this.parentElement.classList.add('text-marker');`;
                if (fallbackFaviconUrl) {
                    onErrorStr = `this.onerror=function(){this.parentElement.innerHTML='<span class=\\'marker-text\\'>${textFallback}</span>'; this.parentElement.classList.add('text-marker');}; this.src='${fallbackFaviconUrl}';`;
                }

                el.innerHTML = `
                    <div class="favicon-marker-container">
                        <img src="${faviconUrl}" alt="venue" class="favicon-marker-icon"
                             onerror="${onErrorStr}">
                    </div>
                `;
                return el;
            } catch (error) {
                logger.warn('MAP', 'Failed to create favicon marker', { website: event.website, error: error.message });
            }
        }
        
        // Use text from shorter field or shortName or name
        const markerText = this.getMarkerText(event);
        const el = document.createElement('div');
        el.className = 'favicon-marker text-marker';
        el.innerHTML = `
            <div class="favicon-marker-container text-marker">
                <span class="marker-text">${markerText}</span>
            </div>
        `;
        return el;
    }

    // Get marker text from event data
    getMarkerText(event) {
        // Priority: shorter → shortName → name
        return event.shorter || this.insertSoftHyphens(event.shortName, true) || event.name || 'Event';
    }

    getCurrentPeriodBounds() {
        if (this.currentView === 'week') {
            // CONTINUOUS week: the visible 7-day window STARTS at currentDate
            // (any weekday) — the strip slides day-by-day, so the window is
            // no longer Sunday-aligned. calendar-core's getWeekBounds keeps
            // its Sunday semantics for the platform-shared consumers.
            const start = new Date(this.currentDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            end.setHours(23, 59, 59, 999);
            return { start, end };
        }
        return this.getMonthBounds(this.currentDate);
    }

    // Show events for a specific day (used by calendar overview)
    showDayEvents(dateString, events) {
        const date = new Date(dateString);
        
        // Create modal or popup to show events
        const modal = document.createElement('div');
        modal.className = 'day-events-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Events for ${date.toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        month: 'long', 
                        day: 'numeric' 
                    })}</h3>
                    <button class="modal-close" onclick="this.closest('.day-events-modal').remove()">&times;</button>
                </div>
                <div class="modal-body">
                    ${events.length > 0 
                        ? events.map(event => `
                                                            <div class="modal-event-item" data-event-slug="${event.slug}">
                                    <div class="event-name">${event.name}</div>
                                    <div class="event-details">
                                        ${event.time ? `<span class="event-time">${event.time}</span>` : ''}
                                        <span class="event-venue">${event.bar}</span>
                                        ${event.cover && event.cover.trim() && event.cover.toLowerCase() !== 'free' && event.cover.toLowerCase() !== 'no cover' ? `<span class="event-cover">${event.cover}</span>` : ''}
                                    </div>
                                </div>
                        `).join('')
                        : ''
                    }
                </div>
                <div class="modal-footer">
                    <button class="switch-to-week" onclick="window.calendarLoader.switchToWeekView('${dateString}')">
                        View Week
                    </button>
                </div>
            </div>
        `;
        
        // Add modal to page
        document.body.appendChild(modal);
        
        // Add click handler to close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    // Switch to week view for a specific date
    async switchToWeekView(dateString) {
        // parse LOCALLY ('YYYY-MM-DD' through new Date() is UTC midnight —
        // in western zones that's the PREVIOUS local day), and open the week
        // AS SHOWN in the month grid: its Sunday-aligned row
        const parts = String(dateString).split('-');
        let target = parts.length === 3
            ? new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
            : new Date(dateString);
        if (isNaN(target.getTime())) target = new Date();
        target.setDate(target.getDate() - target.getDay());
        target.setHours(0, 0, 0, 0);
        this.currentDate = target;
        this.currentView = 'week';
        
        // Update active button
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.view-btn[data-view="week"]').classList.add('active');
        
        // Remove modal
        document.querySelector('.day-events-modal')?.remove();
        
        // Clear current selection when jumping views
        this.clearEventSelection();
        await this.updateCalendarDisplay();
        this.syncUrl(true);
    }

    // Jump to week view centered on a date WITH an event selected — the
    // mobile month-full view navigates month pill → that event's week.
    // Not switchToWeekView: that path deliberately clears the selection.
    async openWeekAt(eventSlug, dateISO) {
        if (!eventSlug || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO || '')) return;
        const parts = dateISO.split('-');
        const parsed = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        if (isNaN(parsed.getTime())) return;
        // the window opens on the week AS SHOWN in the month grid (Sunday
        // row); the selection itself keeps the event's own date
        const windowStart = new Date(parsed);
        windowStart.setDate(windowStart.getDate() - windowStart.getDay());
        this.currentDate = windowStart;
        this.currentView = 'week';
        this.selectedEventSlug = eventSlug;
        this.selectedEventDateISO = dateISO;
        this.updateViewToggleActive();
        await this.updateCalendarDisplay();
        this.syncUrl(true);
    }

    // The first event AFTER the visible window (or the last one BEFORE it) —
    // what the mobile rail's edge slots point at.
    //
    // It searches by EVENT, not by week, on purpose: swiping off the end of
    // the rail must never land on an empty week (the owner's rule — the "no
    // events" card is somewhere you can walk to with the arrows, never
    // somewhere a swipe drops you), so quiet stretches are skipped and the
    // slot names the real event on the other side of them.
    //
    // maxDays bounds the recurrence expansion; a city with nothing in the next
    // six months simply gets no edge slot rather than an unbounded scan.
    findAdjacentEvent(direction, maxDays = 190, beyond = 'window') {
        if (!Array.isArray(this.allEvents) || this.allEvents.length === 0) return null;
        const forward = direction !== 'prev';
        let { start, end } = this.getCurrentPeriodBounds();
        // 'strip': the rail renders the whole grid strip, so its edge slots
        // must point past the STRIP, not past the visible window — otherwise
        // they duplicate cards already on the rail
        if (beyond === 'strip' && this.stripStartDate && this.currentView === 'week') {
            start = new Date(this.stripStartDate);
            start.setHours(0, 0, 0, 0);
            end = new Date(start);
            end.setDate(end.getDate() + this.stripDayCount - 1);
            end.setHours(23, 59, 59, 999);
        }

        let searchStart, searchEnd;
        if (forward) {
            searchStart = new Date(end.getTime() + 1000);
            searchEnd = new Date(searchStart);
            searchEnd.setDate(searchEnd.getDate() + maxDays);
        } else {
            searchEnd = new Date(start.getTime() - 1000);
            searchStart = new Date(searchEnd);
            searchStart.setDate(searchStart.getDate() - maxDays);
        }

        let candidates;
        try {
            candidates = this.getFilteredEvents({ start: searchStart, end: searchEnd });
        } catch (error) {
            logger.debug('CALENDAR', 'Adjacent-event lookup failed', { direction, error: error.message });
            return null;
        }

        // A multi-day run that straddles the window edge is already on screen —
        // only events wholly outside it count as "the next one".
        const outside = candidates.filter(event => {
            const logicalStart = this.getLogicalStartDate(event);
            if (!logicalStart) return false;
            if (forward) return logicalStart > end;
            const logicalEnd = this.getLogicalEndDate(event) || logicalStart;
            return logicalEnd < start;
        });
        if (outside.length === 0) return null;

        const pick = forward ? outside[0] : outside[outside.length - 1];
        const pickDate = this.getLogicalStartDate(pick);
        if (!pickDate) return null;
        const dateISO = this.getLocalDateKey(pickDate);

        // How many events share the week the swipe would open (the Sunday row
        // openWeekAt lands on), so the slot can say "and 3 more" rather than
        // pretending the week holds exactly one thing.
        let weekCount = 1;
        try {
            const weekStart = new Date(pickDate);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            weekStart.setHours(0, 0, 0, 0);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);
            weekEnd.setHours(23, 59, 59, 999);
            weekCount = this.getFilteredEvents({ start: weekStart, end: weekEnd }).length || 1;
        } catch (error) {
            weekCount = 1;
        }

        return {
            slug: pick.slug,
            dateISO,
            name: pick.name || '',
            date: pickDate,
            weekCount,
            // the full (occurrence-expanded) event, so the rail can render the
            // REAL card for it rather than a placeholder naming it
            event: pick
        };
    }

    // The rail's edge-card navigation. NOT openWeekAt: the visible window is
    // a CONTINUOUS 7 days (any start day — see getCurrentPeriodBounds), and
    // snapping to the target's Sunday-aligned week yanked the whole view to
    // dates the user never asked for. This shifts the window JUST far enough
    // to include the target — an Earlier event becomes the window's first
    // day, a Later event its last — so most of the visible days (and their
    // cards, via the sig-reuse render) survive the move, and the arrival
    // reads as a continuation of the swipe rather than a page change.
    //
    // The light path: no strip rebuild, no updateCalendarDisplay. The grid
    // repositions instantly (suppressed from re-settling), and
    // refreshEventsPanel does what it already does after a user scroll —
    // cards, selection paint, map, chunky:events-rendered. Off the strip or
    // near its rebuild edge, openWeekAt's full rebuild takes over.
    async revealAdjacent(eventSlug, dateISO, direction) {
        if (!eventSlug || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO || '')) return;
        const parts = dateISO.split('-');
        const parsed = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        if (isNaN(parsed.getTime())) return;
        const windowStart = new Date(parsed);
        if (direction !== 'prev') windowStart.setDate(windowStart.getDate() - 6);
        windowStart.setHours(0, 0, 0, 0);

        const grid = document.querySelector('.calendar-grid');
        if (this.currentView === 'week' && grid && this.stripStartDate && grid.scrollWidth > 0) {
            const idx = Math.round((windowStart - this.stripStartDate) / 86400000);
            if (idx >= 0 && idx <= this.stripDayCount - 7) {
                this.selectedEventSlug = eventSlug;
                this.selectedEventDateISO = dateISO;
                this.currentDate = windowStart;
                this.updateHeaderPeriodLabel();
                this.syncUrl(true);
                // glide, then refresh: the panel re-render (46 card sigs) must
                // not run mid-animation, and into-same-DOM reuse means the only
                // visible change during the glide is the days sliding
                await this.animateGridShift(grid, Math.round(idx * (grid.scrollWidth / this.stripDayCount)));
                this.sizeWeekStripHeight();
                await this.refreshEventsPanel(this.getFilteredEvents(), false, { keepCamera: true });
                return;
            }
            // OFF the strip (a month-away edge card): the near path glided and
            // this one SNAPPED (owner: "swiping a ton into the future does not
            // show the animation"). Rebuild the strip centred on the target
            // but ANCHORED so the days already on screen stay put — the
            // rebuild is invisible — then glide across the new strip exactly
            // like the near case. Only a jump longer than the strip itself
            // (~8 weeks) still snaps, in the clamped-glide sense.
            let oldStartISO = null;
            try { oldStartISO = this.getLocalDateKey(this.getCurrentPeriodBounds().start); } catch (e) {}
            this.selectedEventSlug = eventSlug;
            this.selectedEventDateISO = dateISO;
            this.currentDate = windowStart;
            if (oldStartISO) this.pendingStripAnchor = { dateKey: oldStartISO, offset: 0 };
            await this.updateCalendarDisplay();
            this.syncUrl(true);
            const grid2 = document.querySelector('.calendar-grid');
            if (grid2 && this.stripStartDate && grid2.scrollWidth > 0) {
                const idx2 = Math.max(0, Math.min(this.stripDayCount - 7,
                    Math.round((windowStart - this.stripStartDate) / 86400000)));
                await this.animateGridShift(grid2, Math.round(idx2 * (grid2.scrollWidth / this.stripDayCount)));
                this.sizeWeekStripHeight();
            }
            return;
        }
        await this.openWeekAt(eventSlug, dateISO);
    }

    // The days slide over as if flicked, instead of teleporting (owner: "it
    // just snaps ... instead of a natural swipe"). Hand-rolled scrollLeft per
    // frame because a concurrent UA smooth scroll is silently dropped while
    // the card rail's own snap is settling (reproduced 2026-08-31); the two
    // jank sources of the earlier glide are both handled here — scroll-snap
    // is OFF for the duration (proximity snap fought per-frame writes), and
    // the settle listener is suppressed until the glide lands. Ease-out, so
    // it reads as momentum from the swipe that caused it. A touch or wheel on
    // the grid cancels — the user's hand outranks the animation. Instant
    // under prefers-reduced-motion.
    animateGridShift(grid, targetLeft) {
        const startLeft = grid.scrollLeft;
        const distance = targetLeft - startLeft;
        const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (Math.abs(distance) < 2 || reduced) {
            this.suppressGridScrollUntil = performance.now() + 250;
            grid.scrollLeft = targetLeft;
            return Promise.resolve();
        }
        const dayW = grid.scrollWidth / this.stripDayCount;
        const duration = Math.max(220, Math.min(480, 90 * Math.abs(distance) / Math.max(1, dayW)));
        const savedSnap = grid.style.scrollSnapType;
        grid.style.scrollSnapType = 'none';
        const startTime = performance.now();
        const ease = t => 1 - Math.pow(1 - t, 3);
        return new Promise(resolve => {
            let raf = 0;
            const finish = () => {
                if (raf) cancelAnimationFrame(raf);
                grid.removeEventListener('touchstart', finish);
                grid.removeEventListener('wheel', finish);
                grid.style.scrollSnapType = savedSnap;
                resolve();
            };
            grid.addEventListener('touchstart', finish, { passive: true, once: true });
            grid.addEventListener('wheel', finish, { passive: true, once: true });
            const step = (now) => {
                const t = Math.min(1, (now - startTime) / duration);
                this.suppressGridScrollUntil = performance.now() + 250;
                grid.scrollLeft = Math.round(startLeft + distance * ease(t));
                if (t < 1) { raf = requestAnimationFrame(step); return; }
                raf = 0;
                finish();
            };
            raf = requestAnimationFrame(step);
        });
    }

    async navigatePeriod(direction, skipAnimation = false) {
        const delta = direction === 'next' ? 1 : -1;
        
        logger.userInteraction('CALENDAR', `Navigating ${direction} period`, {
            currentView: this.currentView,
            currentDate: this.currentDate.toISOString(),
            skipAnimation
        });
        
        if (this.currentView === 'week') {
            this.currentDate.setDate(this.currentDate.getDate() + (delta * 7));
        } else {
            // Prevent month skip when current day exceeds next month's length (e.g., Jan 31 -> Mar 3)
            const previousDay = this.currentDate.getDate();
            this.currentDate.setDate(1);
            this.currentDate.setMonth(this.currentDate.getMonth() + delta);
            const lastDayOfTargetMonth = new Date(
                this.currentDate.getFullYear(),
                this.currentDate.getMonth() + 1,
                0
            ).getDate();
            this.currentDate.setDate(Math.min(previousDay, lastDayOfTargetMonth));
        }
        
        // Changing period clears selection and syncs URL
        this.clearEventSelection();
        this.syncUrl(true);
        
        // Only update display immediately if not part of a swipe animation
        if (skipAnimation) {
            await this.updateCalendarDisplay();
        }
    }

    async goToToday() {
        this.currentDate = new Date();
        this.clearEventSelection();
        await this.updateCalendarDisplay();
        this.syncUrl(true);
    }

    formatDateRange(start, end) {
        // All-numeric (owner request): "8/16-22", "12/27 - 1/2", "9/2026" —
        // the header's fixed date slot can stay genuinely small because the
        // widest possible string is short and known.
        if (this.currentView === 'week') {
            // both ends always carry the month number — uniform string
            // shapes keep the fixed slot visually full in every week
            return `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
        }
        return `${start.getMonth() + 1}/${start.getFullYear()}`;
    }

    // Load calendar data for specific city (uses cached data from GitHub Actions)
    async loadCalendarData(cityKey) {
        const cityConfig = getCityConfig(cityKey);
        if (!cityConfig) {
            logger.componentError('CALENDAR', `No calendar configuration found for city: ${cityKey}`);
            return null;
        }
        
        // Check for proxy URL parameter - only use proxy when explicitly requested
        const urlParams = new URLSearchParams(window.location.search);
        const useProxy = urlParams.has('proxy');
        
        // Track data source for image URL conversion
        this.dataSource = 'cached'; // Default to cached, will be updated based on actual source used
        
        logger.time('CALENDAR', `Loading ${cityConfig.name} calendar data`);
        
        // If proxy parameter is set, skip cached data and go directly to proxy
        if (useProxy) {
            logger.info('CALENDAR', 'Proxy parameter detected - using proxy for calendar data');
            this.dataSource = 'proxy';
            const proxyResult = await this.loadCalendarDataViaProxy(cityKey, cityConfig);
            if (proxyResult) return proxyResult;
            this.dataSource = 'fallback';
            return this.loadCalendarDataFallback(cityKey, cityConfig);
        }
        
        // All cities use pre-processed JSON calendar data
        const isJsonCity = true;
        const ext = isJsonCity ? 'json' : 'ics';

        // Normal flow: Try to load cached calendar data first
        const cachedDataUrl = this.buildLocalCalendarUrl(cityKey, ext);
        
        try {
            logger.debug('CALENDAR', `Attempting to load cached calendar data`, {
                url: cachedDataUrl,
                city: cityConfig.name,
                method: 'cached_data_direct_fetch'
            });
            
            // Update loading message
            this.updateLoadingMessage(1, 'cached');
            
            const response = await fetch(cachedDataUrl, {
                method: 'GET',
                headers: {
                    'Accept': isJsonCity ? 'application/json' : 'text/calendar,text/plain,*/*'
                },
                cache: 'default' // Use browser cache for efficiency
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            if (isJsonCity) {
                const rawText = await response.text();

                const dateReviver = function(key, value) {
                    if ((key === 'startDate' || key === 'endDate' || key === 'recurrenceId') && value !== null) {
                        // JSON strings from the backend are formatted as local times without 'Z'
                        // (e.g. "YYYY-MM-DDTHH:mm:ss"). `new Date()` automatically parses this as
                        // the target city's local time, exactly preserving `.getHours()`.
                        return new Date(value);
                    }
                    return value;
                };

                const jsonData = JSON.parse(rawText, dateReviver);

                logger.debug('CALENDAR', `Cached JSON data retrieved, reviving...`, {
                    eventsLength: jsonData.events?.length
                });

                // Re-apply `_wasUTC` flag on Date objects for downstream logic
                const events = jsonData.events;
                if (events) {
                    events.forEach(event => {
                        if (event.wasUTC !== undefined) {
                            if (event.startDate) event.startDate._wasUTC = event.wasUTC;
                            if (event.endDate) event.endDate._wasUTC = event.wasUTC;
                        }
                    });
                }

                this.allEvents = events || [];

                // Merge multi-day festival events (from data/festivals.json) for this city
                await this.mergeFestivalEvents(cityKey, this.allEvents, events);

                // Set metadata to class properties so they are accessible
                if (jsonData.metadata) {
                    this.calendarTimezone = jsonData.metadata.calendarTimezone;
                    this.timezoneData = jsonData.metadata.timezoneData;
                }

                this.eventsData = {
                    cityConfig,
                    events,
                    calendarTimezone: this.calendarTimezone,
                    timezoneData: this.timezoneData
                };
            } else {
                const icalText = await response.text();

                // Validate that we got actual iCal data
                if (!icalText || !icalText.includes('BEGIN:VCALENDAR')) {
                    throw new Error('Invalid iCal data in cached file');
                }

                logger.apiCall('CALENDAR', `Successfully loaded cached calendar data`, {
                    dataLength: icalText.length,
                    city: cityConfig.name,
                    url: cachedDataUrl,
                    method: 'cached_data_success'
                });

                // Log sample of the fetched data for debugging
                logger.debug('CALENDAR', 'Cached iCal data validation', {
                    firstLine: icalText.split('\n')[0],
                    hasEvents: icalText.includes('BEGIN:VEVENT'),
                    eventCount: (icalText.match(/BEGIN:VEVENT/g) || []).length,
                    calendarName: icalText.match(/X-WR-CALNAME:(.+)/)?.[1]?.trim() || 'Unknown',
                    encoding: icalText.includes('BEGIN:VCALENDAR') ? 'Valid iCal' : 'Invalid format',
                    dataSize: `${(icalText.length / 1024).toFixed(1)}KB`,
                    source: 'cached_github_actions'
                });

                const events = this.parseICalData(icalText);

                // Store all events for filtering
                this.allEvents = events;

                this.eventsData = {
                    cityConfig,
                    events,
                    calendarTimezone: this.calendarTimezone,
                    timezoneData: this.timezoneData
                };
            }
            
            logger.timeEnd('CALENDAR', `Loading ${cityConfig.name} calendar data`);
            logger.componentLoad('CALENDAR', `Successfully processed cached calendar data for ${cityConfig.name}`, {
                eventCount: this.allEvents.length,
                cityKey,
                calendarTimezone: this.calendarTimezone,
                hasTimezoneData: !!this.timezoneData,
                method: 'cached_data_final_success',
                source: 'github_actions_cache',
                eventsDataStructure: {
                    hasCityConfig: !!this.eventsData.cityConfig,
                    hasEvents: !!this.eventsData.events,
                    eventsLength: this.eventsData.events?.length || 0,
                    cityConfigName: this.eventsData.cityConfig?.name || 'no name'
                }
            });
            
            return this.eventsData;
            
        } catch (error) {
            logger.warn('CALENDAR', 'Failed to load cached calendar data, trying fallback', {
                cityKey,
                cityName: cityConfig.name,
                cachedDataUrl,
                error: error.message,
                errorName: error.name,
                willTryFallback: true
            });
            
            // Fallback 1: try via CORS proxy providers
            try {
                this.dataSource = 'proxy';
                const proxyResult = await this.loadCalendarDataViaProxy(cityKey, cityConfig);
                if (proxyResult) {
                    return proxyResult;
                }
            } catch (proxyError) {
                logger.warn('CALENDAR', 'Proxy loading failed', {
                    cityKey,
                    cityName: cityConfig.name,
                    error: proxyError.message
                });
            }
            
            // Fallback 2: try to load directly from Google (will likely fail due to CORS, but worth trying)
            try {
                this.dataSource = 'fallback';
                return await this.loadCalendarDataFallback(cityKey, cityConfig);
            } catch (fallbackError) {
                logger.componentError('CALENDAR', 'All fallback methods failed', fallbackError);
                return null;
            }
        }
    }
    
    // Convert external image URL to local path for cached data
    convertImageUrlToLocal(imageUrl, eventData) {
        const filenameUtils = window.FilenameUtils;
        if (!filenameUtils || typeof filenameUtils.convertImageUrlToLocalPath !== 'function') {
            if (!this.hasWarnedMissingFilenameUtils) {
                this.hasWarnedMissingFilenameUtils = true;
                logger.warn('CALENDAR', 'FilenameUtils unavailable; using image URL as-is', {
                    city: this.currentCity,
                    dataSource: this.dataSource
                });
            }
            return imageUrl;
        }

        const eventInfo = {
            name: eventData.name,
            startDate: eventData.startDate,
            recurring: eventData.recurring
        };

        try {
            return filenameUtils.convertImageUrlToLocalPath(
                imageUrl,
                eventInfo,
                'img/events'
            );
        } catch (error) {
            logger.componentError('CALENDAR', 'Failed converting cached image URL; using original URL', error);
            return imageUrl;
        }
    }


    // Resolve correct local calendar URL depending on current page location
    buildLocalCalendarUrl(cityKey, ext = 'ics') {
        try {
            const pathname = window.location.pathname || '';
            
            // Use PathUtils if available for consistent path resolution
            if (window.pathUtils) {
                return window.pathUtils.resolvePath(`data/calendars/${cityKey}.${ext}`);
            }
            
            // Fallback logic for path detection
            // Test pages are served under /testing/, need to go up one level
            const isTesting = pathname.includes('/testing/');
            
            // City subdirectories (like /nyc/, /seattle/) need to go up one level
            const pathSegments = pathname.split('/').filter(Boolean);
            const isInCitySubdirectory = pathSegments.length > 0 && 
                window.CITY_CONFIG && 
                window.CITY_CONFIG[pathSegments[0].toLowerCase()];
            
            const needsParentPath = isTesting || isInCitySubdirectory;
            const prefix = needsParentPath ? '../' : '';
            
            return `${prefix}data/calendars/${cityKey}.${ext}`;
        } catch (e) {
            // Safe fallback
            return `data/calendars/${cityKey}.ics`;
        }
    }

    // Resolve festivals.json URL depending on current page location
    // (same path-prefix logic as buildLocalCalendarUrl so it works from /nyc/ subdirectories)
    buildFestivalsUrl() {
        try {
            const pathname = window.location.pathname || '';

            // Use PathUtils if available for consistent path resolution
            if (window.pathUtils) {
                return window.pathUtils.resolvePath('data/festivals.json');
            }

            // Fallback logic for path detection
            const isTesting = pathname.includes('/testing/');
            const pathSegments = pathname.split('/').filter(Boolean);
            const isInCitySubdirectory = pathSegments.length > 0 &&
                window.CITY_CONFIG &&
                window.CITY_CONFIG[pathSegments[0].toLowerCase()];

            const needsParentPath = isTesting || isInCitySubdirectory;
            const prefix = needsParentPath ? '../' : '';

            return `${prefix}data/festivals.json`;
        } catch (e) {
            // Safe fallback
            return 'data/festivals.json';
        }
    }

    // Fetch data/festivals.json once per page load (promise cached on the instance)
    fetchFestivalsData() {
        if (this.festivalsDataPromise) {
            return this.festivalsDataPromise;
        }
        this.festivalsDataPromise = fetch(this.buildFestivalsUrl(), {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            cache: 'default'
        }).then(response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.json();
        }).then(data => (data && Array.isArray(data.festivals)) ? data.festivals : []);
        return this.festivalsDataPromise;
    }

    // Merge multi-day festival events for this city into the loaded event arrays.
    // Fail open: on any fetch/parse error the page works exactly as before, with no festivals.
    async mergeFestivalEvents(cityKey, ...targetArrays) {
        let festivals;
        try {
            festivals = await this.fetchFestivalsData();
        } catch (error) {
            console.warn('Failed to load data/festivals.json for calendar merge — skipping festivals', error);
            return;
        }

        try {
            const normalizeName = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const now = new Date();
            const pastCutoff = now.getTime() - (7 * 24 * 60 * 60 * 1000); // 1 week ago
            const existingEvents = Array.isArray(this.allEvents) ? this.allEvents : [];
            const mappedEvents = [];

            for (const festival of festivals) {
                if (!festival || festival.cityKey !== cityKey) continue;
                // Undated festivals cannot be placed on a calendar
                if (!festival.nextDates || !festival.nextDates.start || !festival.nextDates.end) continue;

                // Local ISO (no Z) — matches how the backend JSON date reviver treats dates
                const startDate = new Date(`${festival.nextDates.start}T00:00:00`);
                const endDate = new Date(`${festival.nextDates.end}T00:00:00`);
                if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) continue;

                // Skip past festivals (ended more than 1 week ago)
                if (endDate.getTime() < pastCutoff) continue;

                // Name-collision guard: if a scraped event has the same normalized name
                // and overlaps the festival span, skip injecting to avoid doubles
                const festivalName = normalizeName(festival.name);
                const collision = existingEvents.some(existing => {
                    if (!existing || existing.festival) return false;
                    if (normalizeName(existing.name) !== festivalName) return false;
                    const existingStart = existing.startDate ? new Date(existing.startDate) : null;
                    if (!existingStart || Number.isNaN(existingStart.getTime())) return false;
                    let existingEnd = existing.endDate ? new Date(existing.endDate) : existingStart;
                    if (Number.isNaN(existingEnd.getTime())) existingEnd = existingStart;
                    return existingStart.getTime() <= endDate.getTime() &&
                           existingEnd.getTime() >= startDate.getTime();
                });
                if (collision) {
                    console.debug(`Festival "${festival.name}" overlaps an existing scraped event — skipping injection`);
                    continue;
                }

                const slug = `festival-${festival.key}-${startDate.getFullYear()}`;
                const links = [];
                if (festival.website) links.push({ label: 'Website', url: festival.website });
                if (festival.instagram) links.push({ label: 'Instagram', url: festival.instagram });

                mappedEvents.push({
                    name: festival.name,
                    day: startDate.toLocaleDateString('en-US', { weekday: 'long' }),
                    time: null,
                    eventType: 'festival',
                    recurring: false,
                    startDate,
                    endDate,
                    bar: null,
                    location: festival.location || null,
                    website: festival.website || null,
                    instagram: festival.instagram || null,
                    links: links.length > 0 ? links : null,
                    slug,
                    uid: slug,
                    festival: true,
                    category: festival.category || null
                });
            }

            if (mappedEvents.length === 0) return;

            // Push into each distinct target array (this.allEvents and the caller's
            // events array are usually the same reference — avoid double-pushing)
            const distinctTargets = [...new Set(targetArrays.filter(arr => Array.isArray(arr)))];
            for (const target of distinctTargets) {
                target.push(...mappedEvents);
            }

            logger.info('CALENDAR', `Merged ${mappedEvents.length} festival event(s) for ${cityKey}`, {
                festivals: mappedEvents.map(e => e.name)
            });
        } catch (error) {
            console.warn('Failed to merge festival events — continuing without festivals', error);
        }
    }

    // Try multiple free CORS proxies to fetch Google Calendar ICS
    async loadCalendarDataViaProxy(cityKey, cityConfig) {
        this.updateLoadingMessage(1, 'proxy');
        try {
            const icalText = await this.fetchICalViaProxy(cityConfig.calendarId);
            const events = this.parseICalData(icalText);
            this.allEvents = events;
            this.eventsData = {
                cityConfig,
                events,
                calendarTimezone: this.calendarTimezone,
                timezoneData: this.timezoneData
            };
            return this.eventsData;
        } catch (error) {
            logger.componentError('CALENDAR', 'All CORS proxy attempts failed', { cityKey });
            return null;
        }
    }
     
     // Fallback method: try direct Google Calendar access (will likely fail due to CORS)
     async loadCalendarDataFallback(cityKey, cityConfig) {
         logger.info('CALENDAR', 'Attempting fallback: direct Google Calendar access', {
             cityKey,
             cityName: cityConfig.name,
             warning: 'This will likely fail due to CORS, but trying anyway'
         });
         
         const icalUrl = `https://calendar.google.com/calendar/ical/${cityConfig.calendarId}/public/basic.ics`;
         
         try {
             this.updateLoadingMessage(1, 'direct');
             
             // Simple timeout implementation using Promise.race
             const fetchPromise = fetch(icalUrl, {
                 method: 'GET',
                 headers: {
                     'Accept': 'text/calendar,text/plain,*/*'
                 },
                 cache: 'no-cache'
             });
             
             const timeoutPromise = new Promise((_, reject) => {
                 setTimeout(() => {
                     reject(new Error('Request timed out after 25 seconds'));
                 }, 25000); // 25 second timeout for CORS fallback
             });
             
             const response = await Promise.race([fetchPromise, timeoutPromise]);
             
             if (!response.ok) {
                 throw new Error(`HTTP ${response.status}: ${response.statusText}`);
             }
             
             const icalText = await response.text();
             
             if (!icalText || !icalText.includes('BEGIN:VCALENDAR')) {
                 throw new Error('Invalid iCal data received from Google');
             }
             
             logger.info('CALENDAR', '🎉 Fallback succeeded: Direct Google Calendar access worked!', {
                 cityKey,
                 dataLength: icalText.length,
                 note: 'This suggests Google may have added CORS headers'
             });
             
             const events = this.parseICalData(icalText);
             this.allEvents = events;
             
             this.eventsData = {
                 cityConfig,
                 events,
                 calendarTimezone: this.calendarTimezone,
                 timezoneData: this.timezoneData
             };
             
             return this.eventsData;
             
         } catch (error) {
             // Handle timeout specifically
             if (error.message.includes('timed out')) {
                 logger.componentError('CALENDAR', 'Fallback failed: CORS request timed out after 25 seconds', {
                     cityKey,
                     cityName: cityConfig.name,
                     fallbackError: 'CORS timeout after 25 seconds',
                     recommendation: 'Calendar data will be updated by GitHub Actions within 2 hours'
                 });
             } else {
                 logger.componentError('CALENDAR', 'Fallback failed: Calendar data unavailable', {
                     cityKey,
                     cityName: cityConfig.name,
                     fallbackError: error.message,
                     recommendation: 'Calendar data will be updated by GitHub Actions within 2 hours'
                 });
             }
             
             // Clear fake event from allEvents to prevent it from showing
             this.allEvents = [];
            this.showCalendarError('loadCalendarDataFallback');
            return null;
         }
     }
 
    // Show calendar error - only in the events container for cleaner display
    showCalendarError(errorSource = 'unknown') {
        // Check if events are already successfully displayed - don't overwrite them
        const eventsContainer = document.querySelector('.events-list');
        if (eventsContainer) {
            const hasEventCards = eventsContainer.querySelector('.event-card');
            const hasLoadingMessage = eventsContainer.querySelector('.loading-message');
            
            if (hasEventCards) {
                logger.warn('CALENDAR', `🚨 PREVENTED CALENDAR ERROR from overwriting successful events (source: ${errorSource})`, {
                    currentCity: this.currentCity,
                    currentCityConfig: this.currentCityConfig?.name || 'no config',
                    allEventsLength: this.allEvents?.length || 0,
                    hasEventCards: true,
                    eventCardCount: eventsContainer.querySelectorAll('.event-card').length
                });
                return; // Don't show error if events are already displayed
            }
        }
        
        logger.error('CALENDAR', `🚨 SHOWING CALENDAR ERROR from source: ${errorSource}`, {
            currentCity: this.currentCity,
            currentCityConfig: this.currentCityConfig?.name || 'no config',
            allEventsLength: this.allEvents?.length || 0,
            isInitialized: this.isInitialized,
            isInitializing: this.isInitializing,
            stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n') || 'no stack'
        });
        
        const errorMessage = `
            <div class="error-message">
                <h3>📅 Calendar Temporarily Unavailable</h3>
                <p>We're having trouble loading the latest events for ${this.currentCityConfig?.name || 'this city'}.</p>
                <p><strong>What's happening:</strong> Our calendar data is updated automatically every 2 hours. The latest update may not be available yet.</p>
                <p><strong>Try:</strong> Refreshing the page in a few minutes, or check our social media for the latest updates.</p>
                <!-- Debug: Error source: ${errorSource} -->
            </div>
        `;
        
        // Only show error in the events container to avoid duplication
        if (eventsContainer) {
            eventsContainer.innerHTML = errorMessage;
        }
    }

    // Clear calendar error message
    clearCalendarError() {
        const eventsContainer = document.querySelector('.events-list');
        if (eventsContainer) {
            const existingError = eventsContainer.querySelector('.error-message');
            if (existingError) {
                logger.info('CALENDAR', '✅ Clearing calendar error message', {
                    errorContent: existingError.innerHTML.substring(0, 100) + '...',
                    currentAllEventsLength: this.allEvents?.length || 0
                });
                existingError.remove();
            } else {
                logger.debug('CALENDAR', 'No existing error message to clear');
            }
        } else {
            logger.warn('CALENDAR', 'Events container not found when trying to clear error');
        }
    }
 
     // Update loading message with method information
     updateLoadingMessage(attemptNumber, method) {
         const eventsList = document.querySelector('.events-list');
         if (eventsList) {
             // Show appropriate message based on loading method
             let message = '📅 Loading events...';
             if (method === 'cached') {
                 message = '📅 Loading events...';
             } else if (method === 'direct') {
                 message = '📅 Loading events (trying direct access)...';
             } else if (method === 'proxy') {
                 message = '📅 Loading events (via secure proxy)...';
             }
             
             const loadingDiv = eventsList.querySelector('.loading-message');
             if (loadingDiv) {
                 loadingDiv.textContent = message;
             } else {
                 eventsList.innerHTML = `<div class="loading-message">${message}</div>`;
             }
             
             // Keep detailed logging for debugging (hidden from users)
             logger.debug('CALENDAR', 'Updated loading message for new caching approach', {
                 attemptNumber,
                 method,
                 userMessage: message,
                 technicalDetails: {
                     attempt: attemptNumber,
                     loadingMethod: method,
                     strategy: 'cached_data_with_fallback'
                 }
             });
         }
     }







    // ── Aurora card helpers ────────────────────────────────────────────────
    // Entity-escape event-derived text/attribute values. Same entity set the
    // flyer-URL attribute escape uses, plus the apostrophe (needed because the
    // venue row quotes its showOnMap arguments with ').
    escapeCardText(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Escape a value for use inside a single-quoted JS string that itself lives
    // in an HTML attribute: backslash-escape first (so the entity-decoded
    // attribute still yields a closed string), then entity-escape.
    escapeCardJsString(value) {
        return this.escapeCardText(
            String(value === null || value === undefined ? '' : value)
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
        );
    }

    // Escaped href, or '' for schemes that would execute script.
    safeCardUrl(url) {
        const raw = String(url === null || url === undefined ? '' : url).trim();
        if (!raw || /^(javascript|data|vbscript):/i.test(raw.replace(/[\s\u0000-\u001f]/g, ''))) {
            return '';
        }
        return this.escapeCardText(raw);
    }

    // A raw image value turned into something that is safe to hand an <img
    // src>, or '' when it is not usable as an image at all. Returned value is
    // RAW (not entity-escaped) — callers escape it for the attribute.
    //
    // Rejects, in order:
    //  - blanks,
    //  - javascript:/vbscript: and every data: URL — the 1×1 transparent GIF
    //    placeholder some pages carry for lazy loading lives behind data:, and
    //    it must never render as an event's artwork,
    //  - anything that is neither absolute nor root-relative. A page-relative
    //    value resolves against the CITY PAGE, which is how a bare
    //    "3DOLLARBILLBK.COM" once shipped as a link to /nyc/3DOLLARBILLBK.COM;
    //    the same value in an src is that bug with a broken <img> at the end of
    //    it. The one rescue is a scheme-less host whose path still ends in an
    //    image extension ("example.com/flyer.jpg") — a real flyer missing its
    //    scheme. A bare host with no image path is a WEBSITE in the wrong
    //    field, so it is dropped without ever being requested.
    normalizeFlyerUrl(url) {
        const raw = String(url === null || url === undefined ? '' : url).trim();
        if (!raw) return '';
        if (/^(javascript|data|vbscript):/i.test(raw.replace(/[\s\u0000-\u001f]/g, ''))) return '';
        if (/^https?:\/\//i.test(raw)) return raw;
        if (/^\/\//.test(raw)) return raw;                  // protocol-relative
        if (/^\//.test(raw)) return raw;                    // root-relative (downloaded flyers)
        // host.tld/…/name.jpg with the scheme accidentally missing.
        if (/^[^\s/?#@]+\.[a-z]{2,}\/\S*\.(?:png|jpe?g|gif|webp|avif|svg|bmp)(?:[?#]|$)/i.test(raw)) {
            return `https://${raw}`;
        }
        return '';
    }

    // The identity of the STORED FILE a flyer URL points at: host + path, with
    // the query string, the fragment and the scheme dropped. Two URLs sharing
    // this key are one picture delivered with different parameters (imgix /
    // Cloudinary / thumbor style crop + resize), not two pictures.
    //
    // EventSchema.imageAssetKey owns this rule (the scraper side shares it);
    // the inline copy below is the fallback for a page that loaded the loader
    // without the schema, and must stay identical to it.
    //
    // String parsing, not `new URL(` — the schema twin runs inside Scriptable,
    // where neither URL nor URLSearchParams exists.
    flyerAssetKey(url) {
        const schema = typeof EventSchema !== 'undefined' ? EventSchema : null;
        if (schema && typeof schema.imageAssetKey === 'function') {
            return schema.imageAssetKey(url);
        }
        const raw = String(url === null || url === undefined ? '' : url).trim();
        if (!raw) return '';
        const withoutQuery = raw.split('#')[0].split('?')[0];
        if (!withoutQuery) return '';
        const authorityMatch = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.exec(withoutQuery);
        if (!authorityMatch) return withoutQuery;   // root-relative: compare verbatim
        const rest = withoutQuery.slice(authorityMatch[0].length);
        const slash = rest.indexOf('/');
        const host = (slash < 0 ? rest : rest.slice(0, slash)).toLowerCase();
        const path = slash < 0 ? '' : rest.slice(slash);
        return `${host}${path}`;                    // scheme ignored on purpose
    }

    // Ordered flyer candidates for one event, best first, as
    // { u: url, o: 'portrait' | 'landscape' | '' } entries. `want` is the
    // orientation the layout prefers; `o` is only set when the orientation is
    // KNOWN (i.e. the URL came out of an orientation slot), which is the
    // minority case — orientation is unknowable for most URLs, so an empty `o`
    // has to keep behaving exactly like today's single-image card.
    //
    // The rule the site follows everywhere: prefer the wanted orientation, then
    // show whatever else exists rather than nothing. EventSchema
    // .pickImageForOrientation owns the head of that order when it is
    // available; the local order (wanted slot → primary → other slot) is the
    // same answer and keeps this working on its own.
    //
    // Every candidate is passed through normalizeFlyerUrl, so a data: /
    // page-relative / blank value drops out of the chain instead of becoming a
    // broken <img> — including out of the data-flyer-fallbacks queue.
    getFlyerCandidates(event, want = 'landscape') {
        if (!event) return [];
        const readSlot = value => this.normalizeFlyerUrl(value);
        const vertical = readSlot(event.imageVertical);
        const horizontal = readSlot(event.imageHorizontal);
        const primary = readSlot(event.image);
        const wantedSlot = want === 'portrait' ? vertical : horizontal;
        const otherSlot = want === 'portrait' ? horizontal : vertical;

        let preferred = wantedSlot;
        const schema = typeof EventSchema !== 'undefined' ? EventSchema : null;
        if (schema && typeof schema.pickImageForOrientation === 'function') {
            try {
                // Normalized so it compares equal to the slots below (and so a
                // schema pick that is itself unusable falls back to wantedSlot).
                const picked = this.normalizeFlyerUrl(schema.pickImageForOrientation(event, want));
                if (picked) {
                    preferred = picked;
                }
            } catch (error) {
                logger.debug('CALENDAR', 'pickImageForOrientation failed; using local flyer order', {
                    error: error && error.message
                });
            }
        }

        // A slot that is only a CROP of the primary (same host + path, different
        // crop/resize query) is not a better-shaped picture — it is this picture
        // with its edges cut off, so the uncropped primary leads instead. Applied
        // after the schema pick so it also covers a schema that predates the rule.
        // A separate wide image (different asset) keeps its preference untouched.
        //
        // Identity is read off the ORIGINAL url (parseEventData stamps
        // _imageSourceUrls before rewriting cached slots to local img/events
        // paths); on the live site the slot values are hashed filenames that
        // hide the shared asset entirely.
        const sources = event._imageSourceUrls || null;
        const slotFieldOf = url => {
            if (!url) return '';
            if (url === primary) return 'image';
            if (url === vertical) return 'imageVertical';
            if (url === horizontal) return 'imageHorizontal';
            return '';
        };
        const assetKeyOf = url => {
            const field = slotFieldOf(url);
            const source = sources && field && sources[field] ? sources[field] : url;
            return this.flyerAssetKey(source);
        };
        if (primary && preferred && preferred !== primary) {
            const preferredKey = assetKeyOf(preferred);
            if (preferredKey && preferredKey === assetKeyOf(primary)) {
                preferred = primary;
            }
        }

        const orientationOf = url => {
            if (url && url === vertical) return 'portrait';
            if (url && url === horizontal) return 'landscape';
            return '';
        };

        const candidates = [];
        const seen = new Set();
        const push = (url, orientation) => {
            if (!url || seen.has(url)) return;
            seen.add(url);
            candidates.push({ u: url, o: orientation || '' });
        };
        // Each entry is already normalizeFlyerUrl'd, so '' here means the slot
        // was empty or unusable.
        [preferred, wantedSlot, primary, otherSlot].forEach(url => push(url, orientationOf(url)));
        return candidates;
    }

    // Inline SVG for one of the aurora card icons (see AURORA_CARD_ICONS).
    cardIconSvg(name, className = 'ec-ico') {
        const paths = AURORA_CARD_ICONS[name];
        if (!paths) return '';
        const body = paths.map(d => `<path fill="currentColor" d="${d}"/>`).join('');
        return `<svg class="${className}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${body}</svg>`;
    }

    // Parse "#rgb"/"#rrggbb" into {r,g,b}; null for anything else. Doubles as the
    // guard that keeps unvalidated strings out of the inline style attribute.
    parseHexColor(hex) {
        const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
        if (!match) return null;
        let value = match[1];
        if (value.length === 3) {
            value = value.split('').map(char => char + char).join('');
        }
        return {
            r: parseInt(value.slice(0, 2), 16),
            g: parseInt(value.slice(2, 4), 16),
            b: parseInt(value.slice(4, 6), 16)
        };
    }

    rgbToHexColor(rgb) {
        const channel = value => Math.max(0, Math.min(255, Math.round(value)))
            .toString(16)
            .padStart(2, '0');
        return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
    }

    mixRgbColors(from, to, amount) {
        return {
            r: from.r + (to.r - from.r) * amount,
            g: from.g + (to.g - from.g) * amount,
            b: from.b + (to.b - from.b) * amount
        };
    }

    // Perceived brightness, 0–1.
    rgbBrightness(rgb) {
        return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    }

    // Push a color into a brightness band so every aurora stop reads as a glow
    // behind white text — brand favicons range from near-white to near-black.
    toneForAurora(rgb, minBrightness, maxBrightness) {
        const brightness = this.rgbBrightness(rgb);
        if (brightness > maxBrightness) {
            const scale = maxBrightness / brightness;
            return { r: rgb.r * scale, g: rgb.g * scale, b: rgb.b * scale };
        }
        if (brightness < minBrightness) {
            const amount = (minBrightness - brightness) / (1 - brightness);
            return this.mixRgbColors(rgb, { r: 255, g: 255, b: 255 }, amount);
        }
        return rgb;
    }

    // Colorfulness of an rgb triple, 0..1 (max channel spread). Greys, whites
    // and blacks score ~0; a saturated brand colour scores high.
    rgbColorfulness(rgb) {
        const max = Math.max(rgb.r, rgb.g, rgb.b);
        const min = Math.min(rgb.r, rgb.g, rgb.b);
        return max <= 0 ? 0 : (max - min) / max;
    }

    // A cheap opponent-colour distance: how differently two colours read. The
    // perceptual work already happened in the extractor (OKLab clustering), so
    // all that's needed here is "are these two the same colour or not" —
    // brightness difference plus the two chromatic axes, no colour-space
    // conversion duplicated into the browser.
    rgbSeparation(a, b) {
        const lightness = this.rgbBrightness(a) - this.rgbBrightness(b);
        const redGreen = ((a.r - a.g) - (b.r - b.g)) / 255;
        const yellowBlue = (((a.r + a.g) / 2 - a.b) - ((b.r + b.g) / 2 - b.b)) / 255;
        return Math.sqrt(lightness * lightness + redGreen * redGreen + yellowBlue * yellowBlue);
    }

    // A deeper, slightly richer version of a colour: same hue, lower lightness,
    // a touch more saturation. Used as the second stop when artwork has only
    // one usable colour, so the gradient travels within the brand instead of
    // wandering into a hue that fights it.
    deepenRgb(rgb, lightnessFactor, chromaBoost = 1) {
        const mean = (rgb.r + rgb.g + rgb.b) / 3;
        const push = (channel) => Math.max(0, Math.min(255,
            (mean + (channel - mean) * chromaBoost) * lightnessFactor));
        return { r: push(rgb.r), g: push(rgb.g), b: push(rgb.b) };
    }

    // Parse the packed `palette` string written by
    // tools/extract-favicon-colors.js: space-separated `hex:share:chroma`
    // tokens, ordered by how much of the artwork each colour covers, where
    // share is a percent and chroma is OKLab chroma ×100. Malformed tokens are
    // dropped rather than trusted — these colours end up in an inline style
    // attribute, so parseHexColor stays the gate.
    parsePaletteEntries(palette) {
        if (typeof palette !== 'string') return [];
        const entries = [];
        palette.trim().split(/\s+/).forEach(token => {
            const parts = token.split(':');
            const rgb = this.parseHexColor(parts[0]);
            if (!rgb) return;
            entries.push({
                rgb,
                share: Math.max(0, Number(parts[1]) || 0) / 100,
                chroma: Math.max(0, Number(parts[2]) || 0) / 100
            });
        });
        return entries;
    }

    // Three stops from a rich palette. `accent` (the extractor's most usable
    // saturated colour) anchors the card; the second stop is the palette entry
    // that reads most differently from it; the third is a darkened blend pulled
    // toward the card base. Returns null only when there is nothing usable —
    // the old "is this pair grey?" sniffing is gone, because the extractor
    // already answered that question by omitting `accent`.
    deriveAuroraFromPalette(entries, accentRgb) {
        if (!accentRgb) return this.deriveAchromaticAurora(entries);

        const candidates = entries
            .filter(entry => entry.chroma >= AURORA_MIN_CHROMA && entry.share >= AURORA_MIN_STOP_SHARE)
            .map(entry => ({ rgb: entry.rgb, separation: this.rgbSeparation(entry.rgb, accentRgb) }))
            .filter(candidate => candidate.separation >= AURORA_MIN_SEPARATION)
            .sort((a, b) => b.separation - a.separation);

        const second = candidates.length > 0
            ? candidates[0].rgb
            : this.deepenRgb(accentRgb, AURORA_SIBLING_LIGHTNESS, AURORA_SIBLING_CHROMA_BOOST);

        return this.bandAuroraStops(accentRgb, second, 0.2, 0.52, 0.16, 0.48);
    }

    // Genuinely colourless artwork (Eagle NYC's black-and-white crest, The Urban
    // Bear's white-on-black mark). A grey aurora is no aurora, so use the
    // artwork's own lightness spread but tint it toward the card base: the card
    // reads as deliberate slate/graphite rather than washed-out grey, and it
    // still belongs to the brand instead of borrowing the site palette.
    deriveAchromaticAurora(entries) {
        if (entries.length === 0) return null;
        const sorted = [...entries].sort((a, b) => this.rgbBrightness(b.rgb) - this.rgbBrightness(a.rgb));
        const lightest = sorted[0].rgb;
        const darkest = sorted[sorted.length - 1].rgb;
        const tint = rgb => this.mixRgbColors(rgb, AURORA_BASE_RGB, 0.45);
        // Wider bands than the coloured path uses: lightness is the only thing
        // left to make the blobs visible at all.
        return this.bandAuroraStops(tint(lightest), tint(darkest), 0.22, 0.4, 0.06, 0.14);
    }

    // Push two chosen stops into brightness bands that keep white text legible,
    // then derive the third from their blend over the card base.
    bandAuroraStops(first, second, firstMin, firstMax, secondMin, secondMax) {
        const c1 = this.toneForAurora(first, firstMin, firstMax);
        const c2 = this.toneForAurora(second, secondMin, secondMax);
        const blended = this.mixRgbColors(c1, c2, 0.5);
        return {
            c1: this.rgbToHexColor(c1),
            c2: this.rgbToHexColor(c2),
            c3: this.rgbToHexColor(this.toneForAurora(this.mixRgbColors(blended, AURORA_BASE_RGB, 0.62), 0.05, 0.22))
        };
    }

    // Three aurora stops for one colour record.
    //
    // Preferred path: the `palette`/`accent` written by
    // tools/extract-favicon-colors.js, which sees the whole flyer (or the whole
    // favicon composited over its white plate) instead of two k-means centroids.
    //
    // Fallback path (entries that only carry the older faviconBg/faviconFg
    // pair): the original background/foreground stops, including the
    // colourfulness veto that sent grey pairs to the site palette. Two grey
    // centroids really do contain nothing to build an aurora from — the palette
    // is what makes that veto unnecessary, so it only applies here.
    deriveAuroraColors(record) {
        if (!record) return null;

        const entries = this.parsePaletteEntries(record.palette);
        if (entries.length > 0) {
            return this.deriveAuroraFromPalette(entries, this.parseHexColor(record.accent));
        }

        const backgroundRgb = this.parseHexColor(record.bg);
        if (!backgroundRgb) return null;
        const foregroundRgb = this.parseHexColor(record.fg) || backgroundRgb;
        const colorfulness = Math.max(
            this.rgbColorfulness(backgroundRgb),
            this.rgbColorfulness(foregroundRgb)
        );
        if (colorfulness < 0.18) return null;
        const blended = this.mixRgbColors(backgroundRgb, foregroundRgb, 0.5);
        return {
            c1: this.rgbToHexColor(this.toneForAurora(backgroundRgb, 0.18, 0.5)),
            c2: this.rgbToHexColor(this.toneForAurora(foregroundRgb, 0.18, 0.5)),
            c3: this.rgbToHexColor(this.toneForAurora(this.mixRgbColors(blended, AURORA_BASE_RGB, 0.6), 0.05, 0.22))
        };
    }

    // Per-event colors live in data/event-colors/<city>.json as
    // [{slug, url, faviconBg, faviconFg, paletteSource, palette, accent}].
    // Nothing loaded them in the browser before the aurora cards, so fetch once
    // per city and cache the result.
    loadEventColors(city) {
        if (!city) return Promise.resolve(null);
        if (this.eventColorsByCity.has(city)) {
            return Promise.resolve(this.eventColorsByCity.get(city));
        }
        if (this.eventColorsRequests.has(city)) {
            return this.eventColorsRequests.get(city);
        }

        const request = fetch(`/data/event-colors/${encodeURIComponent(city)}.json`)
            .then(response => (response.ok ? response.json() : []))
            .then(entries => {
                const bySlug = new Map();
                (Array.isArray(entries) ? entries : []).forEach(entry => {
                    if (!entry || !entry.slug) return;
                    // A palette alone is enough: events whose only artwork is a
                    // flyer (no usable favicon) now get colours too, and they
                    // carry no faviconBg to gate on.
                    if (!entry.faviconBg && typeof entry.palette !== 'string') return;
                    bySlug.set(entry.slug, {
                        bg: entry.faviconBg,
                        fg: entry.faviconFg || entry.faviconBg,
                        palette: entry.palette,
                        accent: entry.accent,
                        // The favicon's own background colour, painted behind
                        // its tile. Dropping it here silently defeated the
                        // whole plate feature: the data had it, the card asked
                        // for it, and this normaliser threw it away.
                        faviconPlate: entry.faviconPlate
                    });
                });
                this.eventColorsByCity.set(city, bySlug);
                logger.debug('CALENDAR', 'Loaded event colors', { city, count: bySlug.size });
                return bySlug;
            })
            .catch(error => {
                logger.debug('CALENDAR', 'No event colors available', { city, error: error.message });
                this.eventColorsByCity.set(city, new Map());
                return this.eventColorsByCity.get(city);
            })
            .finally(() => {
                this.eventColorsRequests.delete(city);
            });

        this.eventColorsRequests.set(city, request);
        return request;
    }

    // Aurora stops for one event, or null when colors aren't (yet) known. Card
    // generation stays synchronous: the first call kicks off the fetch and the
    // already-rendered cards get repainted when it resolves.
    getAuroraColorsForEvent(event) {
        const city = this.currentCity;
        const bySlug = city ? this.eventColorsByCity.get(city) : null;
        if (!bySlug) {
            // Only the first card of a render kicks off the fetch and schedules the
            // repaint; the rest of the batch piggybacks on the in-flight request.
            if (!this.eventColorsRequests.has(city)) {
                this.loadEventColors(city).then(loaded => {
                    if (loaded && loaded.size > 0) {
                        this.applyEventColorsToRenderedCards();
                        this.applyEventColorsToRenderedMarkers();
                    }
                });
            }
            return null;
        }
        return this.deriveAuroraColors(bySlug.get(event.slug));
    }



    // The favicon's OWN background colour (faviconPlate — the highest-coverage
    // colour of the favicon itself, recorded separately from `palette` because
    // that may describe the flyer). Painting it behind and around the artwork
    // is what lets the icon breathe without a white halo: a white-backed mark
    // gets white, Urban Bear's white-on-black gets black, Bearracuda's "B"
    // gets its own orange. Null when unknown — the tile then falls back to
    // white in CSS.
    getFaviconPlateForEvent(event) {
        const bySlug = this.currentCity ? this.eventColorsByCity.get(this.currentCity) : null;
        const colors = bySlug ? bySlug.get(event.slug) : null;
        const plate = colors && colors.faviconPlate;
        return plate && this.parseHexColor(plate) ? plate : null;
    }

    // Repaint map markers that were built before the colour file arrived.
    applyEventColorsToRenderedMarkers() {
        const bySlug = this.eventColorsByCity.get(this.currentCity);
        if (!bySlug || bySlug.size === 0) return;
        document.querySelectorAll('.favicon-marker[data-event-slug]').forEach(marker => {
            const colors = bySlug.get(marker.getAttribute('data-event-slug'));
            const plate = colors && colors.faviconPlate;
            if (plate && this.parseHexColor(plate)) {
                marker.style.setProperty('--fav-plate', plate);
            }
        });
    }

    // Repaint aurora cards that rendered before the color file arrived.
    applyEventColorsToRenderedCards() {
        const bySlug = this.eventColorsByCity.get(this.currentCity);
        if (!bySlug || bySlug.size === 0) return;
        document.querySelectorAll('.event-card.detailed.aurora[data-event-slug]').forEach(card => {
            const colors = bySlug.get(card.getAttribute('data-event-slug'));
            const plate = colors && colors.faviconPlate;
            if (plate && this.parseHexColor(plate)) {
                card.style.setProperty('--fav-plate', plate);
            }
            const aurora = this.deriveAuroraColors(colors);
            if (!aurora) return;
            card.style.setProperty('--c1', aurora.c1);
            card.style.setProperty('--c2', aurora.c2);
            card.style.setProperty('--c3', aurora.c3);
        });
    }

    // Rounded-square favicon tile for the card title row. Rendered only when a
    // favicon path exists; a load failure removes the tile so no empty frame is
    // left behind.
    // Dusk cards: each time sits next to its own day — "1AM" is
    // unambiguously the start day's and "6PM" the end day's. A small-hours
    // event shown on the previous day says "night": that one word explains
    // why a Wednesday card carries Thursday clock times.
    formatDuskWhenText(event) {
        try {
            if (!event || !event.startDate) return null;
            const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const md = d => `${d.getMonth() + 1}/${d.getDate()}`;
            const ls = this.getLogicalStartDate(event);
            if (!ls) return null;
            const times = typeof event.time === 'string' && event.time.includes('-')
                ? event.time.split('-').map(t => t.trim())
                : (event.time ? [String(event.time).trim()] : []);
            if (this.isMultiDay(event)) {
                const le = this.getLogicalEndDate(event);
                if (!le) return null;
                const startPart = `${WD[ls.getDay()]} ${md(ls)}${times[0] ? ' ' + times[0] : ''}`;
                const endPart = `${WD[le.getDay()]} ${md(le)}${times[1] ? ' ' + times[1] : ''}`;
                return `${startPart} \u2013 ${endPart}`;
            }
            const literalStart = new Date(event.startDate);
            if (event.time && ls.getDate() !== literalStart.getDate()) {
                return `${WD[ls.getDay()]} ${md(ls)} night \u00b7 ${event.time}`;
            }
            return null;
        } catch (err) {
            return null;
        }
    }

    generateAuroraFaviconHtml(event) {
        let faviconUrl = null;
        try {
            faviconUrl = this.getEventFaviconUrl(event);
        } catch (error) {
            return '';
        }
        if (!faviconUrl) return '';
        const src = this.safeCardUrl(faviconUrl);
        if (!src) return '';
        // The tile is a FIXED white plate with the artwork contained inside —
        // identical to the map markers (see --favicon-plate-* in styles.css).
        // Deriving the plate per brand failed: Animal's red-on-red favicon
        // became a solid red block, and a transparent plate made round marks
        // read as circles next to square ones.
        // EAGER, deliberately: favicons are tiny local files, and lazy
        // loading barely fires for offscreen cards in a horizontally
        // scrolled rail — on the 46-card timeline only 8 of 45 had loaded,
        // so swiping showed favicon-less cards popping their icons in late.
        // Flyers stay lazy; they are the heavy assets.
        return `<span class="ec-fav"><img src="${src}" alt="" loading="eager" decoding="async" onerror="this.parentNode.remove()"></span>`;
    }

    // Venue row. Mirrors generateLocationHtml's data choices (coordinates →
    // showOnMap link, otherwise the plain bar name) without the label/value markup.
    generateAuroraVenueRow(event) {
        const lat = Number(event.coordinates?.lat);
        const lng = Number(event.coordinates?.lng);
        const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
        const venue = event.bar || (hasCoordinates ? 'Location' : '');
        if (!venue) return '';
        const label = this.escapeCardText(venue);
        const value = hasCoordinates
            ? `<a href="#" class="map-link" onclick="showOnMap(${lat}, ${lng}, '${this.escapeCardJsString(event.name)}', '${this.escapeCardJsString(event.bar || '')}')">${label}</a>`
            : label;
        return `<div class="ec-row ec-venue">${this.cardIconSvg('pin')}<span class="ec-row-text">${value}</span></div>`;
    }

    // Cover row. Same "hide free events" filter generateCoverHtml applies.
    generateAuroraCoverRow(event) {
        const cover = event.cover;
        if (!cover || !cover.trim()) return '';
        const normalized = cover.toLowerCase();
        if (normalized === 'free' || normalized === 'no cover') return '';
        return `<div class="ec-row ec-cover">${this.cardIconSvg('cash')}<span class="ec-row-text">${this.escapeCardText(cover)}</span></div>`;
    }

    // Generate event card
    generateEventCard(event) {
        const linksHtml = event.links ? event.links.map(link => {
            const labelLower = (link.label || '').toLowerCase();
            let iconClass = 'bi-link-45deg';
            let aria = 'Open link';
            if (labelLower.includes('facebook')) { iconClass = 'bi-facebook'; aria = 'Facebook'; }
            else if (labelLower.includes('instagram')) { iconClass = 'bi-instagram'; aria = 'Instagram'; }
            else if (labelLower.includes('twitter') || labelLower.includes('x ' ) || labelLower === 'x') { iconClass = 'bi-twitter-x'; aria = 'Twitter/X'; }
            else if (labelLower.includes('website') || labelLower.includes('site')) { iconClass = 'bi-globe2'; aria = 'Website'; }
            else if (labelLower.includes('tickets') || labelLower.includes('ticket')) { iconClass = 'bi-ticket-perforated'; aria = 'Tickets'; }
            else if (labelLower.includes('rsvp')) { iconClass = 'bi-check2-circle'; aria = 'RSVP'; }
            else if (labelLower.includes('map')) { iconClass = 'bi-geo-alt'; aria = 'Map'; }
            else if (labelLower.includes('more info') || labelLower.includes('info')) { iconClass = 'bi-info-circle'; aria = 'More info'; }

            const href = this.safeCardUrl(link.url);
            if (!href) return '';
            return `<a href="${href}" target="_blank" rel="noopener" class="event-link icon-only" aria-label="${aria}" title="${aria}"><i class="bi ${iconClass}"></i></a>`;
        }).join(' ') : '';

        const teaText = this.sanitizeDisplayText(event.tea);
        const teaHtml = teaText ? `<div class="ec-tea">${this.escapeCardText(teaText)}</div>` : '';
        const venueRow = this.generateAuroraVenueRow(event);
        const coverRow = this.generateAuroraCoverRow(event);

        // Get current calendar period bounds for contextual date display
        const periodBounds = this.getCurrentPeriodBounds();

        // Event badges
        const formatDayTime = (event) => {
            const paired = this.formatDuskWhenText(event);
            if (paired) return paired;
            if (this.isMultiDay(event) && window.formatEventDates) {
                return window.formatEventDates(event);
            }
            return this.getEnhancedDayTimeDisplay(event, this.currentView, periodBounds);
        };

        const recurringBadgeContent = this.getRecurringBadgeContent(event);
        const recurringBadge = recurringBadgeContent ?
            `<span class="recurring-badge">${this.cardIconSvg('repeat', 'ec-badge-ico')}${this.escapeCardText(recurringBadgeContent)}</span>` : '';

        // The date READS FIRST as plain text rather than sitting in a pill:
        // "7/18 · Fri 8PM-2AM" instead of "Fri 8PM-2AM [7/18]". The pill is
        // kept for the class contract (updateSelectionVisualState and friends
        // query .date-badge) but only when the date is already inside the
        // day/time string, so it never renders twice.
        const dateBadgeContent = this.getDateBadgeContent(event, periodBounds);
        const dayTimeText = formatDayTime(event);
        const dateLeads = !!dateBadgeContent
            && !String(dayTimeText).includes(String(dateBadgeContent));
        // The zone, named. Every row on a city page is in that city's zone, so
        // it is never a surprise here — but the pages are read from other
        // zones (and shared out of context), and "9PM" alone does not say
        // whose 9PM. Same label the share cards carry.
        //
        // Called through a guard because js/** is served with a cache TTL and
        // getTimeZoneLabel is NEW to calendar-core: a returning visitor can
        // hold yesterday's core beside today's loader, and without this the
        // whole list died on "Error displaying events. Please refresh the
        // page." A missing label is a missing three letters; it must never be
        // more than that.
        const zoneLabel = (event.time && typeof this.getTimeZoneLabel === 'function')
            ? this.getTimeZoneLabel(event, this.currentCityConfig && this.currentCityConfig.timezone)
            : '';
        const whenBase = dateLeads
            ? `${dateBadgeContent} · ${dayTimeText}`
            : dayTimeText;
        const whenText = zoneLabel ? `${whenBase} ${zoneLabel}` : whenBase;
        const dateBadge = dateBadgeContent && !dateLeads ?
            `<span class="date-badge">${this.escapeCardText(dateBadgeContent)}</span>` : '';

        // Add distance badge if location features are enabled and distance is available
        const distanceBadge = this.locationFeaturesEnabled && event.distanceFromUser !== undefined ?
            `<span class="distance-badge" title="Distance from your location">${this.cardIconSvg('pin', 'ec-badge-ico')}${this.escapeCardText(event.distanceFromUser)} mi</span>` : '';

        const badges = recurringBadge || dateBadge || distanceBadge ?
            `<span class="ec-badges">${recurringBadge}${dateBadge}${distanceBadge}</span>` : '';

        const faviconHtml = this.generateAuroraFaviconHtml(event);

        // The flyer is part of the card now (natural aspect ratio, never cropped).
        // Entity-escape for the attribute (NOT encodeURI — many image URLs are already
        // percent-encoded and encodeURI would double-encode them); getAttribute decodes
        // back to the exact original URL. data-flyer-url is kept so ensureFlyerLoaded()
        // still recognises the container.
        //
        // The card shows the flyer at its natural aspect ratio in a box as wide
        // as the card, so it asks for the LANDSCAPE candidate — horizontal
        // artwork fills that box without eating the whole viewport. Anything
        // else the event has (primary, then vertical) still shows rather than
        // nothing; the rest of the chain is queued in data-flyer-fallbacks for
        // advanceFlyerImage(). The known orientation rides along on the
        // container so CSS can cap portrait and landscape differently BEFORE
        // the image loads (no layout shift).
        const flyerCandidates = this.getFlyerCandidates(event, 'landscape');
        const flyerPick = flyerCandidates[0] || null;
        const flyerUrl = flyerPick ? this.safeCardUrl(flyerPick.u) : '';
        const flyerOrientationAttr = flyerPick && flyerPick.o
            ? ` data-flyer-orientation="${this.escapeCardText(flyerPick.o)}"` : '';
        const flyerFallbacks = flyerCandidates.slice(1);
        const flyerFallbackAttr = flyerFallbacks.length
            ? ` data-flyer-fallbacks="${this.escapeCardText(JSON.stringify(flyerFallbacks))}"` : '';
        const flyerHtml = flyerUrl ?
            `<div class="event-flyer" data-flyer-url="${flyerUrl}"${flyerOrientationAttr}${flyerFallbackAttr}><img src="${flyerUrl}" alt="" loading="lazy" decoding="async" onerror="window.chunkyAdvanceFlyer ? window.chunkyAdvanceFlyer(this) : this.parentNode.remove()"></div>` : '';

        const aurora = this.getAuroraColorsForEvent(event);
        const plate = this.getFaviconPlateForEvent(event);
        const styleParts = [];
        if (aurora) styleParts.push(`--c1:${aurora.c1}`, `--c2:${aurora.c2}`, `--c3:${aurora.c3}`);
        if (plate) styleParts.push(`--fav-plate:${plate}`);
        const auroraStyle = styleParts.length ? ` style="${styleParts.join(';')}"` : '';

        const slug = this.escapeCardText(event.slug);
        const shareTime = `${event.day || ''}${event.time ? ' ' + event.time : ''}`;

        // Which OCCURRENCE this card is: the rail's timeline renders a
        // recurring event once per occurrence, so slug alone no longer names
        // a unique card — selection, reuse and centering key on slug+date.
        let occurrenceISO = '';
        try {
            const logical = this.getLogicalStartDate(event);
            if (logical) occurrenceISO = this.getLocalDateKey(logical);
        } catch (e) { occurrenceISO = ''; }
        const occurrenceAttr = occurrenceISO ? ` data-occurrence="${occurrenceISO}"` : '';

        return `
            <div class="event-card detailed aurora" data-event-slug="${slug}"${occurrenceAttr} data-lat="${this.escapeCardText(event.coordinates?.lat || '')}" data-lng="${this.escapeCardText(event.coordinates?.lng || '')}"${auroraStyle}>
                ${flyerHtml}
                <div class="ec-panel">
                    ${flyerUrl ? '<button class="rail-thumb" type="button" aria-label="Show flyer"></button>' : ''}
                    <div class="ec-titlerow">
                        ${faviconHtml}
                        <h3 class="ec-title">${this.escapeCardText(event.name)}</h3>
                    </div>
                    <div class="ec-rows">
                        <div class="ec-row ec-when">
                            ${this.cardIconSvg('clock')}
                            <span class="event-day">${this.escapeCardText(whenText)}</span>
                            ${badges}
                        </div>
                        ${venueRow}
                        ${coverRow}
                    </div>
                    ${teaHtml}
                    <div class="event-links">
                        ${linksHtml}
                        <button class="share-event-btn icon-only" data-event-slug="${slug}" data-event-name="${this.escapeCardText(event.name)}" data-event-venue="${this.escapeCardText(event.bar || '')}" data-event-time="${this.escapeCardText(shareTime)}" title="Share this event" aria-label="Share this event">
                            <span class="share-icon" aria-hidden="true"><i class="bi bi-box-arrow-up"></i></span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // Strip source-platform formatting from text that is about to be DISPLAYED.
    // The scraper sanitizes descriptions when it writes them (#1575), but events
    // already in the calendar keep whatever the source published — Sitges'
    // Bear Cave events still carry literal "<p>…</p>\\n" from a Wix page, and
    // dice.fm events carry markdown "**bold**". The site is the display layer,
    // so it defends itself rather than waiting for every event to be re-scraped.
    // Escaping happens afterwards via escapeCardText; this only REMOVES markup.
    sanitizeDisplayText(text) {
        if (typeof text !== 'string' || !text) return text;
        let out = text;
        // Literal two-character escapes ("\n" as backslash + n), then real tags.
        out = out.replace(/\\r\\n|\\n/g, ' ').replace(/\\r/g, '');
        out = out.replace(/<!--[\s\S]*?-->/g, '');
        out = out.replace(/<\/?(?:p|div|br|li|ul|ol|h[1-6]|section|article|span|strong|b|em|i|u|a|img|figure|figcaption|blockquote|pre|code)\b[^<>]*\/?>/gi, ' ');
        // Common entities, ampersand first so double-encoding resolves.
        out = out.replace(/&amp;/gi, '&').replace(/&nbsp;/gi, ' ')
                 .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
                 .replace(/&quot;/gi, '"').replace(/&(?:#39|#039|apos);/gi, "'");
        // Markdown emphasis runs and backslash-escaped punctuation. Escaped
        // characters are parked behind placeholders FIRST (same approach as the
        // scraper's sanitizer): otherwise "\\*Now on Saturdays\\***" has its
        // escaped asterisk counted as part of a run and leaves a stray
        // backslash behind.
        out = out.replace(/\[([^\[\]\n]*)\]\([^()\n]*\)/g, '$1');
        out = out.split('\\*').join('\uE000').split('\\_').join('\uE001');
        out = out.replace(/\*{2,}|_{2,}/g, '');
        out = out.split('\uE000').join('*').split('\uE001').join('_');
        out = out.replace(/\\([*_#\[\].])/g, '$1');
        // Leftover ESCAPE RESIDUE. Stored descriptions can end in bare
        // backslashes — Sitges' Bear Cave events carry "</p>\\\\" because a
        // literal "\\n" from the source page went through ICS escaping and came
        // back as backslashes with nothing to escape. Nothing in event copy
        // legitimately ends on a backslash, so runs of them, and any backslash
        // left dangling before whitespace or end-of-string, are dropped.
        out = out.replace(/\\{2,}/g, '').replace(/\\+(?=\s|$)/g, '');
        // Collapse the whitespace the removals leave behind.
        return out.replace(/\s{2,}/g, ' ').trim();
    }

    // Clipboard write that works WITHOUT a secure context (plain-http
    // previews): a hidden textarea plus the deprecated execCommand path.
    // Returns true when the copy actually succeeded.
    copyTextLegacy(text) {
        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.top = '-1000px';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            textarea.setSelectionRange(0, text.length);
            const copied = document.execCommand && document.execCommand('copy');
            document.body.removeChild(textarea);
            return !!copied;
        } catch (error) {
            logger.warn('EVENT', `Legacy copy failed: ${error.message}`);
            return false;
        }
    }

    // Setup share button handlers for event cards
    setupShareButtons() {
        const shareButtons = document.querySelectorAll('.share-event-btn');
        
        shareButtons.forEach(button => {
            // reconciled refreshes REUSE card nodes — never double-bind
            if (button.dataset.shareBound) return;
            button.dataset.shareBound = '1';
            button.addEventListener('click', async (e) => {
                e.stopPropagation(); // Prevent event card click
                
                const eventSlug = button.dataset.eventSlug;
                const eventName = button.dataset.eventName;
                const eventVenue = button.dataset.eventVenue;
                const eventTime = button.dataset.eventTime;
                
                // Build share URL with date + view for accurate deep link
                const citySlug = this.currentCity || window.location.pathname.replace(/\//g, '');
                const dateISO = this.formatDateToISO(this.currentDate);
                const view = this.currentView;
                const shareUrl = `${window.location.origin}/${citySlug}/${eventSlug}?date=${encodeURIComponent(dateISO)}&view=${encodeURIComponent(view)}`;
                
                // Build share text
                const shareTitle = `${eventName}`;
                const shareText = `Check out ${eventName} at ${eventVenue} - ${eventTime}`;
                
                logger.userInteraction('EVENT', 'Share button clicked', {
                    eventSlug,
                    eventName,
                    shareUrl
                });
                
                // Use Web Share API if available, otherwise copy to clipboard
                if (navigator.share) {
                    try {
                        await navigator.share({
                            title: shareTitle,
                            text: shareText,
                            url: shareUrl
                        });
                        logger.info('EVENT', 'Event shared successfully', {
                            eventSlug,
                            eventName
                        });
                        // No toast for successful share - rely on native share sheet experience
                    } catch (err) {
                        if (err.name !== 'AbortError') {
                            logger.error('EVENT', 'Share failed', err);
                            this.showShareToast('Unable to share event');
                        }
                    }
                } else if (navigator.clipboard && navigator.clipboard.writeText) {
                    // Simple clipboard copy
                    const shareContent = `${shareText}\n${shareUrl}`;
                    try {
                        await navigator.clipboard.writeText(shareContent);
                        this.showShareToast('Link copied! 📋');
                        logger.info('EVENT', 'Event URL copied to clipboard');
                    } catch (err) {
                        logger.error('EVENT', 'Copy failed', err);
                        this.showShareToast('Unable to copy link');
                    }
                } else if (this.copyTextLegacy(`${shareText}\n${shareUrl}`)) {
                    // navigator.share and navigator.clipboard both require a
                    // SECURE CONTEXT — neither exists over plain http (e.g. a
                    // LAN/tailnet preview), which previously produced a dead
                    // end. The selection-based copy still works there.
                    this.showShareToast('Link copied! 📋');
                    logger.info('EVENT', 'Event URL copied via legacy selection copy');
                } else {
                    // Truly nothing available: show the link so it can still
                    // be copied by hand rather than telling the user no.
                    this.showShareToast(shareUrl);
                    logger.warn('EVENT', 'No share method available; surfaced URL instead');
                }
            });
        });
        
        logger.debug('EVENT', `Set up ${shareButtons.length} share button handlers`);
    }
    
    // Show toast notification for share feedback
    showShareToast(message) {
        // Remove any existing toast
        const existingToast = document.querySelector('.share-toast');
        if (existingToast) {
            existingToast.remove();
        }
        
        // Create new toast
        const toast = document.createElement('div');
        toast.className = 'share-toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--primary-color, #8B4513);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            z-index: 10000;
            animation: slideUp 0.3s ease-out;
            font-family: 'Poppins', sans-serif;
        `;
        
        // Add animation keyframes if not already present
        if (!document.querySelector('#share-toast-animations')) {
            const style = document.createElement('style');
            style.id = 'share-toast-animations';
            style.textContent = `
                @keyframes slideUp {
                    from {
                        transform: translateX(-50%) translateY(100%);
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
        
        document.body.appendChild(toast);
        
        // Remove toast after 3 seconds
        setTimeout(() => {
            toast.style.animation = 'slideUp 0.3s ease-out reverse';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Filter events by current period
    // boundsOverride: the continuous calendar strip renders a WIDER range
    // than the visible period (the grid pills), while cards/map keep the
    // visible period — pass { start, end } to filter an arbitrary range.
    getFilteredEvents(boundsOverride = null) {
        // Handle case where allEvents is not yet loaded
        if (!this.allEvents || !Array.isArray(this.allEvents)) {
            logger.debug('CALENDAR', '🔍 FILTER: No allEvents available for filtering', {
                allEventsExists: !!this.allEvents,
                allEventsType: typeof this.allEvents,
                allEventsIsArray: Array.isArray(this.allEvents)
            });
            return [];
        }

        const { start, end } = boundsOverride || this.getCurrentPeriodBounds();
        
        logger.debug('CALENDAR', '🔍 FILTER: Starting event filtering', {
            totalEvents: this.allEvents.length,
            periodStart: start.toISOString(),
            periodEnd: end.toISOString(),
            currentView: this.currentView
        });
        
        // Expand recurring events into separate instances for each occurrence
        const expandedEvents = this.expandRecurringEvents(this.allEvents, start, end);
        
        const filtered = expandedEvents.filter(event => {
            // Special case: Always include measurement test events
            if (event.slug === 'measurement-test') {
                logger.debug('CALENDAR', `🔍 FILTER: Measurement test event ${event.name}: INCLUDED (special case)`);
                return true;
            }
            
            if (!event.startDate) {
                logger.debug('CALENDAR', `🔍 FILTER: Event has no startDate: ${event.name}`);
                return false;
            }
            
            // For all events (including expanded recurring events), check if they fall within the period
            const eventEndDate = this.getLogicalEndDate(event);
            const isInPeriod = this.isEventInPeriod(this.getLogicalStartDate(event), start, end, eventEndDate);
            logger.debug('CALENDAR', `🔍 FILTER: Event ${event.name}: ${isInPeriod ? 'INCLUDED' : 'EXCLUDED'}`, {
                eventDate: new Date(event.startDate).toISOString(),
                periodStart: start.toISOString(),
                periodEnd: end.toISOString(),
                isRecurring: event.recurring,
                isExpanded: event.isExpanded
            });
            return isInPeriod;
        });
        
        // Apply simple deduplication: for each date, show either recurring event OR override, never both
        const deduplicatedEvents = this.deduplicateByDate(filtered);
        
        // Sort events by upcoming time (earliest first)
        deduplicatedEvents.sort((a, b) => {
            const dateA = new Date(a.startDate);
            const dateB = new Date(b.startDate);
            
            // If dates are the same, sort by start time/multi-day
            if (dateA.toDateString() === dateB.toDateString()) {
                const aIsMultiDay = this.isMultiDay(a);
                const bIsMultiDay = this.isMultiDay(b);
                const aIsAllDay = !a.time;
                const bIsAllDay = !b.time;

                // 1. Multi-day events go first
                if (aIsMultiDay && !bIsMultiDay) return -1;
                if (!aIsMultiDay && bIsMultiDay) return 1;

                // 2. All-day events go second
                if (aIsAllDay && !bIsAllDay) return -1;
                if (!aIsAllDay && bIsAllDay) return 1;

                return dateA.getTime() - dateB.getTime();
            }
            
            // Otherwise sort by date
            return dateA.getTime() - dateB.getTime();
        });
        
        logger.debug('CALENDAR', '🔍 FILTER: Event filtering complete with deduplication', {
            totalEvents: this.allEvents.length,
            filteredEvents: filtered.length,
            deduplicatedEvents: deduplicatedEvents.length,
            filteredEventNames: deduplicatedEvents.map(e => e.name)
        });
        
        return deduplicatedEvents;
    }

    // Expand recurring events into separate instances for each occurrence
    expandRecurringEvents(events, start, end) {
        const expandedEvents = [];

        const overrideRecurrenceIdsByUid = new Map();
        for (const event of events) {
            if (!event?.recurrenceId) continue;
            const uid = event.uid || event.slug || event.name;
            if (!uid) continue;
            const recurrenceDate = event.recurrenceId instanceof Date ? event.recurrenceId : new Date(event.recurrenceId);
            if (Number.isNaN(recurrenceDate.getTime())) continue;
            const recurrenceKey = this.getLocalDateKey(recurrenceDate);
            if (!overrideRecurrenceIdsByUid.has(uid)) {
                overrideRecurrenceIdsByUid.set(uid, new Set());
            }
            overrideRecurrenceIdsByUid.get(uid).add(recurrenceKey);
        }
        
        for (const event of events) {
            // Always include non-recurring events
            if (!event.recurring) {
                expandedEvents.push(event);
                continue;
            }

            const uid = event.uid || event.slug || event.name;
            const overrideRecurrenceIds = uid ? overrideRecurrenceIdsByUid.get(uid) : null;
            
            // For recurring events, create separate instances for each occurrence
            const occurrences = this.getRecurringEventOccurrences(event, start, end);
            
            for (const occurrence of occurrences) {
                if (overrideRecurrenceIds && overrideRecurrenceIds.has(this.getLocalDateKey(occurrence))) {
                    continue;
                }
                // Create a new event instance for this occurrence
                const expandedEvent = {
                    ...event,
                    startDate: occurrence,
                    isExpanded: true, // Mark as expanded instance
                    originalStartDate: event.startDate // Keep reference to original
                };
                
                if (event.endDate && event.startDate) {
                    const duration = new Date(event.endDate).getTime() - new Date(event.startDate).getTime();
                    expandedEvent.endDate = new Date(occurrence.getTime() + duration);
                }
                
                expandedEvents.push(expandedEvent);
            }
        }
        
        logger.debug('CALENDAR', 'Recurring events expanded', {
            originalEvents: events.length,
            expandedEvents: expandedEvents.length,
            recurringEvents: events.filter(e => e.recurring).length,
            expandedRecurringEvents: expandedEvents.filter(e => e.isExpanded).length
        });
        
        return expandedEvents;
    }
    
    // Get all occurrences of a recurring event within a date range
    getRecurringEventOccurrences(event, start, end) {
        const occurrences = [];
        
        if (!event.recurring || !event.startDate) {
            return occurrences;
        }
        
        const current = new Date(start);
        
        // Check each day in the period
        while (current <= end) {
            if (this.doesRecurringEventOccurOnDate(event, current)) {
                const occurrenceDate = new Date(current);
                const originalStart = new Date(event.startDate);

                // Preserve the original event's local time components
                occurrenceDate.setHours(
                    originalStart.getHours(),
                    originalStart.getMinutes(),
                    originalStart.getSeconds(),
                    originalStart.getMilliseconds()
                );

                occurrences.push(occurrenceDate);
            }
            current.setDate(current.getDate() + 1);
        }
        
        return occurrences;
    }

    isRecurringEventInPeriod(event, start, end) {
        if (!event.startDate) return false;
        
        const current = new Date(start);
        
        // Check each day in the period
        while (current <= end) {
            if (this.doesRecurringEventOccurOnDate(event, current)) {
                return true;
            }
            current.setDate(current.getDate() + 1);
        }
        
        return false;
    }

    // Simple deduplication: for each date, show either recurring event OR override, never both
    deduplicateByDate(events) {
        logger.debug('CALENDAR', 'Applying simple date-based deduplication', {
            totalEvents: events.length
        });

        // Group events by date and UID
        const eventsByDateAndUID = new Map();
        
        for (const event of events) {
            const eventDate = new Date(event.startDate);
            // Use local date components instead of UTC to avoid timezone conversion issues
            const dateKey = this.getLocalDateKey(eventDate);
            const uid = event.uid || event.slug || event.name;
            const key = `${dateKey}-${uid}`;
            
            
            if (!eventsByDateAndUID.has(key)) {
                eventsByDateAndUID.set(key, []);
            }
            eventsByDateAndUID.get(key).push(event);
        }
        
        // For each date/UID combination, keep only the appropriate event
        const deduplicatedEvents = [];
        
        for (const [key, eventGroup] of eventsByDateAndUID) {
            
            // If there's only one event for this date/UID, keep it
            if (eventGroup.length === 1) {
                deduplicatedEvents.push(eventGroup[0]);
                continue;
            }
            
            // If there are multiple events for the same date/UID, prioritize overrides
            const overrideEvents = eventGroup.filter(e => e.recurrenceId);
            const expandedRecurringEvents = eventGroup.filter(e => e.isExpanded && e.recurring && !e.recurrenceId);
            
            // Keep override events if they exist, otherwise keep expanded recurring events
            if (overrideEvents.length > 0) {
                deduplicatedEvents.push(...overrideEvents);
                logger.debug('CALENDAR', 'Keeping override event, removing recurring', {
                    date: key.split('-')[0],
                    uid: key.split('-')[1],
                    overrideCount: overrideEvents.length,
                    expandedRecurringCount: expandedRecurringEvents.length
                });
            } else {
                // Keep expanded recurring events (these are the individual occurrences)
                deduplicatedEvents.push(...expandedRecurringEvents);
                logger.debug('CALENDAR', 'Keeping expanded recurring events', {
                    date: key.split('-')[0],
                    uid: key.split('-')[1],
                    expandedRecurringCount: expandedRecurringEvents.length
                });
            }
        }
        
        logger.debug('CALENDAR', 'Date-based deduplication complete', {
            originalEvents: events.length,
            deduplicatedEvents: deduplicatedEvents.length,
            removedDuplicates: events.length - deduplicatedEvents.length
        });
        
        return deduplicatedEvents;
    }

    // Deduplicate events based on UID and recurrenceId for list/map views
    deduplicateByUIDAndRecurrenceId(events, perOccurrence = false) {
        logger.debug('CALENDAR', 'Applying UID and recurrenceId-based deduplication for list/map views', {
            totalEvents: events.length
        });

        // Group events by UID and recurrenceId
        const eventsByUIDAndRecurrenceId = new Map();
        
        for (const event of events) {
            // Skip events without proper identification
            if (!event) {
                logger.warn('CALENDAR', 'Skipping null/undefined event in deduplication');
                continue;
            }
            
            const uid = event.uid || event.slug || event.name;
            const recurrenceId = event.recurrenceId || null;
            
            // Create a key that handles null recurrenceId properly
            // For Date objects, use ISO string; for null, use 'null'
            const recurrenceIdKey = recurrenceId instanceof Date ? recurrenceId.toISOString() : 'null';
            // perOccurrence: the rail's timeline renders a recurring event
            // once per occurrence, and the plain uid key collapsed all of a
            // weekly night's expanded instances into ONE card (they share a
            // uid and a null recurrenceId) — over a 7-day window that was
            // invisible, over the 63-day timeline it ate eight of nine.
            // The date joins the key so occurrences stay distinct while
            // same-date duplicates still fold.
            let occurrenceKey = '';
            if (perOccurrence) {
                try {
                    const logical = this.getLogicalStartDate(event);
                    if (logical) occurrenceKey = `-${this.getLocalDateKey(logical)}`;
                } catch (e) { occurrenceKey = ''; }
            }
            const key = `${uid}-${recurrenceIdKey}${occurrenceKey}`;
            
            logger.debug('CALENDAR', 'Processing event for UID/recurrenceId deduplication', {
                eventName: event.name,
                uid: uid,
                recurrenceId: recurrenceId,
                recurrenceIdKey: recurrenceIdKey,
                key: key
            });
            
            if (!eventsByUIDAndRecurrenceId.has(key)) {
                eventsByUIDAndRecurrenceId.set(key, []);
            }
            eventsByUIDAndRecurrenceId.get(key).push(event);
        }
        
        // For each UID/recurrenceId combination, keep only one event
        const deduplicatedEvents = [];
        
        for (const [key, eventGroup] of eventsByUIDAndRecurrenceId) {
            if (eventGroup.length === 1) {
                // Only one event for this UID/recurrenceId combination
                deduplicatedEvents.push(eventGroup[0]);
                logger.debug('CALENDAR', 'Keeping single event for list/map', {
                    uid: eventGroup[0].uid,
                    recurrenceId: eventGroup[0].recurrenceId,
                    eventName: eventGroup[0].name
                });
            } else {
                // Multiple events with same UID and recurrenceId - keep the first one
                const eventToKeep = eventGroup[0];
                deduplicatedEvents.push(eventToKeep);
                
                logger.info('CALENDAR', 'Deduplicating multiple events with same UID/recurrenceId for list/map', {
                    uid: eventToKeep.uid,
                    recurrenceId: eventToKeep.recurrenceId,
                    eventName: eventToKeep.name,
                    duplicateCount: eventGroup.length - 1,
                    duplicates: eventGroup.slice(1).map(e => e.name)
                });
            }
        }
        
        logger.info('CALENDAR', 'UID and recurrenceId-based deduplication complete for list/map', {
            originalEvents: events.length,
            deduplicatedEvents: deduplicatedEvents.length,
            removedDuplicates: events.length - deduplicatedEvents.length,
            uniqueUIDRecurrenceIdCombinations: eventsByUIDAndRecurrenceId.size
        });
        
        return deduplicatedEvents;
    }

    // Helper method to get a timezone-aware date key for deduplication
    // Uses local date components instead of UTC to avoid timezone conversion issues
    getLocalDateKey(date) {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // Generate the CONTINUOUS calendar strip. The grid renders a wider range
    // than the visible period — week: 21 day columns (visible week ± 7) in a
    // horizontal scroller; month: previous/current/next month stacked in a
    // vertical scroller. Cards, map, label, and URL follow the VISIBLE
    // period, recomputed only on scroll settle (onGridSettle) — never per
    // frame, so the sliding itself is native scroll and stays cheap.
    generateCalendarEvents(events, hideEvents = false) {
        const { start } = this.getCurrentPeriodBounds();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (this.currentView === 'week') {
            const stripStart = new Date(start);
            stripStart.setDate(stripStart.getDate() - 28);
            this.stripStartDate = new Date(stripStart);
            const stripEnd = new Date(stripStart);
            stripEnd.setDate(stripStart.getDate() + this.stripDayCount - 1);
            stripEnd.setHours(23, 59, 59, 999);
            const stripEvents = this.getFilteredEvents({ start: stripStart, end: stripEnd });
            this.lastStripEvents = stripEvents;
            return this.generateWeekView(stripEvents, stripStart, stripEnd, today, hideEvents, this.stripDayCount);
        }

        const months = [-3, -2, -1, 0, 1, 2, 3].map(d => new Date(start.getFullYear(), start.getMonth() + d, 1));
        this.stripMonths = months;
        // CONTINUOUS weeks, "like a calendar": Sunday on/before the previous
        // month's 1st through Saturday on/after the next month's last day —
        // every day renders exactly once, no padded boundary cells, and the
        // 1st of each month carries its month name (+ an accent edge). The
        // Sun-Sat header row is separate so it can stick to the scroller top.
        const stripStart = new Date(months[0]);
        stripStart.setDate(stripStart.getDate() - stripStart.getDay());
        stripStart.setHours(0, 0, 0, 0);
        const lastMonth = months[months.length - 1];
        const lastDay = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0);
        const stripEnd = new Date(lastDay);
        stripEnd.setDate(lastDay.getDate() + (6 - lastDay.getDay()));
        stripEnd.setHours(23, 59, 59, 999);
        // Query a WIDER range than the strip's nominal bounds: generateMonthView
        // rounds its cell range up to whole weeks, so it renders a few days
        // past stripEnd — those cells came out EMPTY (their events were never
        // queried) even when the day had events, and they changed content on
        // the next rebuild once the range moved. Pad both ends by a week.
        const queryStart = new Date(stripStart);
        queryStart.setDate(queryStart.getDate() - 7);
        const queryEnd = new Date(stripEnd);
        queryEnd.setDate(queryEnd.getDate() + 7);
        const stripEvents = this.getFilteredEvents({ start: queryStart, end: queryEnd });
        this.lastStripEvents = stripEvents;
        const dayHeadersHtml = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `
            <div class="calendar-day-header"><h4>${d}</h4></div>`).join('');
        return `
            <div class="month-strip-days">${dayHeadersHtml}</div>
            <div class="month-strip-grid month-view-grid">${this.generateMonthView(stripEvents, stripStart, stripEnd, today, hideEvents)}</div>
        `;
    }

    // A rendered-strip event by slug (the month sheet needs event data for
    // pills whose month isn't the currently visible one)
    getRenderedEventBySlug(slug, dateKey = null) {
        if (!slug || !Array.isArray(this.lastStripEvents)) return null;
        const matches = this.lastStripEvents.filter(ev => ev.slug === slug);
        if (!matches.length) return null;
        if (dateKey) {
            // recurring events expand to many occurrences sharing one slug —
            // the pill's own day picks the right one
            const onDay = matches.find(ev => {
                const d = this.getLogicalStartDate(ev);
                return d && this.getLocalDateKey(d) === dateKey;
            });
            if (onDay) return onDay;
        }
        return matches[0];
    }

    generateWeekView(events, start, end, today, hideEvents = false, dayCount = 7) {
        const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const days = [];

        for (let i = 0; i < dayCount; i++) {
            const currentDay = new Date(start);
            currentDay.setDate(start.getDate() + i);
            days.push(currentDay);
        }

        logger.debug('CALENDAR', `Generating week view with mobile-optimized event display`, {
            eventCount: events.length,
            weekStart: start.toISOString().split('T')[0],
            weekEnd: end.toISOString().split('T')[0],
            hideEvents
        });

        let seenMultiDayEvents = new Set();

        return days.map(day => {
            const dayEvents = events.filter(event => {
                if (!event.startDate) return false;
                
                // Set dayDate for comparisons
                const dayDate = new Date(day);
                dayDate.setHours(0, 0, 0, 0);

                // Multi-day events check
                if (this.isMultiDay(event)) {
                    const eventDate = this.getLogicalStartDate(event);
                    eventDate.setHours(0, 0, 0, 0);
                    const eventEndDate = this.getLogicalEndDate(event);
                    eventEndDate.setHours(0, 0, 0, 0);

                    return dayDate >= eventDate && dayDate <= eventEndDate;
                }

                // For already expanded recurring events, just check if the date matches
                if (event.isExpanded) {
                    const eventDate = this.getLogicalStartDate(event);
                    eventDate.setHours(0, 0, 0, 0);
                    
                    return eventDate.getTime() === dayDate.getTime();
                }
                
                // For non-expanded recurring events, use the occurrence check
                if (event.recurring) {
                    return this.doesRecurringEventOccurOnDate(event, day);
                }
                
                // For non-recurring events, check exact date match
                const eventDate = this.getLogicalStartDate(event);
                eventDate.setHours(0, 0, 0, 0);
                
                return eventDate.getTime() === dayDate.getTime();
            });
            
            // Events are already deduplicated in getFilteredEvents, but need to be sorted for the day
            const filteredDayEvents = dayEvents.sort((a, b) => {
                const aIsMultiDay = this.isMultiDay(a);
                const bIsMultiDay = this.isMultiDay(b);
                const aIsAllDay = !a.time;
                const bIsAllDay = !b.time;

                // 1. Multi-day events go first
                if (aIsMultiDay && !bIsMultiDay) return -1;
                if (!aIsMultiDay && bIsMultiDay) return 1;

                // 2. All-day events go second
                if (aIsAllDay && !bIsAllDay) return -1;
                if (!aIsAllDay && bIsAllDay) return 1;

                // 3. Sort by start time
                const dateA = new Date(a.startDate);
                const dateB = new Date(b.startDate);
                return dateA.getTime() - dateB.getTime();
            });

            // Week view never hides events — the mobile week frame grows
            // downward when a big week (festival runs) needs the room
            const eventsHtml = filteredDayEvents.length > 0
                ? filteredDayEvents.map(event => {
                    const isMultiDay = this.isMultiDay(event);
                    const mobileTime = isMultiDay && window.formatEventDates ? window.formatEventDates(event) : (event.time ? this.formatTimeForMobile(event.time) : null);

                    // Determine multi-day flow class
                    let flowClass = '';
                    let showTitle = true;

                    if (isMultiDay) {
                        const eventStart = this.getLogicalStartDate(event);
                        eventStart.setHours(0, 0, 0, 0);
                        const eventEnd = this.getLogicalEndDate(event);
                        eventEnd.setHours(0, 0, 0, 0);

                        const dayDate = new Date(day);
                        dayDate.setHours(0, 0, 0, 0);

                        if (dayDate.getTime() === eventStart.getTime()) {
                            flowClass = ' multi-day multi-day-start';
                        } else if (dayDate.getTime() === eventEnd.getTime()) {
                            flowClass = ' multi-day multi-day-end';
                        } else {
                            flowClass = ' multi-day multi-day-middle';
                        }

                        const eventId = event.uid || event.slug;
                        // Track occurrences uniquely by appending the eventStart timestamp
                        const occurrenceId = `${eventId}_${eventStart.getTime()}`;
                        if (seenMultiDayEvents.has(occurrenceId)) {
                            showTitle = false;
                        } else {
                            seenMultiDayEvents.add(occurrenceId);
                        }
                    }

                    return `
                        <div class="event-item${flowClass}" data-event-slug="${event.slug}" title="${event.name} at ${event.bar || 'Location'}${event.time ? ' - ' + event.time : ''}">
                            ${showTitle ? this.generateEventNameElements(event, hideEvents) : `<div style="visibility: hidden;">${this.generateEventNameElements(event, hideEvents)}</div>`}
                            ${mobileTime ? `<div class="event-time">${mobileTime}</div>` : ''}
                            <div class="event-venue">${this.generateFaviconChipHtml(event)}${event.bar || ''}</div>
                        </div>
                    `;
                }).join('')
                : '';

            const isToday = day.getTime() === today.getTime();
            const currentClass = isToday ? ' current' : '';
            const dayName = daysOfWeek[day.getDay()];
            const eventCount = filteredDayEvents.length;

            return `
                <div class="calendar-day week-view${currentClass}" data-day="${dayName}" data-date="${this.getLocalDateKey(day)}">
                    <div class="day-header">
                        <h3>${dayName}</h3>
                        <div class="day-meta">
                            <div class="day-date">${day.getDate()}</div>
                        </div>
                    </div>
                    <div class="daily-events">
                        ${eventsHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    generateMonthView(events, start, end, today, hideEvents = false) {
        // Renders the day CELLS for a Sunday-aligned continuous range
        // (the sticky Sun-Sat header row is emitted by the caller)
        const firstDay = new Date(start);
        const lastDay = new Date(end);
        
        // Get the first day of the calendar grid (might be from previous month)
        const calendarStart = new Date(firstDay);
        calendarStart.setDate(firstDay.getDate() - firstDay.getDay());
        
        // Calculate the minimum number of weeks needed to display the month
        const totalDays = Math.ceil((lastDay.getTime() - calendarStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        const weeksNeeded = Math.ceil(totalDays / 7);
        
        // Get the last day of the calendar grid (optimized to avoid extra rows)
        const calendarEnd = new Date(calendarStart);
        calendarEnd.setDate(calendarStart.getDate() + (weeksNeeded * 7) - 1);
        
        const days = [];
        const current = new Date(calendarStart);
        
        while (current <= calendarEnd) {
            days.push(new Date(current));
            current.setDate(current.getDate() + 1);
        }
        
        logger.debug('CALENDAR', `Generated month view with ${weeksNeeded} weeks (${days.length} days)`, {
            monthStart: start.toISOString().split('T')[0],
            monthEnd: end.toISOString().split('T')[0],
            calendarStart: calendarStart.toISOString().split('T')[0],
            calendarEnd: calendarEnd.toISOString().split('T')[0],
            weeksNeeded: weeksNeeded,
            totalDays: days.length,
            hideEvents
        });

        let seenMultiDayEvents = new Set();

        const daysHtml = days.map(day => {
            if (day.getDay() === 0) {
                seenMultiDayEvents.clear();
            }
            const dayEvents = events.filter(event => {
                if (!event.startDate) return false;
                
                const dayDate = new Date(day);
                dayDate.setHours(0, 0, 0, 0);

                // Multi-day events check
                if (this.isMultiDay(event)) {
                    const eventDate = this.getLogicalStartDate(event);
                    eventDate.setHours(0, 0, 0, 0);
                    const eventEndDate = this.getLogicalEndDate(event);
                    eventEndDate.setHours(0, 0, 0, 0);

                    return dayDate >= eventDate && dayDate <= eventEndDate;
                }

                // For already expanded recurring events, just check if the date matches
                if (event.isExpanded) {
                    const eventDate = this.getLogicalStartDate(event);
                    eventDate.setHours(0, 0, 0, 0);
                    
                    const matches = eventDate.getTime() === dayDate.getTime();
                    if (matches) {
                        logger.debug('CALENDAR', 'Month view: Expanded recurring event matches day', {
                            eventName: event.name,
                            eventDate: eventDate.toISOString().split('T')[0],
                            dayDate: dayDate.toISOString().split('T')[0],
                            isExpanded: true
                        });
                    }
                    return matches;
                }
                
                // For non-expanded recurring events, use the occurrence check
                if (event.recurring) {
                    const matches = this.doesRecurringEventOccurOnDate(event, day);
                    if (matches) {
                        logger.debug('CALENDAR', 'Month view: Non-expanded recurring event matches day', {
                            eventName: event.name,
                            dayDate: day.toISOString().split('T')[0],
                            isExpanded: false,
                            recurring: true
                        });
                    }
                    return matches;
                }
                
                // For non-recurring events, check exact date match
                const eventDate = this.getLogicalStartDate(event);
                eventDate.setHours(0, 0, 0, 0);
                
                return eventDate.getTime() === dayDate.getTime();
            });
            
            // Events are already deduplicated in getFilteredEvents, but need to be sorted for the day
            const filteredDayEvents = dayEvents.sort((a, b) => {
                const aIsMultiDay = this.isMultiDay(a);
                const bIsMultiDay = this.isMultiDay(b);
                const aIsAllDay = !a.time;
                const bIsAllDay = !b.time;

                // 1. Multi-day events go first
                if (aIsMultiDay && !bIsMultiDay) return -1;
                if (!aIsMultiDay && bIsMultiDay) return 1;

                // 2. All-day events go second
                if (aIsAllDay && !bIsAllDay) return -1;
                if (!aIsAllDay && bIsAllDay) return 1;

                // 3. Sort by start time
                const dateA = new Date(a.startDate);
                const dateB = new Date(b.startDate);
                return dateA.getTime() - dateB.getTime();
            });

            const isToday = day.getTime() === today.getTime();
            const currentClass = isToday ? ' current' : '';
            const isMonthFirst = day.getDate() === 1;
            const monthFirstClass = isMonthFirst ? ' month-first' : '';
            const hasEventsClass = filteredDayEvents.length > 0 ? ' has-events' : '';

            // Multi-day SEGMENTS always render — dropping one silently broke
            // the bar mid-run whenever a cell was crowded (owner-reported:
            // BEEFMINCE Sitges week). Month shows EVERY event (no +N collapse);
            // the continuous strip renders every day exactly once.
            const multiDaySegments = filteredDayEvents.filter(event => this.isMultiDay(event));
            const singleDayEvents = filteredDayEvents.filter(event => !this.isMultiDay(event));
            const eventsToShow = multiDaySegments.concat(singleDayEvents);
            const additionalEventsCount = 0;
            
            const eventsHtml = eventsToShow.length > 0 
                ? eventsToShow.map(event => {
                    const isMultiDay = this.isMultiDay(event);
                    const mobileTime = isMultiDay && window.formatEventDates ? window.formatEventDates(event) : (event.time ? this.formatTimeForMobile(event.time) : null);

                    // Determine multi-day flow class
                    let flowClass = '';
                    let showTitle = true;

                    if (isMultiDay) {
                        const eventStart = this.getLogicalStartDate(event);
                        eventStart.setHours(0, 0, 0, 0);
                        const eventEnd = this.getLogicalEndDate(event);
                        eventEnd.setHours(0, 0, 0, 0);

                        const dayDate = new Date(day);
                        dayDate.setHours(0, 0, 0, 0);

                        if (dayDate.getTime() === eventStart.getTime()) {
                            flowClass = ' multi-day multi-day-start';
                        } else if (dayDate.getTime() === eventEnd.getTime()) {
                            flowClass = ' multi-day multi-day-end';
                        } else {
                            flowClass = ' multi-day multi-day-middle';
                        }

                        const eventId = event.uid || event.slug;
                        // Track occurrences uniquely by appending the eventStart timestamp
                        const occurrenceId = `${eventId}_${eventStart.getTime()}`;
                        if (seenMultiDayEvents.has(occurrenceId)) {
                            showTitle = false;
                        } else {
                            seenMultiDayEvents.add(occurrenceId);
                        }
                    }
                    
                    return `
                        <div class="event-item${flowClass}" data-event-slug="${event.slug}" title="${event.name} at ${event.bar || 'Location'}${event.time ? ' - ' + event.time : ''}">
                            ${showTitle ? this.generateEventNameElements(event, hideEvents) : `<div style="visibility: hidden;">${this.generateEventNameElements(event, hideEvents)}</div>`}
                            ${mobileTime ? `<div class="event-time">${mobileTime}</div>` : ''}
                            <div class="event-venue">${event.bar || ''}</div>
                        </div>
                    `;
                }).join('') + (additionalEventsCount > 0 ? `<div class="more-events">+${additionalEventsCount}</div>` : '')
                : '';

            return `
                <div class="calendar-day month-day${currentClass}${monthFirstClass}${hasEventsClass}" data-date="${this.getLocalDateKey(day)}">
                    <div class="day-header">
                        <span class="day-number">${isMonthFirst ? day.toLocaleDateString('en-US', { month: 'short' }) + ' 1' : day.getDate()}</span>
                        ${isToday ? `<span class="day-indicator">Today</span>` : ''}
                    </div>
                    <div class="day-events">
                        ${eventsHtml}
                    </div>
                </div>
            `;
        }).join('');

        return daysHtml;
    }

    applyTheme(map) {
        const PURPLE = "#667eea";
        const layers = map.getStyle().layers;

        for (const layer of layers) {
            const id = layer.id.toLowerCase();

            try {
                // water
                if (id.includes("water")) {
                    if (layer.type === "fill") {
                        map.setPaintProperty(layer.id, "fill-color", PURPLE);
                    }
                    if (layer.type === "line") {
                        map.setPaintProperty(layer.id, "line-color", PURPLE);
                    }
                }

                /* Other theme examples for later:
                // land
                if (id.includes("land") || id.includes("natural")) {
                    if (layer.type === "fill") {
                        map.setPaintProperty(layer.id, "fill-color", "#1b102b");
                    }
                }

                // roads
                if (id.includes("road")) {
                    if (layer.type === "line") {
                        map.setPaintProperty(layer.id, "line-color", "#3a2a55");
                        map.setPaintProperty(layer.id, "line-opacity", 0.35);
                    }
                }

                // labels
                if (id.includes("label")) {
                    if (layer.type === "symbol") {
                        map.setPaintProperty(layer.id, "text-color", "#b7a7d9");
                    }
                }
                */

            } catch (e) {}
        }
    }

    // Initialize map
    initializeMap(cityConfig, events, opts = {}) {
        logger.debug('MAP', 'Starting map initialization', {
            cityName: cityConfig?.name,
            eventCount: events?.length,
            mapContainerExists: !!document.querySelector('#events-map'),
            leafletAvailable: typeof L !== 'undefined'
        });

        const mapContainer = document.querySelector('#events-map');
        if (!mapContainer || typeof maplibregl === 'undefined') {
            logger.warn('MAP', 'Map initialization skipped - missing container or MapLibre', {
                mapContainerExists: !!mapContainer,
                maplibreAvailable: typeof maplibregl !== 'undefined'
            });
            return;
        }

        try {
            // The bottom sheet's read-only map twin (createSheetMap) renders
            // exactly this marker set
            this.lastMapEvents = events;

            // Filter events with valid coordinates
            const eventsWithCoords = events.filter(event =>
                event.coordinates?.lat && event.coordinates?.lng &&
                !isNaN(event.coordinates.lat) && !isNaN(event.coordinates.lng)
            );

            // Set up default map center and zoom (lower zoom to show more area)
            let mapCenter = [cityConfig.coordinates.lat, cityConfig.coordinates.lng];
            let mapZoom = cityConfig.mapZoom || 10; // Reduced from 11 to 10 for better overview on desktop

            let map;

            if (window.eventsMap) {
                logger.debug('MAP', 'Reusing existing map');
                map = window.eventsMap;

                // Settle refresh with an unchanged marker set: keep every
                // marker in place — tearing them down per one-day slide made
                // the whole map blink
                if (opts.keepCamera && window.eventsMapMarkersBySlug) {
                    const nextSlugs = eventsWithCoords.map(ev => ev.slug).sort().join('|');
                    const haveSlugs = Object.keys(window.eventsMapMarkersBySlug).sort().join('|');
                    if (nextSlugs === haveSlugs) {
                        logger.debug('MAP', 'Marker set unchanged on settle refresh - skipping rebuild');
                        return;
                    }
                }

                // Clear existing markers
                if (window.eventsMapMarkers) {
                    window.eventsMapMarkers.forEach(marker => marker.remove());
                }

                // Update map center and zoom in case the city changed —
                // unless the caller asked to keep the camera (strip settle
                // refreshes must never move the map under a slide)
                if (!opts.keepCamera) {
                    map.jumpTo({ center: [mapCenter[1], mapCenter[0]], zoom: mapZoom });
                }
            } else {
                logger.debug('MAP', 'Creating new map instance');
                map = new maplibregl.Map({
                    container: 'events-map',
                    style: 'https://tiles.openfreemap.org/styles/liberty',
                    center: [mapCenter[1], mapCenter[0]],
                    zoom: mapZoom,
                    renderWorldCopies: false
                });

                map.on('style.load', () => {
                    this.applyTheme(map);
                });

                // Add custom controls to maplibregl
                class FitMarkersControl {
                    onAdd(map) {
                        this._map = map;
                        this._container = document.createElement('div');
                        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
                        this._container.innerHTML = `
                            <button class="map-control-btn" id="zoom-to-fit-btn" onclick="fitAllMarkers()" title="Show All Events">
                                <i class="bi bi-pin-map" id="zoom-to-fit-icon"></i>
                            </button>
                        `;
                        return this._container;
                    }
                    onRemove() {
                        this._container.parentNode.removeChild(this._container);
                        this._map = undefined;
                    }
                }
                map.addControl(new FitMarkersControl(), 'top-left');

                class MyLocationControl {
                    onAdd(map) {
                        this._map = map;
                        this._container = document.createElement('div');
                        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
                        this._container.innerHTML = `
                            <button class="map-control-btn" id="location-btn" onclick="showMyLocation(true)" title="Show My Location">
                                <i class="bi bi-crosshair2" id="location-icon"></i>
                            </button>
                        `;
                        return this._container;
                    }
                    onRemove() {
                        this._container.parentNode.removeChild(this._container);
                        this._map = undefined;
                    }
                }
                map.addControl(new MyLocationControl(), 'top-left');

                // Hide-others toggle: with an event selected, hides every
                // other marker; with nothing selected it changes nothing
                class HideOthersControl {
                    onAdd(map) {
                        this._map = map;
                        this._container = document.createElement('div');
                        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
                        this._container.innerHTML = `
                            <button class="map-control-btn" id="solo-btn" onclick="toggleMapSolo()" title="Hide other events">
                                <i class="bi bi-eye-slash" id="solo-icon"></i>
                            </button>
                        `;
                        return this._container;
                    }
                    onRemove() {
                        this._container.parentNode.removeChild(this._container);
                        this._map = undefined;
                    }
                }
                map.addControl(new HideOthersControl(), 'top-left');
                // Add navigation controls (zoom in/out)
                map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

                // Initialize location status
                updateLocationStatus();
            }
            
            let markersAdded = 0;
            const markers = []; // Store markers for fit all function
            
            logger.debug('MAP', 'Starting marker creation', {
                totalEvents: events.length,
                eventsWithCoords: eventsWithCoords.length
            });
            
            events.forEach((event, index) => {
                if (event.coordinates?.lat && event.coordinates?.lng && 
                    !isNaN(event.coordinates.lat) && !isNaN(event.coordinates.lng)) {
                    
                    try {
                        logger.debug('MAP', `Creating marker ${index + 1}/${events.length}`, {
                            eventName: event.name,
                            coordinates: event.coordinates,
                            hasWebsite: !!event.website
                        });
                        
                        // Create custom marker icon with favicon or fallback
                        const markerIcon = this.createMarkerIcon(event);
                        
                        const marker = new maplibregl.Marker({
                            element: markerIcon,
                            anchor: 'bottom'
                        })
                            .setLngLat([event.coordinates.lng, event.coordinates.lat])
                            .addTo(map);

                        marker.getElement().addEventListener('click', () => {
                            // Select the event without changing page scroll
                            const eventDateISO = event.date || this.formatDateToISO(this.currentDate);
                            this.toggleEventSelection(event.slug, eventDateISO);
                            logger.userInteraction('MAP', 'Marker clicked, event selected', { eventSlug: event.slug });
                        });

                        // Store the slug on the marker object for later reference
                        marker.eventSlug = event.slug;
                        markers.push(marker);
                        markersAdded++;
                        
                        logger.debug('MAP', `Marker ${index + 1} created successfully`);
                    } catch (markerError) {
                        logger.warn('MAP', `Failed to create marker for event: ${event.name}`, {
                            error: markerError.message,
                            eventIndex: index
                        });
                    }
                }
            });

            // Fit map to show all markers using maplibre's bounds calculation
            if (markers.length > 0 && !opts.keepCamera) {
                const bounds = new maplibregl.LngLatBounds();
                markers.forEach(marker => {
                    bounds.extend(marker.getLngLat());
                });
                map.fitBounds(bounds, {
                    padding: 20,
                    maxZoom: mapZoom
                });

            }

            logger.componentLoad('MAP', `Map initialized with ${markersAdded} markers for ${cityConfig.name}`, {
                markersAdded,
                cityName: cityConfig.name,
                mapCenter,
                mapZoom
            });
            window.eventsMap = map;
            window.eventsMapMarkers = markers; // Store markers globally for controls
            
            // Store marker references by event slug for easy access
            window.eventsMapMarkersBySlug = {};
            markers.forEach(marker => {
                const eventSlug = marker.eventSlug;
                if (eventSlug) {
                    window.eventsMapMarkersBySlug[eventSlug] = marker;
                }
            });
            applyMapSoloVisibility();
            
            logger.debug('MAP', 'Map markers created and stored by slug', {
                totalMarkers: markers.length,
                markersBySlugCount: Object.keys(window.eventsMapMarkersBySlug).length,
                selectedEventSlug: this.selectedEventSlug,
                hasSelectedMarker: !!(this.selectedEventSlug && window.eventsMapMarkersBySlug[this.selectedEventSlug])
            });

            // Favicons now load directly in marker creation
        } catch (error) {
            logger.componentError('MAP', 'Failed to initialize map', error);
        }
    }

    // A read-only twin of the main events map for the bottom sheet: same
    // style, same purple-water recolor (applyTheme), the same favicon marker
    // elements from createMarkerIcon over the SAME event set the main map
    // shows (lastMapEvents), and the city's own framing (city zoom, fitBounds
    // zooms out only — exactly the main map's fit). The given slug's marker
    // carries the main map's selected state, the rest its dimmed state; NO
    // marker is clickable — the sheet map is a viewer, not a selector.
    // Returns the map instance so the caller can .remove() it on close.
    createSheetMap(container, selectedSlug) {
        if (typeof maplibregl === 'undefined' || !container || !this.currentCityConfig?.coordinates) {
            return null;
        }
        try {
            const cityConfig = this.currentCityConfig;
            const events = this.lastMapEvents || [];
            const mapZoom = cityConfig.mapZoom || 10;
            const map = new maplibregl.Map({
                container,
                style: 'https://tiles.openfreemap.org/styles/liberty',
                center: [cityConfig.coordinates.lng, cityConfig.coordinates.lat],
                zoom: mapZoom,
                renderWorldCopies: false
            });
            map.on('style.load', () => {
                this.applyTheme(map);
            });
            map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
            // the sheet's own hide-others toggle — the sheet always has a
            // selected event, so ON leaves just its marker
            const sheetMarkers = [];
            let sheetSolo = false;
            class SheetSoloControl {
                onAdd() {
                    this._container = document.createElement('div');
                    this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'map-control-btn';
                    btn.title = 'Hide other events';
                    btn.innerHTML = '<i class="bi bi-eye-slash"></i>';
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        sheetSolo = !sheetSolo;
                        btn.classList.toggle('map-solo-on', sheetSolo);
                        btn.querySelector('i').className = 'bi ' + (sheetSolo ? 'bi-eye' : 'bi-eye-slash');
                        sheetMarkers.forEach(mk =>
                            mk.el.classList.toggle('marker-solo-hidden', sheetSolo && !mk.selected));
                    });
                    this._container.appendChild(btn);
                    return this._container;
                }
                onRemove() {
                    if (this._container.parentNode) this._container.parentNode.removeChild(this._container);
                }
            }
            map.addControl(new SheetSoloControl(), 'top-left');
            const bounds = new maplibregl.LngLatBounds();
            let markerCount = 0;
            events.forEach(event => {
                if (!(event.coordinates?.lat && event.coordinates?.lng) ||
                    isNaN(event.coordinates.lat) || isNaN(event.coordinates.lng)) {
                    return;
                }
                const markerIcon = this.createMarkerIcon(event);
                // mirror highlightMapMarker's classes: the sheet's event is
                // selected, everything else dimmed (and an unmapped sheet
                // event leaves all markers dimmed, same as the main map)
                const isSelectedMarker = event.slug === selectedSlug;
                if (isSelectedMarker) {
                    markerIcon.classList.add('marker-selected');
                } else {
                    markerIcon.classList.add('marker-dimmed');
                }
                sheetMarkers.push({ el: markerIcon, selected: isSelectedMarker });
                new maplibregl.Marker({ element: markerIcon, anchor: 'bottom' })
                    .setLngLat([event.coordinates.lng, event.coordinates.lat])
                    .addTo(map);
                bounds.extend([event.coordinates.lng, event.coordinates.lat]);
                markerCount++;
            });
            const selectedShown = events.some(ev => ev.slug === selectedSlug &&
                ev.coordinates?.lat && ev.coordinates?.lng);
            if (!selectedShown) {
                // the sheet's event isn't in the visible period's marker set
                // (a neighbor-month pill) — add its own selected marker so
                // the map never shows all-dimmed-none-selected
                const extra = this.getRenderedEventBySlug(selectedSlug);
                if (extra && extra.coordinates?.lat && extra.coordinates?.lng &&
                    !isNaN(extra.coordinates.lat) && !isNaN(extra.coordinates.lng)) {
                    const icon = this.createMarkerIcon(extra);
                    icon.classList.add('marker-selected');
                    sheetMarkers.push({ el: icon, selected: true });
                    new maplibregl.Marker({ element: icon, anchor: 'bottom' })
                        .setLngLat([extra.coordinates.lng, extra.coordinates.lat])
                        .addTo(map);
                    bounds.extend([extra.coordinates.lng, extra.coordinates.lat]);
                    markerCount++;
                }
            }
            if (markerCount > 0) {
                map.fitBounds(bounds, { padding: 20, maxZoom: mapZoom });
            }
            logger.debug('MAP', 'Sheet map created', { markerCount, selectedSlug });
            return map;
        } catch (error) {
            logger.warn('MAP', 'Sheet map creation failed', { error: error?.message });
            return null;
        }
    }




    // Slide the week strip so `date` is inside the visible window — before
    // the window it becomes the leftmost day, after it the rightmost. The
    // settle machinery then updates label/URL/cards/map. A date outside the
    // rendered strip re-renders centered on it instead.
    scrollWeekStripToDate(date) {
        const grid = document.querySelector('.calendar-grid');
        const target = new Date(date);
        target.setHours(0, 0, 0, 0);
        if (!grid || !this.stripStartDate || grid.scrollWidth <= 0) {
            this.currentDate = target;
            return;
        }
        const idx = Math.round((target - this.stripStartDate) / 86400000);
        if (idx < 0 || idx >= this.stripDayCount) {
            this.currentDate = target;
            this.updateCalendarDisplay();
            return;
        }
        const curIdx = Math.round((this.getCurrentPeriodBounds().start - this.stripStartDate) / 86400000);
        const newStart = idx < curIdx ? idx : Math.max(0, idx - 6);
        const dayW = grid.scrollWidth / this.stripDayCount;
        grid.scrollTo({ left: Math.round(newStart * dayW), behavior: 'smooth' });
    }

    // A selection whose day slid outside the visible window RESETS — leaving
    // it active greyed the whole calendar/map/list with nothing visibly
    // selected (owner report: select fuzzy, swipe it out of view)
    clearSelectionIfOutOfBounds() {
        if (!this.selectedEventSlug || !this.selectedEventDateISO) return;
        const parts = this.selectedEventDateISO.split('-');
        const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12);
        if (isNaN(d.getTime())) return;
        const { start, end } = this.getCurrentPeriodBounds();
        if (d >= start && d <= end) return;
        // the selected DAY left the window — but a recurring event often has
        // an occurrence inside the new window (weekly events, constantly):
        // re-bind the selection to that occurrence and stay selected. Reset
        // only when the event doesn't occur in the window at all.
        const occurrence = this.getFilteredEvents().find(ev => ev.slug === this.selectedEventSlug);
        if (occurrence) {
            const od = this.getLogicalStartDate(occurrence);
            if (od) this.selectedEventDateISO = this.getLocalDateKey(od);
            logger.debug('EVENT', 'Selection re-bound to in-window occurrence', {
                slug: this.selectedEventSlug,
                date: this.selectedEventDateISO
            });
            return;
        }
        this.clearEventSelection();
    }

    // Swap a container's HTML while REUSING already-decoded <img> nodes by
    // src. The calendar grid is innerHTML-swapped on every strip rebuild;
    // recreating its favicon chips made every icon in the week view flash
    // (owner report). Same trick the events list uses for its cards.
    swapHtmlPreservingImages(container, html) {
        const shell = document.createElement('div');
        shell.innerHTML = html;

        // 1. REUSE unchanged day cells outright. A strip rebuild re-renders a
        // range that mostly overlaps what is already on screen; recreating
        // those cells threw away their pills' colours and their favicons'
        // decoded pixels, which is the blink at a month edge. A cell whose
        // markup is byte-identical is moved across as the SAME node, so
        // nothing about it repaints.
        const oldCells = new Map();
        container.querySelectorAll('[data-date]').forEach(cell => {
            const key = cell.getAttribute('data-date');
            if (key && !oldCells.has(key)) oldCells.set(key, cell);
        });
        let reusedCells = 0;
        shell.querySelectorAll('[data-date]').forEach(fresh => {
            // EVERY fresh cell gets stamped, including ones with no previous
            // counterpart: an unstamped cell can never be reused later, and
            // the cells a rebuild newly renders are exactly the ones the
            // NEXT rebuild has to keep (the "second drag blinks" bug).
            const sig = this.hashString(fresh.outerHTML);
            const key = fresh.getAttribute('data-date');
            const old = key && oldCells.get(key);
            if (old && old.dataset.cellSig === sig) {
                oldCells.delete(key);
                fresh.replaceWith(old);
                reusedCells++;
                return;
            }
            fresh.dataset.cellSig = sig;
        });

        // 2. for whatever is genuinely new, still hand over already-decoded
        // <img> nodes by RESOLVED url (the two sides can spell the same
        // image relatively vs absolutely)
        const pool = new Map();
        container.querySelectorAll('img').forEach(img => {
            const src = img.src;
            if (src && img.complete && img.naturalWidth > 0 && !pool.has(src)) pool.set(src, img);
        });
        if (pool.size) {
            shell.querySelectorAll('img').forEach(img => {
                if (!img.isConnected && !shell.contains(img)) return;
                const src = img.src;
                const donor = src && pool.get(src);
                if (donor && donor !== img && !shell.contains(donor)) {
                    pool.delete(src);
                    img.replaceWith(donor);
                }
            });
        }
        container.replaceChildren(...shell.childNodes);
        logger.debug('CALENDAR', 'Grid swap reused cells', { reusedCells });
    }

    // djb2 — cheap, stable content signature for reconciliation
    hashString(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
        return String(hash);
    }

    // Header label for the visible period (title slot + date range)
    updateHeaderPeriodLabel() {
        try {
            const dateRange = document.getElementById('date-range');
            if (dateRange) {
                const { start, end } = this.getCurrentPeriodBounds();
                dateRange.textContent = this.formatDateRange(start, end);
            }
        } catch (error) {
            logger.warn('CALENDAR', 'Failed to update date range', { error: error.message });
        }
    }

    // The week strip is ONE grid row, so every column would stretch to the
    // tallest of all 21 rendered days — a festival stack in the off-screen
    // buffer would inflate the visible week and squeeze the map. Size the
    // grid to the tallest VISIBLE column instead (overflow-y is hidden;
    // buffer days clip until they slide in and the next settle re-sizes).
    sizeWeekStripHeight() {
        this.measureWeekStripHeight();
        // dusk-ui's lane spacers land after this task (via its observer) and
        // can grow multi-day cells — one deferred re-measure catches it
        requestAnimationFrame(() => requestAnimationFrame(() => this.measureWeekStripHeight()));
    }

    measureWeekStripHeight() {
        const grid = document.querySelector('.calendar-grid');
        if (!grid || this.currentView !== 'week' || grid.scrollWidth <= 0) return;
        const days = grid.querySelectorAll('.calendar-day');
        if (!days.length) return;
        const dayW = grid.scrollWidth / this.stripDayCount;
        const first = Math.max(0, Math.min(days.length - 7, Math.round(grid.scrollLeft / dayW)));
        let h = 0;
        for (let i = first; i < Math.min(days.length, first + 7); i++) {
            // NOT scrollHeight: grid stretches every cell to the row height
            // (the tallest of ALL 21 days), so a visible cell's scrollHeight
            // reported the off-screen maximum and the clamp was a no-op.
            // Measure the cell's real CONTENT extent instead.
            const cell = days[i];
            const cellTop = cell.getBoundingClientRect().top;
            let contentBottom = cellTop;
            for (let c = 0; c < cell.children.length; c++) {
                const b = cell.children[c].getBoundingClientRect().bottom;
                if (b > contentBottom) contentBottom = b;
            }
            h = Math.max(h, contentBottom - cellTop);
        }
        // A week with nothing in it still has to LOOK like a week: with no
        // pills to measure, the content extent is just the day-number row and
        // the strip collapsed to 41px (measured at 390px) — a hairline above
        // the map that read as broken rather than empty. The floor only ever
        // raises a quiet week; an ordinary one measures ~139 here.
        const WEEK_STRIP_MIN_CONTENT = 86;
        if (h > 0) grid.style.height = Math.ceil(Math.max(h, WEEK_STRIP_MIN_CONTENT) + 10) + 'px';
    }

    // Place the freshly rendered strip so the visible period is in view.
    // Week: currentDate's column lands at the left edge. Month: the current
    // month block tops the scroller — or, given an anchor (from a settle
    // rebuild), the anchored month keeps its exact on-screen offset so the
    // rebuild is invisible.
    positionGridStrip(anchor = null) {
        const grid = document.querySelector('.calendar-grid');
        if (!grid) return;
        this.suppressGridScrollUntil = performance.now() + 250;
        if (this.currentView === 'week') {
            if (!this.stripStartDate || grid.scrollWidth <= 0) return;
            // an anchor pins a GIVEN date to the left edge instead of the
            // current window's start — a strip rebuild can then keep showing
            // the days already on screen (invisible), so a long-distance
            // reveal can glide from here to the new window afterwards
            let idx;
            if (anchor && anchor.dateKey && /^\d{4}-\d{2}-\d{2}$/.test(anchor.dateKey)) {
                const p = anchor.dateKey.split('-');
                idx = Math.round((new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - this.stripStartDate) / 86400000);
            } else {
                const { start } = this.getCurrentPeriodBounds();
                idx = Math.round((start - this.stripStartDate) / 86400000);
            }
            idx = Math.max(0, Math.min(this.stripDayCount - 7, idx));
            const dayW = grid.scrollWidth / this.stripDayCount;
            grid.scrollLeft = Math.round(idx * dayW);
            return;
        }
        const gr = grid.getBoundingClientRect();
        const sticky = grid.querySelector('.month-strip-days');
        const stickyH = sticky ? sticky.getBoundingClientRect().height : 0;
        if (anchor && anchor.dateKey) {
            const c = grid.querySelector(`.calendar-day[data-date="${anchor.dateKey}"]`);
            if (c) {
                grid.scrollTop += (c.getBoundingClientRect().top - gr.top) - anchor.offset;
                return;
            }
        }
        // the row containing currentDate tops the scroller: switching to
        // month shows the CURRENT week at top, and the Today button (which
        // sets currentDate to today first) shows today's week at top
        const rowStart = new Date(this.currentDate);
        rowStart.setDate(rowStart.getDate() - rowStart.getDay());
        const cell = grid.querySelector(`.calendar-day[data-date="${this.getLocalDateKey(rowStart)}"]`);
        // flush under the sticky day-name row — the today-circle clearance
        // lives INSIDE the month cells now (day-header top offset), so no
        // sliver of the previous week peeks above the placed row
        if (cell) grid.scrollTop += cell.getBoundingClientRect().top - gr.top - stickyH;
    }

    // One-time (the .calendar-grid element survives every innerHTML swap):
    // settle detection for the strip. Nothing runs per scroll frame — a
    // 160ms debounce fires the settle, deferred past any active touch.
    armGridScroll(grid) {
        if (grid.dataset.stripArmed) return;
        grid.dataset.stripArmed = '1';
        const schedule = () => {
            clearTimeout(this.gridScrollTimer);
            this.gridScrollTimer = setTimeout(() => {
                if (this.gridTouchActive) return; // settles on touchend instead
                this.onGridSettle();
            }, 160);
        };
        grid.addEventListener('scroll', () => {
            if (performance.now() < this.suppressGridScrollUntil) return;
            schedule();
        }, { passive: true });
        grid.addEventListener('touchstart', () => { this.gridTouchActive = true; }, { passive: true });
        ['touchend', 'touchcancel'].forEach(ev => grid.addEventListener(ev, () => {
            this.gridTouchActive = false;
            schedule();
        }, { passive: true }));
    }

    // The strip stopped moving: derive the visible period from the scroll
    // position, then refresh label/URL/cards/map for it. Near a strip edge,
    // rebuild the strip re-centered (updateCalendarDisplay) — with a month
    // anchor so the rebuild doesn't visibly move anything.
    async onGridSettle() {
        const grid = document.querySelector('.calendar-grid');
        if (!grid || !this.allEvents) return;
        if (this.currentView === 'week') {
            if (!this.stripStartDate || grid.scrollWidth <= 0) return;
            const dayW = grid.scrollWidth / this.stripDayCount;
            const idx = Math.max(0, Math.min(this.stripDayCount - 7, Math.round(grid.scrollLeft / dayW)));
            const newStart = new Date(this.stripStartDate);
            newStart.setDate(newStart.getDate() + idx);
            newStart.setHours(0, 0, 0, 0);
            const changed = newStart.getTime() !== this.getCurrentPeriodBounds().start.getTime();
            const nearEdge = idx <= 10 || idx >= this.stripDayCount - 17;
            if (!changed && !nearEdge) return;
            this.currentDate = newStart;
            this.clearSelectionIfOutOfBounds();
            if (nearEdge) {
                await this.updateCalendarDisplay();
                return;
            }
            this.sizeWeekStripHeight();
            this.updateHeaderPeriodLabel();
            this.syncUrl(true);
            await this.refreshEventsPanel(this.getFilteredEvents(), false, { keepCamera: true });
            return;
        }
        // month: the month owning the most VISIBLE day cells drives the
        // header/URL/panel (the continuous strip has no block boundaries)
        const gr = grid.getBoundingClientRect();
        const counts = {};
        let anchorCell = null;
        let anchorOffset = 0;
        grid.querySelectorAll('.month-strip-grid .calendar-day[data-date]').forEach(c => {
            const r = c.getBoundingClientRect();
            const visible = Math.min(r.bottom, gr.bottom) - Math.max(r.top, gr.top);
            if (visible > r.height * 0.5) {
                const key = c.getAttribute('data-date').slice(0, 7);
                counts[key] = (counts[key] || 0) + 1;
                if (!anchorCell) {
                    anchorCell = c;
                    anchorOffset = r.top - gr.top;
                }
            }
        });
        const keys = Object.keys(counts);
        if (!keys.length) return;
        const bestKey = keys.sort((a, b) => counts[b] - counts[a])[0];
        const [y, m] = bestKey.split('-').map(Number);
        const cur = this.currentDate;
        const changed = !(cur.getFullYear() === y && cur.getMonth() === m - 1);
        const monthKeyOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const nearEdge = this.stripMonths.length >= 3 &&
            (bestKey === monthKeyOf(this.stripMonths[0]) ||
             bestKey === monthKeyOf(this.stripMonths[this.stripMonths.length - 1]));
        if (!changed && !nearEdge) return;
        const day = Math.min(cur.getDate(), new Date(y, m, 0).getDate());
        this.currentDate = new Date(y, m - 1, day);
        this.clearSelectionIfOutOfBounds();
        if (nearEdge) {
            this.pendingStripAnchor = anchorCell
                ? { dateKey: anchorCell.getAttribute('data-date'), offset: anchorOffset }
                : null;
            await this.updateCalendarDisplay();
            return;
        }
        this.updateHeaderPeriodLabel();
        this.syncUrl(true);
        await this.refreshEventsPanel(this.getFilteredEvents(), false, { keepCamera: true });
    }

    // The events panel = cards list + map (+ the chunky:events-rendered
    // dispatch). Split from updateCalendarDisplay so a strip scroll settle
    // can refresh what the visible days show WITHOUT rebuilding the grid
    // (which would destroy the user's scroll position). opts.keepCamera
    // leaves the map camera alone on settle refreshes — markers change,
    // the framing never jumps under a slide.
    // The mobile rail's TIMELINE card set: every event on the rendered grid
    // strip (visible week ± 28 days), ONE card per event — a recurring night
    // keeps the occurrence nearest the strip's central week (ahead preferred)
    // so slugs stay unique and the whole selection/reuse machinery keeps
    // working — sorted by date. dusk-rail switches this on for mobile
    // (this.railTimeline); everywhere else the card list stays the visible
    // window, exactly as before. Stability matters more than freshness here:
    // the set only changes when the STRIP is rebuilt, so a settle mid-swipe
    // re-renders into the same sigs and the rail's DOM never churns.
    getRailTimelineEvents() {
        if (!this.stripStartDate || this.currentView !== 'week') return null;
        const start = new Date(this.stripStartDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + this.stripDayCount - 1);
        end.setHours(23, 59, 59, 999);
        // EVERY occurrence, its own card (a recurring night deduped to one
        // occurrence went missing from every other week the user swiped to —
        // owner report 2026-08-31). getFilteredEvents already expands
        // recurrences and sorts by date; occurrence uniqueness is handled by
        // the slug+occurrence keys the cards carry.
        try {
            return this.getFilteredEvents({ start, end });
        } catch (error) {
            return null;
        }
    }

    async refreshEventsPanel(filteredEvents, hideEvents = false, opts = {}) {
        // the card LIST may be wider than the window (rail timeline); the map
        // and everything else below keep the window's own filteredEvents
        const cardEvents = (this.railTimeline && this.getRailTimelineEvents()) || filteredEvents;
        // Update events list (show for both week and month views)
        const eventsList = document.querySelector('.events-list');
        const eventsSection = document.querySelector('.events');
        if (eventsList && eventsSection) {
            eventsSection.style.display = 'block';
            
            logger.debug('CALENDAR', '🔍 UPDATE_DISPLAY: Events list update logic', {
                hideEvents,
                filteredEventsLength: filteredEvents?.length || 0,
                hasFilteredEvents: filteredEvents?.length > 0,
                allEventsLength: this.allEvents?.length || 0,
                currentExistingContent: eventsList.innerHTML.substring(0, 100) + '...',
                hasExistingError: !!eventsList.querySelector('.error-message'),
                hasExistingLoading: !!eventsList.querySelector('.loading-message')
            });
            
            if (hideEvents) {
                // Keep existing loading message when hideEvents is true
                if (!eventsList.querySelector('.loading-message')) {
                    eventsList.innerHTML = '<div class="loading-message">📅 Getting events...</div>';
                }
            } else if (cardEvents?.length > 0) {
                // Clear any existing error messages when successfully loading events
                const existingError = eventsList.querySelector('.error-message');
                if (existingError) {
                    logger.info('CALENDAR', 'Clearing previous error message - calendar loaded successfully');
                }
                
                try {
                    // Events are already sorted by upcoming time in getFilteredEvents()
                    logger.debug('CALENDAR', '🔍 UPDATE_DISPLAY: Generating event cards', {
                        eventCount: filteredEvents.length,
                        sampleEvent: filteredEvents[0] ? {
                            name: filteredEvents[0].name,
                            hasLinks: !!filteredEvents[0].links,
                            hasTea: !!filteredEvents[0].tea,
                            hasBar: !!filteredEvents[0].bar
                        } : 'no events'
                    });
                    
                    // Apply UID/recurrenceId deduplication for list view
                    logger.info('CALENDAR', 'Applying UID/recurrenceId deduplication for list view', {
                        originalEventCount: filteredEvents.length
                    });
                    const listDeduplicatedEvents = this.deduplicateByUIDAndRecurrenceId(cardEvents, cardEvents !== filteredEvents);

                    // Reconcile instead of innerHTML-swapping: a card whose
                    // rendered content is unchanged is REUSED, so its favicon
                    // and flyer <img>s keep their decoded pixels — the swap
                    // recreated every node on each strip settle and all the
                    // favicons blinked (owner report)
                    const sigOf = (str) => {
                        let hash = 5381;
                        for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
                        return String(hash);
                    };
                    // keyed by slug+occurrence: the timeline rail renders a
                    // recurring event once per occurrence, and a slug-only map
                    // collides those into one entry — every other occurrence
                    // then rebuilt on each settle (visible churn)
                    const occKeyOf = (slug, occ) => `${slug}|${occ || ''}`;
                    const existingBySlug = new Map();
                    eventsList.querySelectorAll(':scope > .event-card[data-event-slug]').forEach(c => {
                        existingBySlug.set(
                            occKeyOf(c.getAttribute('data-event-slug'), c.getAttribute('data-occurrence')),
                            c
                        );
                    });
                    const frag = document.createDocumentFragment();
                    const freshCards = [];
                    const shell = document.createElement('div');
                    let reusedCards = 0;
                    // Per EVENT, not per list. One card that cannot be built
                    // used to take the whole page down to "Error displaying
                    // events" — every other event on the week punished for one
                    // bad record (or, as on 2026-08-30, for one cached script).
                    // A card that throws is skipped and logged; the rest render.
                    let skippedCards = 0;
                    listDeduplicatedEvents.forEach(event => {
                        let html;
                        try {
                            html = this.generateEventCard(event);
                        } catch (singleCardError) {
                            skippedCards++;
                            logger.componentError('CALENDAR', 'Skipped one event card that failed to build', {
                                eventName: event && event.name,
                                slug: event && event.slug,
                                error: singleCardError && singleCardError.message
                            });
                            return;
                        }
                        const sig = sigOf(html);
                        let eventOccISO = '';
                        try {
                            const lg = this.getLogicalStartDate(event);
                            if (lg) eventOccISO = this.getLocalDateKey(lg);
                        } catch (e) { eventOccISO = ''; }
                        const reuseKey = occKeyOf(event.slug, eventOccISO);
                        const existing = existingBySlug.get(reuseKey);
                        if (existing && existing.dataset.cardSig === sig) {
                            existingBySlug.delete(reuseKey);
                            frag.appendChild(existing);
                            reusedCards++;
                            return;
                        }
                        shell.innerHTML = html;
                        const fresh = shell.firstElementChild;
                        if (fresh) {
                            fresh.dataset.cardSig = sig;
                            frag.appendChild(fresh);
                            freshCards.push(fresh);
                        }
                    });

                    // Transplant decoded <img>s into the rebuilt cards — but
                    // ONLY from cards that are being discarded. This used to
                    // pool every outgoing img up front, so a rebuilt card
                    // early in the loop could steal the favicon out of a
                    // later card that was then REUSED — its ec-fav span left
                    // empty, the "some favicons missing" after a month/week
                    // round-trip. The timeline makes the collision routine:
                    // nine occurrence cards of a weekly night share one
                    // favicon URL. existingBySlug now holds exactly the
                    // not-reused leftovers, so their imgs are free to move.
                    const oldImgPool = new Map();
                    existingBySlug.forEach(discarded => {
                        discarded.querySelectorAll('img').forEach(img => {
                            const src = img.getAttribute('src');
                            if (src && img.complete && !oldImgPool.has(src)) oldImgPool.set(src, img);
                        });
                    });
                    if (oldImgPool.size) {
                        freshCards.forEach(fresh => {
                            fresh.querySelectorAll('img').forEach(img => {
                                const src = img.getAttribute('src');
                                const donor = src && oldImgPool.get(src);
                                if (donor) {
                                    oldImgPool.delete(src);
                                    img.replaceWith(donor);
                                }
                            });
                        });
                    }
                    eventsList.replaceChildren(frag);

                    if (skippedCards > 0) {
                        logger.warn('CALENDAR', 'Some event cards could not be built', {
                            skippedCards,
                            renderedCards: listDeduplicatedEvents.length - skippedCards
                        });
                    }

                    logger.debug('CALENDAR', '✅ UPDATE_DISPLAY: Successfully updated events list', {
                        reusedCards,
                        originalEventCount: filteredEvents.length,
                        deduplicatedEventCount: listDeduplicatedEvents.length,
                        removedDuplicates: cardEvents.length - listDeduplicatedEvents.length
                    });
                } catch (cardError) {
                    logger.componentError('CALENDAR', 'Failed to generate event cards', cardError);
                    eventsList.innerHTML = '<div class="loading-message">Error displaying events. Please refresh the page.</div>';
                }

                // Add share button event handlers
                this.setupShareButtons();
                
                // Add card click handlers for selection toggle and URL sync
                this.attachEventCardSelectionHandlers();
                
                // Update visual selection state after rendering
                this.updateSelectionVisualState();
            } else {
                // `empty-slot` is the class the mobile rail keys off: an empty
                // period is a real destination (the week arrows can walk you
                // into one), so it gets a card-shaped slot with the edge slots
                // still beside it rather than a stray line of centred text.
                const emptyCopy = this.currentView === 'week'
                    ? 'No events this week.'
                    : 'No events found for this period.';
                eventsList.innerHTML = `<div class="loading-message empty-slot">${emptyCopy}<span class="empty-hint">Try switching Week/Month, or check back soon.</span></div>`;
                logger.info('CALENDAR', 'No events to display for current period', {
                    view: this.currentView,
                    city: this.currentCity
                });
            }

            // The grid and list DOM are both fresh at this point (the map
            // init below awaits network/location and can land seconds later)
            // — layered modules rebuild on this event, not on MutationObserver
            document.dispatchEvent(new CustomEvent('chunky:events-rendered', {
                detail: { view: this.currentView }
            }));
        }

        // Update map (show for both week and month views)
        // Initialize map if not in hideEvents mode
        try {
            const mapSection = document.querySelector('.events-map-section');
            if (mapSection && !hideEvents) {
                logger.debug('CALENDAR', 'Initializing map for events display');
                mapSection.style.display = 'block';
                // Apply UID/recurrenceId deduplication for map view
                logger.info('CALENDAR', 'Applying UID/recurrenceId deduplication for map view', {
                    originalEventCount: filteredEvents.length
                });
                const mapDeduplicatedEvents = this.deduplicateByUIDAndRecurrenceId(filteredEvents);
                this.initializeMap(this.currentCityConfig, mapDeduplicatedEvents, opts);
                logger.debug('CALENDAR', 'Map initialization completed');
                
                // Update visual selection state again after map is initialized
                // This ensures map markers are properly highlighted for auto-loaded slugs
                logger.debug('MAP', 'Calling updateSelectionVisualState after map initialization', {
                    selectedEventSlug: this.selectedEventSlug,
                    markersBySlugCount: window.eventsMapMarkersBySlug ? Object.keys(window.eventsMapMarkersBySlug).length : 0
                });
                this.updateSelectionVisualState();
                
                // Initialize location features after map is ready
                // (skipped on settle refreshes — the location layer doesn't
                // change because the visible days slid by one)
                try {
                    if (opts.keepCamera) throw { message: 'skipped (settle refresh)' };
                    if (!window.locationManager) {
                        window.locationManager = new LocationManager();
                    }
                    
                    const location = await window.locationManager.getLocationForFeatures();
                    
                    if (location) {
                        this.userLocation = location;
                        window.userLocation = location;
                        this.locationFeaturesEnabled = true;
                        
                        // Calculate distances for all events
                        this.allEvents = window.locationManager.calculateEventDistances(this.allEvents, location);
                        
                        // Show user location on map
                        showMyLocation(false);
                        
                        logger.info('CALENDAR', 'Location features enabled', { 
                            lat: location.lat, 
                            lng: location.lng,
                            source: location.source 
                        });
                    } else {
                        logger.debug('CALENDAR', 'No user location available for features');
                    }
                } catch (error) {
                    logger.debug('CALENDAR', 'Location features initialization failed', { error: error.message });
                }
            } else if (hideEvents) {
                logger.debug('CALENDAR', 'Skipping map initialization (hideEvents mode)');
            } else {
                logger.warn('CALENDAR', 'Map section not found');
            }
        } catch (error) {
            logger.warn('CALENDAR', 'Failed to initialize map', { error: error.message });
        }
    }

    // Update calendar display with filtered events
    async updateCalendarDisplay(hideEvents = false) {
        logger.time('CALENDAR', 'Calendar display update');
        // Resolve per-event colours BEFORE the first paint: cards rendered
        // without them fall back to the site indigo + 3-blob gradient and
        // then repaint, which read as "purple/gradient before switching to
        // their main color". Bounded so a stalled fetch can't hold the UI.
        if (!hideEvents && this.currentCity && !this.eventColorsByCity.has(this.currentCity)) {
            try {
                await Promise.race([
                    this.loadEventColors(this.currentCity),
                    new Promise(resolve => setTimeout(resolve, 1200))
                ]);
            } catch (e) {}
        }
        const filteredEvents = this.getFilteredEvents();
        
        logger.info('CALENDAR', `🔍 UPDATE_DISPLAY: Updating calendar display (${hideEvents ? 'HIDDEN for measurement' : 'VISIBLE for display'})`, {
            view: this.currentView,
            eventCount: filteredEvents.length,
            city: this.currentCity,
            hideEvents,
            step: hideEvents ? 'Step 1: Creating structure' : 'Step 4: Showing real events',
            cachedMeasurements: {
                eventTextWidth: this.cachedEventTextWidth,
                charsPerPixel: this.charsPerPixel?.toFixed(4),
                currentBreakpoint: this.currentBreakpoint
            }
        });
        
        this.updateHeaderPeriodLabel();
        
        // Update calendar grid
        try {
            const calendarGrid = document.querySelector('.calendar-grid');
            if (calendarGrid) {
                logger.debug('CALENDAR', 'Updating calendar grid HTML');
                this.swapHtmlPreservingImages(calendarGrid, this.generateCalendarEvents(filteredEvents, hideEvents));
                
                // For measurement mode, make the grid invisible to users but keep same layout constraints
                if (hideEvents) {
                    // Keep the element in its normal position but hide it behind background
                    calendarGrid.style.position = 'relative';
                    calendarGrid.style.zIndex = '-999'; // Behind everything else
                    calendarGrid.style.opacity = '0'; // Invisible to users
                    calendarGrid.style.pointerEvents = 'none'; // Can't interact with it
                    calendarGrid.style.visibility = 'visible'; // Still measurable by JS
                    logger.debug('CALENDAR', 'Calendar grid set to measurement mode (hidden)');
                } else {
                    // Reset to normal visibility
                    calendarGrid.style.position = '';
                    calendarGrid.style.zIndex = '';
                    calendarGrid.style.opacity = '1';
                    calendarGrid.style.pointerEvents = '';
                    calendarGrid.style.visibility = 'visible';
                    logger.debug('CALENDAR', 'Calendar grid set to display mode (visible)');
                }
                
                logger.debug('CALENDAR', 'Attaching calendar interactions');
                this.attachCalendarInteractions();
                
                // Update visual selection state after calendar is rendered
                this.updateSelectionVisualState();
            } else {
                logger.warn('CALENDAR', 'Calendar grid element not found');
            }
        } catch (error) {
            logger.warn('CALENDAR', 'Failed to update calendar grid', { error: error.message });
        }
        
        // Grid layout: the strip classes make the grid its own scroller —
        // week: horizontal day columns (1/7 of the viewport each); month:
        // stacked month blocks, each with its own 7-column inner grid.
        try {
            const calendarGrid = document.querySelector('.calendar-grid');
            if (calendarGrid) {
                if (this.currentView === 'month') {
                    calendarGrid.className = 'calendar-grid month-view-grid month-strip';
                    calendarGrid.style.gridTemplateColumns = '';
                    calendarGrid.style.gridTemplateRows = '';
                    calendarGrid.style.minHeight = '';
                } else {
                    calendarGrid.className = 'calendar-grid week-view-grid week-strip';
                    // the week strip is a BLOCK scroller (see styles.css:
                    // WebKit sticky labels don't work in grid scrollers) —
                    // clear the base grid's inline template writes
                    calendarGrid.style.gridTemplateColumns = '';
                    calendarGrid.style.gridTemplateRows = '';
                    calendarGrid.style.minHeight = 'auto';
                }
                if (this.currentView !== 'week') calendarGrid.style.height = '';
                this.positionGridStrip(this.pendingStripAnchor);
                this.pendingStripAnchor = null;
                if (this.currentView === 'week') this.sizeWeekStripHeight();
                this.armGridScroll(calendarGrid);
            }
        } catch (layoutError) {
            logger.warn('CALENDAR', 'Failed to update grid layout', { error: layoutError.message });
        }
        
        await this.refreshEventsPanel(filteredEvents, hideEvents);
        
        logger.timeEnd('CALENDAR', 'Calendar display update');
        logger.performance('CALENDAR', `Calendar display updated successfully`, {
            view: this.currentView,
            eventsDisplayed: filteredEvents.length,
            city: this.currentCity,
            hideEvents
        });

        // After updating UI, keep URL in sync with the new date/view/selection
        if (!hideEvents) {
            this.syncUrl(true);
        }
    }

    // Set up calendar controls
    setupCalendarControls() {
        // Prevent duplicate event listeners
        if (this.controlsSetup) {
            logger.debug('CALENDAR', 'Calendar controls already set up, skipping');
            return;
        }
        
        logger.componentInit('CALENDAR', 'Setting up calendar controls');
        
        // View toggle buttons
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const newView = e.target.dataset.view;
                if (newView !== this.currentView) {
                    logger.userInteraction('CALENDAR', `View changed from ${this.currentView} to ${newView}`);
                    if (newView === 'week') {
                        if (this.savedWeekStart instanceof Date) {
                            // round-tripping through month view returns to the
                            // EXACT window the user left — including its
                            // weekday start (the continuous window is not
                            // Sunday-aligned). Only an explicit week/day click
                            // inside month view (switchToWeekView, openWeekAt)
                            // chooses a different week.
                            this.currentDate = new Date(this.savedWeekStart);
                        } else {
                            // no saved week (deep link into month): open the
                            // week AS SHOWN there — the Sunday-aligned row
                            // containing currentDate
                            const aligned = new Date(this.currentDate);
                            aligned.setDate(aligned.getDate() - aligned.getDay());
                            aligned.setHours(0, 0, 0, 0);
                            this.currentDate = aligned;
                        }
                    } else if (this.currentView === 'week') {
                        // leaving week view: remember the window to come back to
                        this.savedWeekStart = new Date(this.currentDate);
                    }
                    this.currentView = newView;
                    
                    // Update active button
                    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    
                    // View change clears selection and syncs URL
                    this.clearEventSelection();
                    this.updateCalendarDisplay();
                    this.syncUrl(true);
                }
            });
        });
        
        // Navigation buttons
        const prevBtn = document.getElementById('prev-period');
        const nextBtn = document.getElementById('next-period');
        const todayBtn = document.getElementById('today-btn');
        
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                logger.userInteraction('CALENDAR', 'Previous period clicked');
                this.navigatePeriod('prev', true);
            });
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                logger.userInteraction('CALENDAR', 'Next period clicked');
                this.navigatePeriod('next', true);
            });
        }
        
        if (todayBtn) {
            todayBtn.addEventListener('click', () => {
                logger.userInteraction('CALENDAR', 'Today button clicked');
                this.goToToday();
            });
        }
        
        // Clear selection button removed - was ugly and unnecessary
        
        // Setup swipe handlers for mobile navigation
        this.setupSwipeHandlers();
        
        // Setup keyboard navigation
        this.setupKeyboardHandlers();
        
        // Ensure active state matches current view
        this.updateViewToggleActive();
        
        logger.componentLoad('CALENDAR', 'Calendar controls setup complete', {
            hasNavigation: !!(prevBtn && nextBtn && todayBtn),
            viewButtons: document.querySelectorAll('.view-btn').length
        });
        
        this.controlsSetup = true;
    }

    setupKeyboardHandlers() {
        document.addEventListener('keydown', (e) => {
            // Only handle keyboard navigation when calendar is focused or visible
            const calendarSection = document.querySelector('.weekly-calendar');
            if (!calendarSection || calendarSection.classList.contains('content-hidden')) {
                return;
            }
            
            switch (e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    logger.userInteraction('CALENDAR', 'Left arrow key pressed - navigating to previous period');
                    this.navigatePeriod('prev', true);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    logger.userInteraction('CALENDAR', 'Right arrow key pressed - navigating to next period');
                    this.navigatePeriod('next', true);
                    break;
                case 'Home':
                    e.preventDefault();
                    logger.userInteraction('CALENDAR', 'Home key pressed - going to today');
                    this.goToToday();
                    break;
            }
        });
        
        logger.componentLoad('CALENDAR', 'Keyboard handlers setup complete');
    }



    // Update page content for city
    updatePageContent(cityConfig, events, hideEvents = false) {
        // Store city config for later use
        this.currentCityConfig = cityConfig;
        
        // Update CTA text
        const cityCTAText = document.getElementById('city-cta-text');
        if (cityCTAText) {
            cityCTAText.textContent = `Know about other bear events or venues in ${cityConfig.name}? Help us keep this guide current!`;
        }

        // Set up calendar controls
        this.setupCalendarControls();

        // Update calendar with initial display
        const calendarSection = document.querySelector('.weekly-calendar');
        calendarSection?.classList.remove('content-hidden');
        
        // Update events section
        const eventsSection = document.querySelector('.events');
        eventsSection?.classList.remove('content-hidden');

        // Initialize map section
        const mapSection = document.querySelector('.events-map-section');
        mapSection?.classList.remove('content-hidden');

        // Update page metadata
        document.title = `${cityConfig.name} - chunky.dad Bear Guide`;
        const metaDescription = document.querySelector('meta[name="description"]');
        if (metaDescription) {
            metaDescription.setAttribute('content', 
                `Complete gay bear guide to ${cityConfig.name} - events, bars, and the hottest bear scene`
            );
        }
        
        // Update calendar display with hideEvents parameter
        this.updateCalendarDisplay(hideEvents);
    }

    // Attach calendar interactions
    attachCalendarInteractions() {
        try {
            logger.debug('CALENDAR', 'Starting to attach calendar interactions');
            const eventItems = document.querySelectorAll('.event-item');
            
            logger.debug('CALENDAR', `Found ${eventItems.length} event items to attach interactions to`);
            
            eventItems.forEach((item, index) => {
                try {
                    item.addEventListener('click', (e) => {
                        try {
                            const eventSlug = item.dataset.eventSlug;
                            // Determine the date for this event from the closest day element
                            const dayEl = item.closest('[data-date]');
                            const dayFromElement = dayEl ? dayEl.getAttribute('data-date') : this.formatDateToISO(this.currentDate);
                            // Prefer the date from selectedEventDateISO if it matches slug, else use date from day element
                            const dayISO = this.selectedEventSlug === eventSlug && this.selectedEventDateISO ? this.selectedEventDateISO : dayFromElement;
                            logger.userInteraction('EVENT', `Calendar event clicked: ${eventSlug}`, {
                                eventSlug,
                                dayFromElement,
                                dayISO,
                                selectedEventDateISO: this.selectedEventDateISO,
                                city: this.currentCity
                            });
                            
                            // Toggle selection and sync URL
                            this.toggleEventSelection(eventSlug, dayISO);
                        } catch (clickError) {
                            logger.warn('EVENT', `Error handling event click`, { error: clickError.message, eventSlug: item.dataset.eventSlug });
                        }
                    });
                } catch (addEventListenerError) {
                    logger.warn('CALENDAR', `Failed to add event listener to item ${index}`, { error: addEventListenerError.message });
                }
            });
            
            logger.debug('CALENDAR', `Successfully attached interactions to ${eventItems.length} calendar items`);
        } catch (error) {
            logger.warn('CALENDAR', 'Failed to attach calendar interactions', { error: error.message });
        }
    }

    // DOM-based helper methods for creating event detail elements
    createTeaElement(event) {
        if (!event.tea) return null;
        const row = document.createElement('div');
        row.className = 'detail-row';
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = 'Tea:';
        const value = document.createElement('span');
        value.className = 'value';
        value.textContent = event.tea;
        row.appendChild(label);
        row.appendChild(value);
        return row;
    }

    createLocationElement(event) {
        if (event.coordinates && event.coordinates.lat && event.coordinates.lng) {
            const row = document.createElement('div');
            row.className = 'detail-row';
            const label = document.createElement('span');
            label.className = 'label';
            label.textContent = 'Location:';
            const value = document.createElement('span');
            value.className = 'value';
            const link = document.createElement('a');
            link.href = '#';
            link.className = 'map-link';
            link.textContent = `📍 ${event.bar || 'Location'}`;
            link.onclick = (e) => {
                e.preventDefault();
                if (window.showOnMap) {
                    window.showOnMap(event.coordinates.lat, event.coordinates.lng, event.name, event.bar || '');
                }
            };
            value.appendChild(link);
            row.appendChild(label);
            row.appendChild(value);
            return row;
        } else if (event.bar) {
            const row = document.createElement('div');
            row.className = 'detail-row';
            const label = document.createElement('span');
            label.className = 'label';
            label.textContent = 'Bar:';
            const value = document.createElement('span');
            value.className = 'value';
            value.textContent = event.bar;
            row.appendChild(label);
            row.appendChild(value);
            return row;
        }
        return null;
    }

    createCoverElement(event) {
        if (!event.cover || !event.cover.trim() || 
            event.cover.toLowerCase() === 'free' || 
            event.cover.toLowerCase() === 'no cover') {
            return null;
        }
        const row = document.createElement('div');
        row.className = 'detail-row';
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = 'Cover:';
        const value = document.createElement('span');
        value.className = 'value';
        value.textContent = event.cover;
        row.appendChild(label);
        row.appendChild(value);
        return row;
    }

    // Add click-to-select behavior on event cards as well
    attachEventCardSelectionHandlers() {
        const cards = document.querySelectorAll('.event-card.detailed');
        cards.forEach(card => {
            // reconciled refreshes REUSE card nodes — never double-bind
            if (card.dataset.selBound) return;
            card.dataset.selBound = '1';
            card.addEventListener('click', (e) => {
                // Ignore clicks that originate from share button
                const shareBtn = e.target.closest && e.target.closest('.share-event-btn');
                if (shareBtn) return;
                const slug = card.getAttribute('data-event-slug');
                // The card knows which occurrence it is (data-occurrence) —
                // selecting with currentDate stamped the WINDOW START on the
                // selection, which matched no pill and no timeline card, and
                // sent the rail hunting for the wrong occurrence.
                const dayISO = card.getAttribute('data-occurrence')
                    || (this.selectedEventSlug === slug && this.selectedEventDateISO
                        ? this.selectedEventDateISO
                        : this.formatDateToISO(this.currentDate));
                logger.userInteraction('EVENT', 'Event card clicked', { slug, date: dayISO });
                this.toggleEventSelection(slug, dayISO);
                
                // Selection state is handled by updateSelectionVisualState()
            });
        });
        logger.debug('EVENT', `Attached selection handlers to ${cards.length} event cards`);
    }

    // Ensure view toggle buttons reflect current view
    updateViewToggleActive() {
        try {
            const active = this.currentView === 'month' ? 'month' : 'week';
            document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            const btn = document.querySelector(`.view-btn[data-view="${active}"]`);
            if (btn) btn.classList.add('active');
        } catch (_) {}
    }

    // Main render function
    async renderCityPage() {
        this.currentCity = this.getCityFromURL();
        this.currentCityConfig = getCityConfig(this.currentCity);
        
        // Parse initial state (view/date/event) from URL before rendering
        this.parseStateFromUrl();
        
        logger.info('CITY', `Rendering city page for: ${this.currentCity}`);
        
        // Header update is now handled immediately during page load - no longer needed here
        // This prevents blocking header updates on slow calendar initialization
        
        // Set up city selector
        this.setupCitySelector();
        
        // Check if city exists and has calendar
        if (!this.currentCityConfig) {
            logger.componentError('CITY', `City configuration not found: ${this.currentCity}`);
            this.showCityNotFound();
            return;
        }
        
        if (!hasCityCalendar(this.currentCity)) {
            logger.info('CITY', `City ${this.currentCity} doesn't have calendar configured yet`);
            // Show empty calendar when no events are configured
            this.updatePageContent(this.currentCityConfig, []);
            return;
        }
        
        logger.info('CALENDAR', 'Starting calendar initialization with proper order of operations');
        
        // STEP 1: Create a fake event for accurate width measurement
        // Ensure the fake event date falls within the current period bounds
        const { start, end } = this.getCurrentPeriodBounds();
        
        // Use the start of the period as the base date to ensure it's always within bounds
        const fakeEventDate = new Date(start);
        fakeEventDate.setHours(12, 0, 0, 0); // Set to noon to ensure it's within the period
        
        const fakeEvent = {
            name: 'Sample Event Name For Width Measurement Testing',
            shortName: 'Sample Event', // Shorter than full name to trigger smart name logic
            bar: 'Sample Venue Name',
            time: '8:00 PM',
            day: 'Today',
            startDate: fakeEventDate,
            slug: 'measurement-test',
            recurring: false
        };
        
        logger.info('CALENDAR', '🔍 RENDER: Step 1: Creating calendar structure with fake event (hideEvents: true)', {
            fakeEventName: fakeEvent.name,
            fakeEventShortName: fakeEvent.shortName,
            fakeEventHasShortName: !!fakeEvent.shortName,
            willTriggerSmartNameLogic: !!fakeEvent.shortName
        });
        
        // Set the fake event as allEvents for measurement
        this.allEvents = [fakeEvent];
        
        // Debug: Check what the period bounds are and if fake event will be included
        const fakeEventDateForCheck = new Date(fakeEvent.startDate);
        const isInPeriod = fakeEventDateForCheck >= start && fakeEventDateForCheck <= end;
        
        logger.info('CALENDAR', '🔍 DEBUG: Fake event filtering check', {
            fakeEventDate: fakeEventDateForCheck.toISOString(),
            periodStart: start.toISOString(),
            periodEnd: end.toISOString(),
            isInPeriod,
            currentDate: this.currentDate.toISOString(),
            currentView: this.currentView,
            fakeEventBasedOn: 'period start (guaranteed to be in bounds)'
        });
        
        // Show calendar structure with fake event but hidden for measurements
        this.updatePageContent(this.currentCityConfig, [fakeEvent], true); // hideEvents = true
        
        // STEP 2: Wait for DOM to be fully updated and then measure
        logger.info('CALENDAR', '🔍 RENDER: Step 2: Waiting for DOM to be ready for measurement');
        
        // Use requestAnimationFrame to ensure DOM is rendered AND responsive CSS is applied
        await new Promise(resolve => {
            requestAnimationFrame(() => {
                // Wait additional frames to ensure responsive CSS layout is fully applied
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        // Add a small timeout to ensure all CSS transitions/media queries are settled
                        setTimeout(resolve, 50);
                    });
                });
            });
        });
        
        logger.info('CALENDAR', '🔍 RENDER: Step 2b: DOM ready, starting measurements');
        
        // Measure the fake event width - should work reliably now
        const measurementWidth = this.getEventTextWidth();
        
        if (measurementWidth === null) {
            logger.warn('CALENDAR', '🔍 RENDER: Failed to measure event text width - using fallback calculation');
            // Force calculate chars per pixel as fallback
            this.calculateCharsPerPixel();
        } else {
            logger.info('CALENDAR', `🔍 RENDER: Successfully measured event text width: ${measurementWidth}px`);
            // Now calculate chars per pixel using the measured width
            const charsPerPixel = this.calculateCharsPerPixel();
            logger.info('CALENDAR', `🔍 RENDER: Calculated charsPerPixel: ${charsPerPixel?.toFixed(4)} using measured width: ${measurementWidth}px`);
            

        }
        
        // STEP 3: Load calendar data from the API
        logger.info('CALENDAR', '🔍 RENDER: Step 3: Loading real calendar data');
        
        try {
            const data = await this.loadCalendarData(this.currentCity);
            
            logger.debug('CALENDAR', '🔍 RENDER: Calendar data loaded, checking structure', {
                dataExists: !!data,
                dataType: typeof data,
                dataKeys: data ? Object.keys(data) : 'no data',
                hasEvents: data && !!data.events,
                eventsLength: data && data.events ? data.events.length : 0,
                hasCityConfig: data && !!data.cityConfig,
                cityConfigName: data && data.cityConfig ? data.cityConfig.name : 'no name',
                allEventsLength: this.allEvents.length
            });
            
            if (!data || !data.events || !data.cityConfig) {
                logger.error('CALENDAR', '🔍 RENDER: Failed to load calendar data - showing error message', {
                    dataIsNull: data === null,
                    dataIsUndefined: data === undefined,
                    hasEvents: data && !!data.events,
                    hasCityConfig: data && !!data.cityConfig,
                    dataType: typeof data,
                    dataKeys: data ? Object.keys(data) : 'no data',
                    eventDataType: data && data.events ? typeof data.events : 'no events',
                    cityConfigType: data && data.cityConfig ? typeof data.cityConfig : 'no cityConfig'
                });
                // Clear fake event from allEvents to prevent it from showing
                this.allEvents = [];
                // Show error message instead of empty calendar
                this.showCalendarError('renderCityPage_dataValidation');
                return;
            }
            
            // STEP 4: Display the real events with hideEvents: false
            logger.info('CALENDAR', '🔍 RENDER: Step 4: Displaying real events (hideEvents: false)', {
                eventCount: data.events.length,
                cachedWidth: this.cachedEventTextWidth,
                cachedCharsPerPixel: this.charsPerPixel?.toFixed(4)
            });
            
            // Clear any existing error messages before showing successful content
            logger.debug('CALENDAR', '🔍 RENDER: Clearing any existing error messages');
            this.clearCalendarError();
            
            logger.debug('CALENDAR', '🔍 RENDER: Updating page content with real events', {
                cityConfig: data.cityConfig.name,
                eventCount: data.events.length,
                hideEvents: false
            });
            this.updatePageContent(data.cityConfig, data.events, false); // hideEvents = false
            
            // Ensure URL reflects initial state after first render
            this.syncUrl(true);
            
        } catch (error) {
            logger.componentError('CALENDAR', '🔍 RENDER: Calendar loading failed with error', error);
            
            // Only show error and clear events if this is a critical failure
            // Check if the error occurred before we loaded any data
            if (!this.allEvents || this.allEvents.length === 0) {
                logger.warn('CALENDAR', '🔍 RENDER: Critical failure - no events loaded, showing error');
                // Clear fake event from allEvents to prevent it from showing
                this.allEvents = [];
                // Show error message instead of empty calendar
                this.showCalendarError('renderCityPage_exception');
            } else {
                logger.info('CALENDAR', '🔍 RENDER: Non-critical error - events already loaded, continuing with display', {
                    eventsCount: this.allEvents.length,
                    errorMessage: error.message
                });
                // Try to continue with the events we have
                try {
                    this.updateCalendarDisplay(false);
                } catch (displayError) {
                    logger.componentError('CALENDAR', 'Failed to update display after error recovery', displayError);
                    this.showCalendarError('renderCityPage_display_recovery_failed');
                }
            }
            return;
        }
        
        // STEP 5: Final validation and summary
        logger.info('CALENDAR', '🔍 RENDER: Step 5: Final validation and summary', {
            totalSteps: 5,
            finalState: {
                cachedEventTextWidth: this.cachedEventTextWidth,
                cachedCharsPerPixel: this.charsPerPixel?.toFixed(4),
                currentBreakpoint: this.currentBreakpoint,
                screenWidth: window.innerWidth,
                screenHeight: window.innerHeight,
                visualZoom: ((window.visualViewport && window.visualViewport.scale) || 1).toFixed(2)
            },
            calculatedData: {
                viewport: `${window.innerWidth} × ${window.innerHeight}`,
                charsPerLine: this.cachedEventTextWidth && this.charsPerPixel ? Math.floor(this.cachedEventTextWidth * this.charsPerPixel) : 'not calculated',
                charsPerPixel: this.charsPerPixel ? this.charsPerPixel.toFixed(4) : 'not calculated',
                eventWidth: this.cachedEventTextWidth ? `${this.cachedEventTextWidth}px (no padding - defensive applied to charsPerPixel)` : 'not measured',
                zoom: `${(((window.visualViewport && window.visualViewport.scale) || 1) * 100).toFixed(0)}%`,
                note: 'Defensive reduction of 0.02 applied directly to charsPerPixel to achieve ~0.11 (down from ~0.13)'
            }
        });
        
        logger.componentLoad('CITY', `City page rendered successfully for ${this.currentCity}`, {
            eventCount: this.allEvents ? this.allEvents.length : 0,
            measurementWidth: measurementWidth
        });
    }

    // Update characters per pixel ratio (for new dynamic system)
    updateCharsPerPixel(newRatio) {
        logger.info('CALENDAR', 'Characters per pixel ratio updated from test interface', newRatio);
        
        // Store the new single ratio
        this.charsPerPixel = newRatio;
        
        // Force a refresh of the calendar display to apply new ratio
        if (this.allEvents && this.allEvents.length > 0) {
            this.updateCalendarDisplay();
        }
    }
    
    // Set up message listener for testing interface communication
    setupMessageListener() {
        window.addEventListener('message', (event) => {
            try {
                if (event.data && event.data.type) {
                    switch (event.data.type) {

                        case 'updatePixelRatio':
                            this.updateCharsPerPixel(event.data.data);
                            break;
                        case 'addTestEvent':
                            logger.info('CALENDAR', 'Test event received from testing interface', event.data.data);
                            this.addTestEvent(event.data.data);
                            break;
                        default:
                            logger.debug('CALENDAR', 'Unknown message type from testing interface', event.data.type);
                    }
                }
            } catch (error) {
                logger.error('CALENDAR', 'Error handling message from testing interface', error);
            }
        });
        
        logger.debug('CALENDAR', 'Message listener set up for testing interface communication');
    }
    
    // Set up resize listener to clear measurement cache when layout changes
    setupResizeListener() {
        let resizeTimeout;
        let lastVisualViewportWidth = window.visualViewport ? window.visualViewport.width : window.innerWidth;
        
        const handleLayoutChange = (eventType = 'resize', forceCheck = false) => {
            const newWidth = window.innerWidth;
            const newBreakpoint = this.getCurrentBreakpoint();
            const breakpointChanged = newBreakpoint !== this.currentBreakpoint;
            const significantWidthChange = Math.abs(newWidth - this.lastScreenWidth) > 50; // 50px threshold
            const shouldProcess = breakpointChanged || significantWidthChange || forceCheck;
            
            // Only log if there's actually a significant change to avoid console spam
            if (shouldProcess) {
                logger.info('CALENDAR', `🔍 LAYOUT_CHANGE: Significant layout change detected via ${eventType}`, {
                    eventType,
                    oldWidth: this.lastScreenWidth,
                    newWidth,
                    widthChange: newWidth - this.lastScreenWidth,
                    oldBreakpoint: this.currentBreakpoint,
                    newBreakpoint,
                    breakpointChanged,
                    significantWidthChange,
                    cacheCleared: true
                });
                
                // Clear measurements and update tracking variables
                this.clearMeasurementCache();
                this.clearEventNameCache();
                this.lastScreenWidth = newWidth;
                this.currentBreakpoint = newBreakpoint;
                
                // Debounce the calendar re-render to avoid excessive updates
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    logger.info('CALENDAR', `🔍 LAYOUT_CHANGE: Updating calendar display after ${eventType}`);
                    this.updateCalendarDisplay();
                }, 150); // 150ms debounce
            } else {
                // Only log debug info for actual width changes, not for scroll-triggered events
                if (Math.abs(newWidth - this.lastScreenWidth) > 0) {
                    logger.debug('CALENDAR', `🔍 LAYOUT_CHANGE: Layout change not significant enough to clear cache`, {
                        eventType,
                        widthChange: newWidth - this.lastScreenWidth,
                        threshold: 50
                    });
                }
            }
        };
        
        // Listen to window resize events
        window.addEventListener('resize', () => handleLayoutChange('resize'));
        
        // Listen to orientation changes (important for mobile/tablet)
        window.addEventListener('orientationchange', () => handleLayoutChange('orientationchange', true));
        
        // Listen for visual viewport changes (crucial for iPad split screen)
        if (window.visualViewport) {
            let visualViewportTimeout;
            
            window.visualViewport.addEventListener('resize', () => {
                const currentVisualViewportWidth = window.visualViewport.width;
                
                // Only process if the visual viewport width actually changed
                // This filters out scroll-triggered resize events that don't change layout
                if (Math.abs(currentVisualViewportWidth - lastVisualViewportWidth) > 1) { // 1px tolerance for rounding
                    lastVisualViewportWidth = currentVisualViewportWidth;
                    
                    clearTimeout(visualViewportTimeout);
                    visualViewportTimeout = setTimeout(() => {
                        handleLayoutChange('visualViewport.resize');
                    }, 100); // Slightly shorter debounce for visual viewport to be more responsive
                }
                // Silently ignore events where visual viewport width hasn't changed (scroll events)
            });
            // Note: We don't listen to visualViewport scroll as that's just scrolling, not layout change
        }
        
        logger.debug('CALENDAR', 'Layout change listeners set up with width-change filtering', {
            events: ['resize', 'orientationchange', 'visualViewport.resize'],
            hasVisualViewport: !!window.visualViewport,
            widthChangeThreshold: 50,
            visualViewportWidthTolerance: 1
        });
    }
    

    
    // Add test event (for testing functionality)
    addTestEvent(testEventData) {
        logger.info('CALENDAR', 'Test event added from test interface', testEventData);
        
        // Change header when in testing flow
        const headerBrandText = document.querySelector('.logo .brand-text');
        if (headerBrandText) {
            headerBrandText.textContent = 'TESTING NEW EVENT';
            headerBrandText.style.color = '#ff7b2f';
        } else {
            const headerLinks = document.querySelectorAll('.logo a');
            headerLinks.forEach(link => {
                // If there's an image, keep it, just replace text nodes or add a span
                const img = link.querySelector('img');
                link.innerHTML = '';
                if (img) link.appendChild(img);
                const span = document.createElement('span');
                span.textContent = 'TESTING NEW EVENT';
                span.style.fontWeight = 'bold';
                span.style.color = '#ff7b2f';
                span.style.letterSpacing = '1px';
                span.style.marginLeft = '0.5rem';
                link.appendChild(span);
                link.href = '#';
            });
        }

        if (!testEventData || typeof testEventData !== 'object') {
            logger.warn('CALENDAR', 'Invalid test event payload received from test interface', { testEventData });
            return;
        }
        
        if (!this.allEvents) {
            this.allEvents = [];
        }
        
        const toDate = (value) => {
            if (!value) return null;
            const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
            return Number.isNaN(date.getTime()) ? null : date;
        };
        
        const fallbackDurationMinutes = 120;
        const now = new Date();
        const startDate = toDate(testEventData.startDate) || now;
        
        let endDate = toDate(testEventData.endDate);
        if (!endDate || endDate <= startDate) {
            const durationMinutes = parseInt(testEventData.durationMinutes, 10);
            const duration = Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : fallbackDurationMinutes;
            endDate = new Date(startDate.getTime() + duration * 60000);
        }
        
        const timezone = testEventData.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const testUid = testEventData.uid ? String(testEventData.uid).trim() : '';
        const testRecurrenceId = toDate(testEventData.recurrenceId);
        // Parse overrideUid/overrideRecurrenceId for occurrence override previews.
        // When the event builder creates an override, recurrenceId is null but overrideUid and
        // overrideRecurrenceId identify which base-series occurrence to suppress in the preview.
        const testOverrideUid = testEventData.overrideUid ? String(testEventData.overrideUid).trim() : '';
        let testOverrideRecurrenceId = null;
        if (testEventData.overrideRecurrenceId) {
            try {
                testOverrideRecurrenceId = this.parseICalDate(String(testEventData.overrideRecurrenceId));
                if (Number.isNaN(testOverrideRecurrenceId.getTime())) {
                    testOverrideRecurrenceId = null;
                }
            } catch (_) {
                testOverrideRecurrenceId = null;
            }
        }
        const effectiveUid = testUid || testOverrideUid;
        const effectiveRecurrenceId = testRecurrenceId || testOverrideRecurrenceId;
        const isOverride = Boolean(effectiveRecurrenceId);
        
        const formatTimeComponent = (date) => {
            const options = { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone };
            const formatted = date.toLocaleTimeString('en-US', options);
            return formatted.replace(':00', '').replace(' ', '');
        };
        
        const autoTime = () => {
            const startLabel = formatTimeComponent(startDate);
            const endLabel = formatTimeComponent(endDate);
            if (startLabel === endLabel) {
                return startLabel;
            }
            return `${startLabel}-${endLabel}`;
        };
        
        const timeLabel = testEventData.time && typeof testEventData.time === 'string' && testEventData.time.trim()
            ? testEventData.time.trim()
            : autoTime();
        
        const slugifyText = (text) => {
            if (!text) return '';
            return String(text)
                .toLowerCase()
                .trim()
                .replace(/[\s_]+/g, '-')
                .replace(/[^\w-]+/g, '')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '')
                .substring(0, 60);
        };
        
        const slugBase = testEventData.slug || testEventData.shortName || testEventData.name || 'test-event';
        const slugSuffix = startDate ? startDate.getTime() : Date.now();
        const slug = `test-event-${slugifyText(slugBase) || 'preview'}-${slugSuffix}`;
        
        const uniqueLinks = new Map();
        const pushLink = (link) => {
            if (!link || !link.url) return;
            const trimmedUrl = String(link.url).trim();
            if (!trimmedUrl) return;
            if (uniqueLinks.has(trimmedUrl)) return;
            uniqueLinks.set(trimmedUrl, {
                label: link.label || link.type || 'Link',
                url: trimmedUrl,
                type: link.type || 'link'
            });
        };
        
        if (Array.isArray(testEventData.links)) {
            testEventData.links.forEach(pushLink);
        }
        
        if (testEventData.website) {
            pushLink({
                label: testEventData.websiteLabel || '🌐 More Info',
                url: testEventData.website,
                type: 'website'
            });
        }
        
        if (testEventData.tickets) {
            pushLink({
                label: testEventData.ticketsLabel || '🎟 Tickets',
                url: testEventData.tickets,
                type: 'tickets'
            });
        }
        
        const normalizedLinks = Array.from(uniqueLinks.values());
        
        const fallbackVenue = testEventData.bar || testEventData.venue || 'Venue TBA';
        const dayLabel = testEventData.day || startDate.toLocaleDateString('en-US', { weekday: 'long' });
        const description = testEventData.tea || testEventData.description || '';
        
        const testEvent = {
            name: testEventData.name || 'Untitled Event',
            shortName: testEventData.shortName || '',
            nickname: testEventData.nickname || testEventData.shortName || '',
            bar: fallbackVenue,
            venue: fallbackVenue,
            address: testEventData.address || '',
            city: testEventData.city || this.currentCity,
            time: timeLabel,
            day: dayLabel,
            startDate,
            endDate,
            startTimezone: timezone,
            endTimezone: timezone,
            cover: testEventData.cover || '',
            tea: description,
            description,
            coverImage: testEventData.coverImage || null,
            image: testEventData.image || null,
            favicon: testEventData.favicon || null,
            heroImage: testEventData.heroImage || null,
            website: testEventData.website || null,
            tickets: testEventData.tickets || null,
            links: normalizedLinks,
            uid: effectiveUid || null,
            recurrenceId: effectiveRecurrenceId || null,
            recurring: isOverride ? false : Boolean(testEventData.recurring),
            recurrence: isOverride ? null : (testEventData.recurrence || null),
            coordinates: testEventData.coordinates || null,
            eventType: testEventData.eventType || null,
            source: testEventData.source || 'Event Generator',
            slug,
            isTestEvent: true
        };
        
        // Ensure preview edits/overrides replace existing events by UID (+recurrenceId).
        const shouldRemoveExistingEvent = (event) => {
            if (!event) return false;
            if (event.slug && event.slug.startsWith('test-event-')) {
                return true;
            }
            if (!effectiveUid) {
                return false;
            }
            const eventUid = event.uid || event.slug || event.name;
            if (!eventUid || eventUid !== effectiveUid) {
                return false;
            }
            const eventRecurrenceId = toDate(event.recurrenceId);
            if (isOverride) {
                if (!eventRecurrenceId || !effectiveRecurrenceId) {
                    return false;
                }
                return eventRecurrenceId.getTime() === effectiveRecurrenceId.getTime();
            }
            return !eventRecurrenceId;
        };

        // Remove any existing test events or matching base/override entry
        this.allEvents = this.allEvents.filter(event => !shouldRemoveExistingEvent(event));
        
        // Add the new test event at the front of the list
        this.allEvents.unshift(testEvent);
        
        // Jump the calendar to the event date and highlight it
        this.currentDate = new Date(startDate);
        this.selectedEventSlug = slug;
        this.selectedEventDateISO = this.formatDateToISO(startDate);
        
        // Refresh the display
        this.updateCalendarDisplay();
        
        if (window.parent && window.parent !== window) {
            try {
                window.parent.postMessage({
                    type: 'testEventRendered',
                    slug,
                    city: this.currentCity,
                    date: this.formatDateToISO(startDate)
                }, '*');
            } catch (error) {
                logger.debug('CALENDAR', 'Failed to postMessage test event render confirmation to parent window', {
                    error: error.message
                });
            }
        }
    }


    // Initialize
    async init() {
        // Prevent multiple initializations
        if (this.isInitialized || this.isInitializing) {
            logger.warn('CALENDAR', 'Calendar already initialized or initializing, skipping duplicate init');
            return;
        }
        
        this.isInitializing = true;
        logger.info('CALENDAR', 'Initializing DynamicCalendarLoader...');
        
        try {

            // Add timeout to prevent hanging initialization - 30s to account for delays + timeouts + slow networks
            const initPromise = this.renderCityPage();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Calendar initialization timeout after 30 seconds')), 30000);
            });
            
            await Promise.race([initPromise, timeoutPromise]);
            this.isInitialized = true;
            logger.componentLoad('CALENDAR', 'Dynamic CalendarLoader initialization completed successfully');
            
            // Check for testEvent in sessionStorage
            try {
                const testEventParam = sessionStorage.getItem('testEventPayload');
                if (testEventParam) {
                    const testEventData = JSON.parse(testEventParam);
                    logger.info('CALENDAR', 'Found test event in sessionStorage', testEventData);
                    // Clear it so it doesn't persist across random navigations in the same tab later
                    // (But keep it if they just reload? Let's not clear it so reload works,
                    // they can close the tab to clear it)
                    this.addTestEvent(testEventData);
                }
            } catch (e) {
                logger.error('CALENDAR', 'Failed to parse testEvent from sessionStorage', e);
            }

            if (window.parent && window.parent !== window) {
                try {
                    window.parent.postMessage({
                        type: 'calendarInitialized',
                        city: this.currentCity
                    }, '*');
                } catch (messageError) {
                    logger.debug('CALENDAR', 'Failed to notify parent window about calendar initialization', {
                        error: messageError.message
                    });
                }
            }
        } catch (error) {
            logger.componentError('CALENDAR', 'Calendar initialization failed', error);
            // Only show error message if the calendar data actually failed to load
            // Check if we have events data - if so, the error might be from a non-critical part
            if (!this.allEvents || this.allEvents.length === 0) {
                logger.warn('CALENDAR', 'No events loaded, showing error message');
                this.showCalendarError('init_timeout_or_exception');
            } else {
                logger.info('CALENDAR', 'Events loaded successfully despite initialization error, not showing error message', {
                    eventsCount: this.allEvents.length,
                    errorMessage: error.message
                });
            }
            // Don't re-throw the error to prevent unhandled promise rejection
        } finally {
            this.isInitializing = false;
        }
    }






}

// Map interaction function
function showOnMap(lat, lng, eventName, barName) {
    if (window.eventsMap) {
        // First scroll to the map section
        const mapSection = document.querySelector('.events-map-section');
        if (mapSection) {
            mapSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        // Then center the map on the location with a slight delay
        setTimeout(() => {
            window.eventsMap.setCenter([lng, lat]);
            window.eventsMap.setZoom(16);
            if (window.eventsMapMarkers) {
                window.eventsMapMarkers.forEach(marker => {
                    const latLng = marker.getLngLat();
                    if (Math.abs(latLng.lat - lat) < 0.0001 && Math.abs(latLng.lng - lng) < 0.0001) {
                        marker.togglePopup();
                    }
                });
            }
        }, 300);
        
        logger.userInteraction('MAP', 'showOnMap called', { lat, lng, eventName, barName });
    }
}

// Map control functions
function fitAllMarkers() {
    if (window.eventsMap && window.eventsMapMarkers && window.eventsMapMarkers.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        window.eventsMapMarkers.forEach(marker => {
            bounds.extend(marker.getLngLat());
        });
        window.eventsMap.fitBounds(bounds, {
            padding: 20,
            maxZoom: window.eventsMapCityZoom || 11
        });
        
        logger.userInteraction('MAP', 'Fit all markers clicked', {
            markerCount: window.eventsMapMarkers.length
        });
    } else {
        logger.warn('MAP', 'No markers to fit');
    }
}




// Hide-others ("solo") mode for the main events map: while ON and an event
// is selected, every other marker is hidden; with no selection, all markers
// stay visible. Re-applied on every selection change and marker rebuild.
window.mapSoloHidden = false;
function toggleMapSolo() {
    window.mapSoloHidden = !window.mapSoloHidden;
    const btn = document.getElementById('solo-btn');
    const icon = document.getElementById('solo-icon');
    if (btn) btn.classList.toggle('map-solo-on', window.mapSoloHidden);
    if (icon) icon.className = 'bi ' + (window.mapSoloHidden ? 'bi-eye' : 'bi-eye-slash');
    applyMapSoloVisibility();
}
function applyMapSoloVisibility() {
    if (!window.eventsMapMarkersBySlug) return;
    const activeLoader = window.calendarLoader;
    const selected = activeLoader && activeLoader.selectedEventSlug;
    Object.entries(window.eventsMapMarkersBySlug).forEach(([slug, marker]) => {
        const el = marker.getElement && marker.getElement();
        if (!el) return;
        el.classList.toggle('marker-solo-hidden', !!(window.mapSoloHidden && selected && slug !== selected));
    });
}
if (typeof window !== 'undefined') {
    window.toggleMapSolo = toggleMapSolo;
}

async function showMyLocation(panMap = true) {
    try {
        // Update button to show loading state
        updateLocationButtonStatus('loading');
        
        // Initialize LocationManager if not already available
        if (!window.locationManager) {
            window.locationManager = new LocationManager();
        }

        // Get location with caching and permission awareness
        const location = await window.locationManager.getLocationForMap(true);
        
        if (window.eventsMap) {
            // Remove existing location circle
            if (window.myLocationCircle) {
                window.myLocationCircle.remove();
            }
            
            // Create popup text with accuracy info
            let popupText = '📍 Your Location';
            if (location.accuracy) {
                const accuracyMeters = Math.round(location.accuracy);
                popupText += ` (±${accuracyMeters}m)`;
            }
            if (location.stale) {
                popupText += ' (cached)';
            }
            
            // Note: Maplibre doesn't have an equivalent to L.circle out-of-the-box in the same way without adding a layer source.
            // Using a simple HTML marker for the location dot
            const locationEl = document.createElement('div');
            locationEl.style.width = '15px';
            locationEl.style.height = '15px';
            locationEl.style.backgroundColor = '#4285f4';
            locationEl.style.borderRadius = '50%';
            locationEl.style.border = '2px solid white';
            locationEl.style.boxShadow = '0 0 5px rgba(0,0,0,0.5)';

            const popup = new maplibregl.Popup({ offset: 25 }).setHTML(popupText);

            window.myLocationCircle = new maplibregl.Marker({element: locationEl})
                .setLngLat([location.lng, location.lat])
                .setPopup(popup)
                .addTo(window.eventsMap);
            
            // Center on user location if requested
            if (panMap) {
                window.eventsMap.setCenter([location.lng, location.lat]);
                window.eventsMap.setZoom(14);

            }
            
            // Update button to show success state
            updateLocationButtonStatus('success', location.stale ? 'cached' : 'fresh');
            
            logger.userInteraction('MAP', 'My location shown with events visible', { 
                lat: location.lat, 
                lng: location.lng,
                accuracy: location.accuracy,
                source: location.source,
                stale: location.stale
            });
        }
    } catch (error) {
        logger.error('MAP', 'Location request failed', { error: error.message });
        
        // Update button to show error state
        updateLocationButtonStatus('error');
        
        // Show user-friendly error message
        const errorMessage = error.message || 'Unable to get your location. Please try again.';
        
        // Create a temporary error message instead of alert
        if (window.eventsMap) {
            // Remove any existing error popup
            if (window.locationErrorPopup) {
                window.locationErrorPopup.remove();
            }
            
            // Show error as map popup
            const center = window.eventsMap.getCenter();
            window.locationErrorPopup = new maplibregl.Popup({ closeOnClick: false })
                .setLngLat(center)
                .setHTML(`<div style="text-align: center; color: #d32f2f; font-weight: 500;">${errorMessage}</div>`)
                .addTo(window.eventsMap);
            
            // Auto-close after 5 seconds
            setTimeout(() => {
                if (window.locationErrorPopup) {
                    window.locationErrorPopup.remove();
                    window.locationErrorPopup = null;
                }
            }, 5000);
        } else {
            // Fallback to alert if no map
            alert(errorMessage);
        }
    }
}

// Update location button status indicator
function updateLocationButtonStatus(status, detail = '') {
    const iconEl = document.getElementById('location-icon');
    const btnEl = document.getElementById('location-btn');
    
    if (!iconEl || !btnEl) return;
    
    // Remove existing status classes
    btnEl.classList.remove('location-loading', 'location-success', 'location-error');
    
    switch (status) {
        case 'loading':
            btnEl.classList.add('location-loading');
            iconEl.className = 'bi bi-hourglass-split';
            break;
        case 'success':
            btnEl.classList.add('location-success');
            iconEl.className = 'bi bi-crosshair2';
            break;
        case 'error':
            btnEl.classList.add('location-error');
            iconEl.className = 'bi bi-crosshair2';
            break;
        default:
            iconEl.className = 'bi bi-crosshair';
    }
}


// Check and update location status on page load (UI only - location logic moved to LocationManager)
async function updateLocationStatus() {
    try {
        if (!window.locationManager) {
            window.locationManager = new LocationManager();
        }
        
        // Let LocationManager handle all location logic and UI updates
        const location = await window.locationManager.updateLocationStatus(updateLocationButtonStatus);
        
        if (location) {
            logger.debug('MAP', 'Location status updated successfully', { 
                lat: location.lat, 
                lng: location.lng,
                source: location.source 
            });
        } else {
            logger.debug('MAP', 'No location available');
        }
    } catch (error) {
        logger.debug('MAP', 'Location status update failed', { error: error.message });
        updateLocationButtonStatus('default');
    }
}

// Export class for use in app.js - no auto-initialization
if (typeof window !== 'undefined') {
    window.DynamicCalendarLoader = DynamicCalendarLoader;
    // Referenced from the flyer <img>'s inline onerror, which fires for cards
    // that were never selected (so it cannot rely on ensureFlyerLoaded).
    window.chunkyAdvanceFlyer = advanceFlyerImage;
}