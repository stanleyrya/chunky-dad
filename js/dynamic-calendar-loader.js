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
        
        // Set up window resize listener to clear measurement cache
        this.setupResizeListener();
        
        logger.componentInit('CALENDAR', 'Dynamic CalendarLoader initialized');
    }

    // Enhanced swipe detection methods
    setupSwipeHandlers() {
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
    
    // Toggle/select event for URL/state
    toggleEventSelection(eventSlug, eventDateISO) {
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
            // Align currentDate to selected date for consistency
            const parts = normalizedDateISO.split('-');
            const parsed = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            if (!isNaN(parsed.getTime())) {
                this.currentDate = parsed;
            }
            logger.userInteraction('EVENT', 'Event selected', { eventSlug, date: normalizedDateISO });
        } else {
            logger.userInteraction('EVENT', 'Event deselected (was already selected)', { eventSlug, date: normalizedDateISO });
        }
        
        // Update visual selection state once (handles both selection and deselection)
        this.updateSelectionVisualState();
        
        // Reflect selection in URL
        this.syncUrl(true);
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
        
        // Get events list
        const eventsList = document.querySelector('.events-list');
        
        if (this.selectedEventSlug) {
            // Mark selected event card in list view
            const selectedCard = document.querySelector(`.event-card[data-event-slug="${CSS.escape(this.selectedEventSlug)}"]`);
            if (selectedCard) {
                selectedCard.classList.add('selected');
                
                // Smoothly transition to selection mode
                if (eventsList) {
                    this.transitionToSelectionMode(eventsList, selectedCard);
                }
            }
            
            // Mark selected event items in calendar views
            const calendarItems = document.querySelectorAll(`.event-item[data-event-slug="${CSS.escape(this.selectedEventSlug)}"]`);
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
            // Smoothly transition out of selection mode
            if (eventsList) {
                this.transitionOutOfSelectionMode(eventsList);
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
    }

    // Smoothly transition to selection mode
    transitionToSelectionMode(eventsList, selectedCard) {
        // Add transition class for smooth animation
        eventsList.classList.add('transitioning');
        
        // Use requestAnimationFrame to ensure the transition class is applied
        requestAnimationFrame(() => {
            // Add selection mode class
            eventsList.classList.add('selection-mode');
            
            // Remove transition class after animation completes
            setTimeout(() => {
                eventsList.classList.remove('transitioning');
            }, 300); // Match CSS transition duration
        });
    }

    // Smoothly transition out of selection mode
    transitionOutOfSelectionMode(eventsList) {
        // Add transition class for smooth animation
        eventsList.classList.add('transitioning');
        
        // Use requestAnimationFrame to ensure the transition class is applied
        requestAnimationFrame(() => {
            // Remove selection mode class
            eventsList.classList.remove('selection-mode');
            
            // Remove transition class after animation completes
            setTimeout(() => {
                eventsList.classList.remove('transitioning');
            }, 300); // Match CSS transition duration
        });
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
                if (marker._icon) {
                    marker._icon.classList.remove('marker-selected');
                    marker._icon.classList.add('marker-dimmed');
                }
            });
            logger.userInteraction('MAP', 'All markers dimmed (selection active but no marker selected)', { eventSlug });
            return;
        }
        
        // Use CSS classes instead of inline styles
        if (window.eventsMapMarkersBySlug) {
            Object.entries(window.eventsMapMarkersBySlug).forEach(([slug, marker]) => {
                if (marker._icon) {
                    // Remove all marker state classes
                    marker._icon.classList.remove('marker-selected', 'marker-dimmed');
                    
                    if (slug === eventSlug) {
                        // Highlight the selected marker
                        marker._icon.classList.add('marker-selected');
                    } else {
                        // Dim unselected markers
                        marker._icon.classList.add('marker-dimmed');
                    }
                }
            });
        }
        
        logger.debug('MAP', 'Selected marker highlighted, unselected markers dimmed', { eventSlug });
        logger.userInteraction('MAP', 'Marker highlighted and unselected markers dimmed', { eventSlug });
    }

    // Helper method to reset all map markers to normal appearance
    resetAllMapMarkers() {
        if (window.eventsMapMarkersBySlug) {
            const markerCount = Object.keys(window.eventsMapMarkersBySlug).length;
            Object.values(window.eventsMapMarkersBySlug).forEach(marker => {
                if (marker._icon) {
                    // Remove all marker state classes
                    marker._icon.classList.remove('marker-selected', 'marker-dimmed');
                }
            });
            logger.debug('MAP', 'All markers reset to normal appearance', { markerCount });
            logger.userInteraction('MAP', 'All map markers reset to normal appearance', { markerCount });
        }
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
            
            // Convert image URLs based on data source
            if (eventData.image && this.dataSource === 'cached') {
                const originalImageUrl = eventData.image;
                eventData.image = this.convertImageUrlToLocal(originalImageUrl, eventData);
                
                logger.debug('CALENDAR', 'Converted image URL for cached data', {
                    eventName: eventData.name,
                    originalUrl: originalImageUrl,
                    localPath: eventData.image,
                    dataSource: this.dataSource
                });
            } else if (eventData.image && (this.dataSource === 'proxy' || this.dataSource === 'fallback')) {
                logger.debug('CALENDAR', 'Using external image URL for external data', {
                    eventName: eventData.name,
                    imageUrl: eventData.image,
                    dataSource: this.dataSource
                });
            }
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


    // Create marker icon with favicon or three letters
    createMarkerIcon(event) {
        if (event.website) {
            try {
                logger.debug('MAP', 'Creating favicon marker', {
                    eventName: event.name,
                    website: event.website,
                    dataSource: this.dataSource
                });
                
                // Ensure URL has protocol
                let url = event.website;
                if (!url.startsWith('http://') && !url.startsWith('https://')) {
                    url = 'https://' + url;
                }
                
                let faviconUrl;
                
                // Convert to local favicon URL if using cached data
                if (this.dataSource === 'cached') {
                    faviconUrl = window.FilenameUtils.convertWebsiteUrlToFaviconPath(url, '/img/favicons');
                    
                    logger.debug('MAP', 'Using local favicon for cached data', {
                        website: url,
                        localPath: faviconUrl,
                        dataSource: this.dataSource
                    });
                } else {
                    // For live data, use Google favicon service with higher quality
                    const hostname = new URL(url).hostname;
                    faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
                }
                
                const textFallback = this.getMarkerText(event);
                
                logger.debug('MAP', 'Favicon URL generated', {
                    website: url,
                    faviconUrl,
                    textFallback,
                    dataSource: this.dataSource
                });
                
                return L.divIcon({
                    className: 'favicon-marker',
                    html: `
                        <div class="favicon-marker-container">
                            <img src="${faviconUrl}" alt="venue" class="favicon-marker-icon"
                                 onerror="this.parentElement.innerHTML='<span class=\\'marker-text\\'>${textFallback}</span>'; this.parentElement.classList.add('text-marker');">
                        </div>
                    `,
                    iconSize: [40, 40],
                    iconAnchor: [20, 20],
                    popupAnchor: [0, -16]
                });
            } catch (error) {
                logger.warn('MAP', 'Failed to create favicon marker', { website: event.website, error: error.message });
            }
        }
        
        // Use text from shorter field or shortName or name
        const markerText = this.getMarkerText(event);
        return L.divIcon({
            className: 'favicon-marker text-marker',
            html: `
                <div class="favicon-marker-container text-marker">
                    <span class="marker-text">${markerText}</span>
                </div>
            `,
            iconSize: [40, 40],
            iconAnchor: [20, 20],
            popupAnchor: [0, -16]
        });
    }

    // Get marker text from event data
    getMarkerText(event) {
        // Priority: shorter → shortName → name
        return event.shorter || this.insertSoftHyphens(event.shortName, true) || event.name || 'Event';
    }

    getCurrentPeriodBounds() {
        return this.currentView === 'week' 
            ? this.getWeekBounds(this.currentDate)
            : this.getMonthBounds(this.currentDate);
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
                                        <span class="event-time">${event.time}</span>
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
        this.currentDate = new Date(dateString);
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
        const options = { month: 'short', day: 'numeric' };
        
        if (this.currentView === 'week') {
            if (start.getMonth() === end.getMonth()) {
                return `${start.toLocaleDateString('en-US', { month: 'short' })} ${start.getDate()}-${end.getDate()}`;
            } else {
                return `${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}`;
            }
        } else {
            return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        }
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
        
        // Normal flow: Try to load cached calendar data first
        const cachedDataUrl = this.buildLocalCalendarUrl(cityKey);
        
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
                    'Accept': 'text/calendar,text/plain,*/*'
                },
                cache: 'default' // Use browser cache for efficiency
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
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
            
            logger.timeEnd('CALENDAR', `Loading ${cityConfig.name} calendar data`);
            logger.componentLoad('CALENDAR', `Successfully processed cached calendar data for ${cityConfig.name}`, {
                eventCount: events.length,
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
        const eventInfo = {
            name: eventData.name,
            startDate: eventData.startDate,
            recurring: eventData.recurring
        };
        
        return window.FilenameUtils.convertImageUrlToLocalPath(
            imageUrl,
            eventInfo,
            'img/events'
        );
    }


    // Resolve correct local calendar URL depending on current page location
    buildLocalCalendarUrl(cityKey) {
        try {
            const pathname = window.location.pathname || '';
            
            // Use PathUtils if available for consistent path resolution
            if (window.pathUtils) {
                return window.pathUtils.resolvePath(`data/calendars/${cityKey}.ics`);
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
            
            return `${prefix}data/calendars/${cityKey}.ics`;
        } catch (e) {
            // Safe fallback
            return `data/calendars/${cityKey}.ics`;
        }
    }
    
    // Try multiple free CORS proxies to fetch Google Calendar ICS
    async loadCalendarDataViaProxy(cityKey, cityConfig) {
        const icalUrl = `https://calendar.google.com/calendar/ical/${cityConfig.calendarId}/public/basic.ics`;
        const proxyBuilders = [
            (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
            (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`
        ];
        
        for (let i = 0; i < proxyBuilders.length; i++) {
            const proxyUrl = proxyBuilders[i](icalUrl);
            try {
                this.updateLoadingMessage(i + 1, 'proxy');
                logger.info('CALENDAR', 'Attempting to load calendar via CORS proxy', {
                    cityKey,
                    proxyIndex: i,
                    proxyUrlPreview: proxyUrl.split('?')[0]
                });
                
                const fetchPromise = fetch(proxyUrl, {
                    method: 'GET',
                    headers: { 'Accept': 'text/calendar,text/plain,*/*' },
                    cache: 'no-cache'
                });
                
                // 12s timeout per proxy
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Proxy request timed out after 12 seconds')), 12000);
                });
                
                const response = await Promise.race([fetchPromise, timeoutPromise]);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const icalText = await response.text();
                if (!icalText || !icalText.includes('BEGIN:VCALENDAR')) {
                    throw new Error('Invalid iCal data received via proxy');
                }
                
                logger.apiCall('CALENDAR', 'Successfully loaded calendar via CORS proxy', {
                    cityKey,
                    proxyIndex: i,
                    dataLength: icalText.length
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
                logger.warn('CALENDAR', 'CORS proxy attempt failed', {
                    cityKey,
                    proxyIndex: i,
                    error: error.message
                });
                // Try next proxy
                continue;
            }
        }
        
        logger.componentError('CALENDAR', 'All CORS proxy attempts failed');
        return null;
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

            return `<a href="${link.url}" target="_blank" rel="noopener" class="event-link icon-only" aria-label="${aria}" title="${aria}"><i class="bi ${iconClass}"></i></a>`;
        }).join(' ') : '';

        const teaHtml = this.generateTeaHtml(event);
        const locationHtml = this.generateLocationHtml(event);
        const coverHtml = this.generateCoverHtml(event);

        // Get current calendar period bounds for contextual date display
        const periodBounds = this.getCurrentPeriodBounds();
        
        // Event badges
        const formatDayTime = (event) => {
            return this.getEnhancedDayTimeDisplay(event, this.currentView, periodBounds);
        };
        
        const recurringBadgeContent = this.getRecurringBadgeContent(event);
        const recurringBadge = recurringBadgeContent ? 
            `<span class="recurring-badge">${recurringBadgeContent}</span>` : '';
        
        const dateBadgeContent = this.getDateBadgeContent(event, periodBounds);
        const dateBadge = dateBadgeContent ? 
            `<span class="date-badge">${dateBadgeContent}</span>` : '';
        
        // Add distance badge if location features are enabled and distance is available
        const distanceBadge = this.locationFeaturesEnabled && event.distanceFromUser !== undefined ? 
            `<span class="distance-badge" title="Distance from your location"><i class="bi bi-geo-alt"></i> ${event.distanceFromUser} mi</span>` : '';

        return `
            <div class="event-card detailed" data-event-slug="${event.slug}" data-lat="${event.coordinates?.lat || ''}" data-lng="${event.coordinates?.lng || ''}">
                <div class="event-header">
                    <h3>${event.name}</h3>
                    <div class="event-meta">
                        <div class="event-day">${formatDayTime(event)}</div>
                        ${recurringBadge}
                        ${dateBadge}
                        ${distanceBadge}
                    </div>
                </div>
                <div class="event-details">
                    ${locationHtml}
                    ${coverHtml}
                    ${teaHtml}
                    <div class="event-links">
                        ${linksHtml}
                        <button class="share-event-btn icon-only" data-event-slug="${event.slug}" data-event-name="${event.name}" data-event-venue="${event.bar || ''}" data-event-time="${event.day} ${event.time}" title="Share this event" aria-label="Share this event">
                            <span class="share-icon" aria-hidden="true"><i class="bi bi-box-arrow-up"></i></span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // Setup share button handlers for event cards
    setupShareButtons() {
        const shareButtons = document.querySelectorAll('.share-event-btn');
        
        shareButtons.forEach(button => {
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
                } else {
                    // No share capability available
                    this.showShareToast('Sharing not supported on this browser');
                    logger.warn('EVENT', 'No share method available');
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
    getFilteredEvents() {
        // Handle case where allEvents is not yet loaded
        if (!this.allEvents || !Array.isArray(this.allEvents)) {
            logger.debug('CALENDAR', '🔍 FILTER: No allEvents available for filtering', {
                allEventsExists: !!this.allEvents,
                allEventsType: typeof this.allEvents,
                allEventsIsArray: Array.isArray(this.allEvents)
            });
            return [];
        }
        
        const { start, end } = this.getCurrentPeriodBounds();
        
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
            const isInPeriod = this.isEventInPeriod(event.startDate, start, end);
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
            
            // If dates are the same, sort by start time
            if (dateA.toDateString() === dateB.toDateString()) {
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
            if (this.isEventOccurringOnDate(event, current)) {
                occurrences.push(new Date(current));
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
            if (this.isEventOccurringOnDate(event, current)) {
                return true;
            }
            current.setDate(current.getDate() + 1);
        }
        
        return false;
    }

    // Helper function to determine if a recurring event occurs on a specific date
    isEventOccurringOnDate(event, date) {
        if (!event.recurring || !event.startDate) return false;
        
        const eventDate = new Date(event.startDate);
        const checkDate = new Date(date);
        
        // Normalize dates to compare only date parts, not time
        eventDate.setHours(0, 0, 0, 0);
        checkDate.setHours(0, 0, 0, 0);
        
        // Make sure we're not checking before the event started
        if (checkDate < eventDate) return false;
        
        // Parse the recurrence rule to determine the pattern
        const recurrence = event.recurrence || '';
        const pattern = this.parseRecurrencePattern(recurrence);
        if (!pattern || !pattern.frequency) return false;
        
        const interval = pattern.interval || 1;
        const daysSinceStart = this.getDayDifference(eventDate, checkDate);
        if (daysSinceStart < 0) return false;
        
        if (pattern.frequency === 'DAILY') {
            // Daily events: occur every interval days
            return daysSinceStart % interval === 0;
        } else if (pattern.frequency === 'WEEKLY') {
            // Weekly events: occur on matching weekdays, respecting interval
            const targetDays = pattern.byDay && pattern.byDay.length > 0
                ? pattern.byDay
                    .map(dayCode => this.getDayIndexFromCode(dayCode))
                    .filter(dayIndex => dayIndex !== -1)
                : [eventDate.getDay()];
            
            if (targetDays.length === 0) {
                return false;
            }
            
            if (!targetDays.includes(checkDate.getDay())) return false;
            
            const weeksSinceStart = Math.floor(daysSinceStart / 7);
            return weeksSinceStart % interval === 0;
        } else if (pattern.frequency === 'MONTHLY') {
            const monthsSinceStart = (checkDate.getFullYear() - eventDate.getFullYear()) * 12 +
                (checkDate.getMonth() - eventDate.getMonth());
            if (monthsSinceStart < 0 || monthsSinceStart % interval !== 0) return false;
            
            // Monthly events: handle both BYMONTHDAY and BYDAY patterns
            if (recurrence.includes('BYMONTHDAY=')) {
                const dayMatch = recurrence.match(/BYMONTHDAY=(\d+)/);
                if (dayMatch) {
                    const targetDay = parseInt(dayMatch[1]);
                    // Check if this month has that many days
                    const lastDayOfMonth = new Date(checkDate.getFullYear(), checkDate.getMonth() + 1, 0).getDate();
                    return checkDate.getDate() === Math.min(targetDay, lastDayOfMonth);
                }
            } else if (recurrence.includes('BYDAY=')) {
                // Handle BYDAY patterns like BYDAY=3TH (third Thursday) or BYDAY=-1SA (last Saturday)
                const dayMatch = recurrence.match(/BYDAY=(-?\d+)([A-Z]{2})/);
                if (dayMatch) {
                    const occurrence = parseInt(dayMatch[1]); // 3 or -1 (negative means from end of month)
                    const dayCode = dayMatch[2]; // TH, SA, etc.
                    
                    // Convert day code to day number (0 = Sunday, 6 = Saturday)
                    const dayCodeToDayNumber = {
                        'SU': 0, 'MO': 1, 'TU': 2, 'WE': 3, 'TH': 4, 'FR': 5, 'SA': 6
                    };
                    
                    const targetDayOfWeek = dayCodeToDayNumber[dayCode];
                    if (targetDayOfWeek === undefined) return false;
                    
                    // Check if the check date is the correct day of the week
                    if (checkDate.getDay() !== targetDayOfWeek) return false;
                    
                    // Calculate the target date for this occurrence
                    const targetDate = this.calculateByDayOccurrence(
                        checkDate.getFullYear(), 
                        checkDate.getMonth(), 
                        occurrence, 
                        targetDayOfWeek
                    );
                    
                    return targetDate && checkDate.getTime() === targetDate.getTime();
                }
            }
            
            // Fallback: same day of month as original event, but handle month lengths
            const originalDay = eventDate.getDate();
            const lastDayOfMonth = new Date(checkDate.getFullYear(), checkDate.getMonth() + 1, 0).getDate();
            const targetDay = Math.min(originalDay, lastDayOfMonth);
            return checkDate.getDate() === targetDay;
        } else if (pattern.frequency === 'YEARLY') {
            const yearsSinceStart = checkDate.getFullYear() - eventDate.getFullYear();
            if (yearsSinceStart < 0 || yearsSinceStart % interval !== 0) return false;
            
            // Yearly events: same month and day
            return eventDate.getMonth() === checkDate.getMonth() && 
                   eventDate.getDate() === checkDate.getDate();
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
    deduplicateByUIDAndRecurrenceId(events) {
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
            const key = `${uid}-${recurrenceIdKey}`;
            
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

    // Helper function to calculate the specific occurrence of a day in a month
    // occurrence: positive number (1-5) for nth occurrence, negative (-1) for last occurrence
    // dayOfWeek: 0=Sunday, 1=Monday, ..., 6=Saturday
    calculateByDayOccurrence(year, month, occurrence, dayOfWeek) {
        try {
            if (occurrence > 0) {
                // Find the nth occurrence of the day (e.g., 3rd Thursday)
                const firstOfMonth = new Date(year, month, 1);
                const firstDayOfWeek = firstOfMonth.getDay();
                
                // Calculate days to add to get to the first occurrence of the target day
                let daysToAdd = (dayOfWeek - firstDayOfWeek + 7) % 7;
                
                // Add weeks to get to the nth occurrence
                daysToAdd += (occurrence - 1) * 7;
                
                const targetDate = new Date(year, month, 1 + daysToAdd);
                
                // Verify it's still in the same month
                if (targetDate.getMonth() !== month) {
                    return null;
                }
                
                return targetDate;
            } else if (occurrence === -1) {
                // Find the last occurrence of the day (e.g., last Saturday)
                const lastOfMonth = new Date(year, month + 1, 0);
                const lastDayOfWeek = lastOfMonth.getDay();
                
                // Calculate days to subtract to get to the last occurrence of the target day
                let daysToSubtract = (lastDayOfWeek - dayOfWeek + 7) % 7;
                
                const targetDate = new Date(year, month + 1, 0 - daysToSubtract);
                
                // Verify it's still in the same month
                if (targetDate.getMonth() !== month) {
                    return null;
                }
                
                return targetDate;
            }
            
            return null;
        } catch (error) {
            logger.componentError('CALENDAR', 'Error calculating BYDAY occurrence', {
                year, month, occurrence, dayOfWeek, error
            });
            return null;
        }
    }

    // Generate calendar events (enhanced for week/month/calendar view)
    generateCalendarEvents(events, hideEvents = false) {
        const { start, end } = this.getCurrentPeriodBounds();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (this.currentView === 'week') {
            return this.generateWeekView(events, start, end, today, hideEvents);
        } else {
            return this.generateMonthView(events, start, end, today, hideEvents);
        }
    }

    generateWeekView(events, start, end, today, hideEvents = false) {
        const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const days = [];
        
        for (let i = 0; i < 7; i++) {
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

        return days.map(day => {
            const dayEvents = events.filter(event => {
                if (!event.startDate) return false;
                
                // For already expanded recurring events, just check if the date matches
                if (event.isExpanded) {
                    const eventDate = new Date(event.startDate);
                    eventDate.setHours(0, 0, 0, 0);
                    const dayDate = new Date(day);
                    dayDate.setHours(0, 0, 0, 0);
                    
                    return eventDate.getTime() === dayDate.getTime();
                }
                
                // For non-expanded recurring events, use the occurrence check
                if (event.recurring) {
                    return this.isEventOccurringOnDate(event, day);
                }
                
                // For non-recurring events, check exact date match
                const eventDate = new Date(event.startDate);
                eventDate.setHours(0, 0, 0, 0);
                const dayDate = new Date(day);
                dayDate.setHours(0, 0, 0, 0);
                
                return eventDate.getTime() === dayDate.getTime();
            });
            
            // Events are already deduplicated in getFilteredEvents, so use them directly
            const filteredDayEvents = dayEvents;

            const eventsHtml = filteredDayEvents.length > 0 
                ? filteredDayEvents.map(event => {
                    const mobileTime = this.formatTimeForMobile(event.time);
                    
                    return `
                        <div class="event-item" data-event-slug="${event.slug}" title="${event.name} at ${event.bar || 'Location'} - ${event.time}">
                            ${this.generateEventNameElements(event, hideEvents)}
                            <div class="event-time">${mobileTime}</div>
                            <div class="event-venue">${event.bar || ''}</div>
                        </div>
                    `;
                }).join('')
                : '';

            const isToday = day.getTime() === today.getTime();
            const currentClass = isToday ? ' current' : '';
            const dayName = daysOfWeek[day.getDay()];
            const eventCount = filteredDayEvents.length;

            return `
                <div class="calendar-day week-view${currentClass}" data-day="${dayName}" data-date="${day.toISOString().split('T')[0]}">
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
        // Add day headers first
        const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const headerHtml = dayHeaders.map(day => `
            <div class="calendar-day-header">
                <h4>${day}</h4>
            </div>
        `).join('');
        
        // For month view, create a grid including days from previous/next month to fill the calendar
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

        const daysHtml = days.map(day => {
            const dayEvents = events.filter(event => {
                if (!event.startDate) return false;
                
                // For already expanded recurring events, just check if the date matches
                if (event.isExpanded) {
                    const eventDate = new Date(event.startDate);
                    eventDate.setHours(0, 0, 0, 0);
                    const dayDate = new Date(day);
                    dayDate.setHours(0, 0, 0, 0);
                    
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
                    const matches = this.isEventOccurringOnDate(event, day);
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
                const eventDate = new Date(event.startDate);
                eventDate.setHours(0, 0, 0, 0);
                const dayDate = new Date(day);
                dayDate.setHours(0, 0, 0, 0);
                
                return eventDate.getTime() === dayDate.getTime();
            });
            
            // Events are already deduplicated in getFilteredEvents, so use them directly
            const filteredDayEvents = dayEvents;

            const isToday = day.getTime() === today.getTime();
            const isCurrentMonth = day.getMonth() === start.getMonth();
            const currentClass = isToday ? ' current' : '';
            const otherMonthClass = isCurrentMonth ? '' : ' other-month';
            const hasEventsClass = filteredDayEvents.length > 0 ? ' has-events' : '';

            // Ultra-simplified month view: show only 2 events with shortened names for better mobile viewing
            const eventsToShow = filteredDayEvents.slice(0, 2);
            const additionalEventsCount = Math.max(0, filteredDayEvents.length - 2);
            
            const eventsHtml = eventsToShow.length > 0 
                ? eventsToShow.map(event => {
                    const mobileTime = this.formatTimeForMobile(event.time);
                    
                    return `
                        <div class="event-item" data-event-slug="${event.slug}" title="${event.name} at ${event.bar || 'Location'} - ${event.time}">
                            ${this.generateEventNameElements(event, hideEvents)}
                            <div class="event-time">${mobileTime}</div>
                            <div class="event-venue">${event.bar || ''}</div>
                        </div>
                    `;
                }).join('') + (additionalEventsCount > 0 ? `<div class="more-events">+${additionalEventsCount}</div>` : '')
                : '';

            return `
                <div class="calendar-day month-day${currentClass}${otherMonthClass}${hasEventsClass}" data-date="${day.toISOString().split('T')[0]}">
                    <div class="day-header">
                        <span class="day-number">${day.getDate()}</span>
                        ${isToday ? `<span class="day-indicator">Today</span>` : ''}
                    </div>
                    <div class="day-events">
                        ${eventsHtml}
                    </div>
                </div>
            `;
        }).join('');

        return headerHtml + daysHtml;
    }

    // Initialize map
    initializeMap(cityConfig, events) {
        logger.debug('MAP', 'Starting map initialization', {
            cityName: cityConfig?.name,
            eventCount: events?.length,
            mapContainerExists: !!document.querySelector('#events-map'),
            leafletAvailable: typeof L !== 'undefined'
        });

        const mapContainer = document.querySelector('#events-map');
        if (!mapContainer || typeof L === 'undefined') {
            logger.warn('MAP', 'Map initialization skipped - missing container or Leaflet', {
                mapContainerExists: !!mapContainer,
                leafletAvailable: typeof L !== 'undefined'
            });
            return;
        }

        try {
            logger.debug('MAP', 'Removing existing map if present');
            // Remove existing map if it exists
            if (window.eventsMap) {
                window.eventsMap.remove();
                window.eventsMap = null;
            }

            // Filter events with valid coordinates
            const eventsWithCoords = events.filter(event => 
                event.coordinates?.lat && event.coordinates?.lng && 
                !isNaN(event.coordinates.lat) && !isNaN(event.coordinates.lng)
            );

            // Set up default map center and zoom (lower zoom to show more area)
            let mapCenter = [cityConfig.coordinates.lat, cityConfig.coordinates.lng];
            let mapZoom = cityConfig.mapZoom || 10; // Reduced from 11 to 10 for better overview on desktop

            const map = L.map('events-map', {
                scrollWheelZoom: false,
                doubleClickZoom: true,
                touchZoom: true,
                dragging: true,
                zoomControl: true,
                fullscreenControl: false
            }).setView(mapCenter, mapZoom);

            // Use clean US-based OpenStreetMap tiles
            logger.debug('MAP', 'Loading OpenStreetMap tile layer');
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 18
            }).addTo(map);
            logger.debug('MAP', 'Tile layer added successfully');



            // Add "fit all markers" control
            const fitMarkersControl = L.control({position: 'topleft'});
            fitMarkersControl.onAdd = function() {
                const div = L.DomUtil.create('div', 'leaflet-control-fit-markers');
                div.innerHTML = `
                    <button class="map-control-btn" id="zoom-to-fit-btn" onclick="fitAllMarkers()" title="Show All Events">
                        <i class="bi bi-pin-map" id="zoom-to-fit-icon"></i>
                    </button>
                `;
                return div;
            };
            fitMarkersControl.addTo(map);

            // Add "my location" control
            const myLocationControl = L.control({position: 'topleft'});
            myLocationControl.onAdd = function() {
                const div = L.DomUtil.create('div', 'leaflet-control-my-location');
                div.innerHTML = `
                    <button class="map-control-btn" id="location-btn" onclick="showMyLocation()" title="Show My Location">
                        <i class="bi bi-crosshair2" id="location-icon"></i>
                    </button>
                `;
                return div;
            };
            myLocationControl.addTo(map);
            
            // Initialize location status
            updateLocationStatus();

            // Enable scroll wheel zoom only when Ctrl is pressed
            map.on('wheel', function(e) {
                if (e.originalEvent.ctrlKey) {
                    map.scrollWheelZoom.enable();
                } else {
                    map.scrollWheelZoom.disable();
                }
            });

            // Disable scroll wheel zoom when mouse leaves map
            map.on('mouseout', function() {
                map.scrollWheelZoom.disable();
            });
            
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
                        
                        const marker = L.marker([event.coordinates.lat, event.coordinates.lng], {
                            icon: markerIcon,
                            eventSlug: event.slug
                        })
                            .addTo(map)
                            .on('click', () => {
                                // Select the event and scroll to it
                                const eventDateISO = event.date || this.formatDateToISO(this.currentDate);
                                this.toggleEventSelection(event.slug, eventDateISO);
                                
                                const eventCard = document.querySelector(`.event-card[data-event-slug="${event.slug}"]`);
                                if (eventCard) {
                                    eventCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    logger.userInteraction('MAP', 'Marker clicked, event selected and scrolled to', { eventSlug: event.slug });
                                } else {
                                    logger.warn('MAP', 'Event card not found for marker click', { eventSlug: event.slug });
                                }
                            });
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

            // Fit map to show all markers using Leaflet's built-in bounds calculation
            if (markers.length > 0) {
                const group = new L.featureGroup(markers);
                const isMobile = window.innerWidth <= 768;
                map.fitBounds(group.getBounds(), {
                    padding: [20, 20],
                    maxZoom: isMobile ? 11 : 12 // Reduced mobile zoom to 11, desktop stays at 12
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
                const eventSlug = marker.options.eventSlug;
                if (eventSlug) {
                    window.eventsMapMarkersBySlug[eventSlug] = marker;
                }
            });
            
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



    // Update calendar display with filtered events
    async updateCalendarDisplay(hideEvents = false) {
        logger.time('CALENDAR', 'Calendar display update');
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
        
        // Update calendar title
        try {
            const calendarTitle = document.getElementById('calendar-title');
            if (calendarTitle) {
                calendarTitle.textContent = `What's the vibe?`;
                logger.debug('CALENDAR', 'Calendar title updated successfully');
            } else {
                logger.warn('CALENDAR', 'Calendar title element not found');
            }
        } catch (error) {
            logger.warn('CALENDAR', 'Failed to update calendar title', { error: error.message });
        }
        
        // Update date range
        try {
            const dateRange = document.getElementById('date-range');
            if (dateRange) {
                const { start, end } = this.getCurrentPeriodBounds();
                dateRange.textContent = this.formatDateRange(start, end);
                logger.debug('CALENDAR', 'Date range updated successfully', { start, end });
            } else {
                logger.warn('CALENDAR', 'Date range element not found');
            }
        } catch (error) {
            logger.warn('CALENDAR', 'Failed to update date range', { error: error.message });
        }
        
        // Update calendar grid
        try {
            const calendarGrid = document.querySelector('.calendar-grid');
            if (calendarGrid) {
                logger.debug('CALENDAR', 'Updating calendar grid HTML');
                calendarGrid.innerHTML = this.generateCalendarEvents(filteredEvents, hideEvents);
                
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
        
        // Update grid layout based on view (outside try-catch since calendarGrid might not be defined)
        try {
            const calendarGrid = document.querySelector('.calendar-grid');
            if (calendarGrid) {
                if (this.currentView === 'month') {
                    calendarGrid.className = 'calendar-grid month-view-grid';
                    calendarGrid.style.gridTemplateColumns = 'repeat(7, 1fr)';
                    
                    // Calculate the optimal number of rows based on the actual content
                    const dayElements = calendarGrid.querySelectorAll('.calendar-day, .calendar-day-header');
                    const headerRows = calendarGrid.querySelectorAll('.calendar-day-header').length > 0 ? 1 : 0;
                    const dayRows = Math.ceil((dayElements.length - (headerRows * 7)) / 7);
                    const totalRows = headerRows + dayRows;
                    
                    calendarGrid.style.gridTemplateRows = `repeat(${headerRows}, auto) repeat(${dayRows}, minmax(90px, auto))`;
                    
                    logger.debug('CALENDAR', `Updated month view grid layout`, {
                        totalElements: dayElements.length,
                        headerRows: headerRows,
                        dayRows: dayRows,
                        totalRows: totalRows
                    });
                } else {
                    calendarGrid.className = 'calendar-grid week-view-grid';
                    calendarGrid.style.gridTemplateColumns = 'repeat(7, 1fr)';
                    calendarGrid.style.gridTemplateRows = 'auto';
                    calendarGrid.style.minHeight = 'auto';
                }
            }
        } catch (layoutError) {
            logger.warn('CALENDAR', 'Failed to update grid layout', { error: layoutError.message });
        }
        
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
            } else if (filteredEvents?.length > 0) {
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
                    const listDeduplicatedEvents = this.deduplicateByUIDAndRecurrenceId(filteredEvents);
                    
                    const eventCardsHtml = listDeduplicatedEvents.map(event => this.generateEventCard(event)).join('');
                    eventsList.innerHTML = eventCardsHtml;
                    
                    logger.debug('CALENDAR', '✅ UPDATE_DISPLAY: Successfully updated events list', {
                        htmlLength: eventCardsHtml.length,
                        originalEventCount: filteredEvents.length,
                        deduplicatedEventCount: listDeduplicatedEvents.length,
                        removedDuplicates: filteredEvents.length - listDeduplicatedEvents.length
                    });
                } catch (cardError) {
                    logger.componentError('CALENDAR', 'Failed to generate event cards', cardError);
                    eventsList.innerHTML = '<div class="loading-message">Error displaying events. Please refresh the page.</div>';
                }

                // Deep-link: handle event selection from URL parameters
                try {
                    const url = new URL(window.location.href);
                    const eventParam = url.searchParams.get('event') || (window.location.hash ? window.location.hash.replace('#','') : '');
                    if (eventParam && this.selectedEventSlug === eventParam) {
                        // Event is already selected from parseStateFromUrl, just scroll to it
                        const selector = `.event-card[data-event-slug="${CSS && CSS.escape ? CSS.escape(eventParam) : eventParam}"]`;
                        const target = document.querySelector(selector);
                        if (target) {
                            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            logger.debug('EVENT', `Deep-linked event scrolled to: ${eventParam}`);
                        } else {
                            logger.debug('EVENT', `Deep-linked event not found in current render: ${eventParam}`);
                        }
                    }
                } catch (_) {}
                
                // Add share button event handlers
                this.setupShareButtons();
                
                // Add card click handlers for selection toggle and URL sync
                this.attachEventCardSelectionHandlers();
                
                // Update visual selection state after rendering
                this.updateSelectionVisualState();
            } else {
                eventsList.innerHTML = '<div class="loading-message">No events found for this period. Try switching Week/Month or check back soon.</div>';
                logger.info('CALENDAR', 'No events to display for current period', {
                    view: this.currentView,
                    city: this.currentCity
                });
            }
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
                this.initializeMap(this.currentCityConfig, mapDeduplicatedEvents);
                logger.debug('CALENDAR', 'Map initialization completed');
                
                // Update visual selection state again after map is initialized
                // This ensures map markers are properly highlighted for auto-loaded slugs
                logger.debug('MAP', 'Calling updateSelectionVisualState after map initialization', {
                    selectedEventSlug: this.selectedEventSlug,
                    markersBySlugCount: window.eventsMapMarkersBySlug ? Object.keys(window.eventsMapMarkersBySlug).length : 0
                });
                this.updateSelectionVisualState();
                
                // Initialize location features after map is ready
                try {
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
                        showMyLocation();
                        
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
                            
                            const eventCard = document.querySelector(`.event-card[data-event-slug="${eventSlug}"]`);
                            if (eventCard) {
                                eventCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                logger.debug('EVENT', `Scrolled to event card: ${eventSlug}`);
                            } else {
                                logger.warn('EVENT', `Event card not found for: ${eventSlug}`);
                            }
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

    // Reusable HTML generation methods for event details
    generateTeaHtml(event) {
        return event.tea ? `
            <div class="detail-row">
                <span class="label">Tea:</span>
                <span class="value">${event.tea}</span>
            </div>
        ` : '';
    }

    generateLocationHtml(event) {
        return event.coordinates && event.coordinates.lat && event.coordinates.lng ? 
            `<div class="detail-row">
                <span class="label">Location:</span>
                <span class="value">
                    <a href="#" onclick="showOnMap(${event.coordinates.lat}, ${event.coordinates.lng}, '${event.name}', '${event.bar || ''}')" class="map-link">
                        📍 ${event.bar || 'Location'}
                    </a>
                </span>
            </div>` :
            (event.bar ? `<div class="detail-row">
                <span class="label">Bar:</span>
                <span class="value">${event.bar}</span>
            </div>` : '');
    }

    generateCoverHtml(event) {
        return event.cover && event.cover.trim() && event.cover.toLowerCase() !== 'free' && event.cover.toLowerCase() !== 'no cover' ? `
            <div class="detail-row">
                <span class="label">Cover:</span>
                <span class="value">${event.cover}</span>
            </div>
        ` : '';
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
            card.addEventListener('click', (e) => {
                // Ignore clicks that originate from share button
                const shareBtn = e.target.closest && e.target.closest('.share-event-btn');
                if (shareBtn) return;
                const slug = card.getAttribute('data-event-slug');
                // Prefer the date from selectedEventDateISO if it matches slug, else use currentDate
                const dayISO = this.selectedEventSlug === slug && this.selectedEventDateISO ? this.selectedEventDateISO : this.formatDateToISO(this.currentDate);
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
        const isOverride = Boolean(testRecurrenceId);
        
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
            heroImage: testEventData.heroImage || null,
            website: testEventData.website || null,
            tickets: testEventData.tickets || null,
            links: normalizedLinks,
            uid: testUid || null,
            recurrenceId: testRecurrenceId || null,
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
            if (!testUid) {
                return false;
            }
            const eventUid = event.uid || event.slug || event.name;
            if (!eventUid || eventUid !== testUid) {
                return false;
            }
            const eventRecurrenceId = toDate(event.recurrenceId);
            if (isOverride) {
                if (!eventRecurrenceId || !testRecurrenceId) {
                    return false;
                }
                return eventRecurrenceId.getTime() === testRecurrenceId.getTime();
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
            window.eventsMap.setView([lat, lng], 16);
            window.eventsMap.eachLayer(layer => {
                if (layer instanceof L.Marker) {
                    const latLng = layer.getLatLng();
                    if (Math.abs(latLng.lat - lat) < 0.0001 && Math.abs(latLng.lng - lng) < 0.0001) {
                        layer.openPopup();
                    }
                }
            });
        }, 300);
        
        logger.userInteraction('MAP', 'showOnMap called', { lat, lng, eventName, barName });
    }
}

// Update fit markers icon based on current state
function updateFitMarkersIcon() {
    const fitBtn = document.getElementById('zoom-to-fit-btn');
    const fitIcon = document.getElementById('zoom-to-fit-icon');
    if (fitBtn && fitIcon) {
        // Show filled icon when active, unfilled when not
        if (fitBtn.classList.contains('active')) {
            fitIcon.className = 'bi bi-pin-map-fill';
        } else {
            fitIcon.className = 'bi bi-pin-map';
        }
    }
}

// Map control functions
function fitAllMarkers() {
    if (window.eventsMap && window.eventsMapMarkers && window.eventsMapMarkers.length > 0) {
        const group = new L.featureGroup(window.eventsMapMarkers);
        const isMobile = window.innerWidth <= 768;
        window.eventsMap.fitBounds(group.getBounds(), {
            padding: [20, 20],
            maxZoom: isMobile ? 11 : 12 // Reduced mobile zoom to 11, desktop stays at 12
        });
        
        // Update icon based on current state
        updateFitMarkersIcon();
        
        logger.userInteraction('MAP', 'Fit all markers clicked', { markerCount: window.eventsMapMarkers.length });
    } else {
        logger.warn('MAP', 'No markers to fit');
    }
}




async function showMyLocation() {
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
                window.eventsMap.removeLayer(window.myLocationCircle);
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
            
            // Add location circle instead of marker
            window.myLocationCircle = L.circle([location.lat, location.lng], {
                color: '#4285f4',
                fillColor: '#4285f4',
                fillOpacity: 0.2,
                radius: 500,
                weight: 3
            }).addTo(window.eventsMap).bindPopup(popupText);
            
            // Calculate bounds that include both user location and all event markers
            const bounds = L.latLngBounds([[location.lat, location.lng]]);
            
            // Add all event markers to bounds
            if (window.eventsMapMarkers && window.eventsMapMarkers.length > 0) {
                window.eventsMapMarkers.forEach(marker => {
                    bounds.extend(marker.getLatLng());
                });
                
                // Fit map to show both user location and all events
                window.eventsMap.fitBounds(bounds, {
                    padding: [50, 50],
                    maxZoom: 14
                });
            } else {
                // If no event markers, just center on user location
                window.eventsMap.setView([location.lat, location.lng], 14);
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
                window.eventsMap.removeLayer(window.locationErrorPopup);
            }
            
            // Show error as map popup
            const center = window.eventsMap.getCenter();
            window.locationErrorPopup = L.popup()
                .setLatLng(center)
                .setContent(`<div style="text-align: center; color: #d32f2f; font-weight: 500;">${errorMessage}</div>`)
                .openOn(window.eventsMap);
            
            // Auto-close after 5 seconds
            setTimeout(() => {
                if (window.locationErrorPopup) {
                    window.eventsMap.closePopup(window.locationErrorPopup);
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
}