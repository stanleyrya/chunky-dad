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
        
        // Add visual indicator for swipe direction
        this.updateSwipeDirectionIndicator(deltaX, progress);
    }

    // Update swipe direction indicator
    updateSwipeDirectionIndicator(deltaX, progress) {
        const calendarGrid = document.querySelector('.calendar-grid');
        if (!calendarGrid) return;
        
        // Remove existing indicators
        const existingIndicator = calendarGrid.querySelector('.swipe-direction-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }
        
        // Only show indicator if swipe is significant
        if (progress > 0.1) {
            const indicator = document.createElement('div');
            indicator.className = 'swipe-direction-indicator';
            indicator.style.cssText = `
                position: absolute;
                top: 50%;
                ${deltaX > 0 ? 'right' : 'left'}: 20px;
                transform: translateY(-50%);
                background: var(--primary-color);
                color: white;
                padding: 8px 12px;
                border-radius: 20px;
                font-size: 0.8rem;
                font-weight: 600;
                z-index: 1000;
                opacity: ${progress * 0.9};
                transition: opacity 0.1s ease;
                pointer-events: none;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            `;
            indicator.textContent = deltaX > 0 ? '← Previous' : 'Next →';
            
            calendarGrid.appendChild(indicator);
        }
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
        
        // Reset transform, opacity, scale, rotation, and shadow with smooth transition
        calendarGrid.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out, box-shadow 0.2s ease-out';
        calendarGrid.style.transform = 'translateX(0) scale(1) rotateY(0deg)';
        calendarGrid.style.opacity = '1';
        calendarGrid.style.boxShadow = '';
        
        // Remove transition after animation completes
        setTimeout(() => {
            calendarGrid.style.transition = '';
        }, 200);
        
        // Remove direction indicator
        const indicator = calendarGrid.querySelector('.swipe-direction-indicator');
        if (indicator) {
            indicator.remove();
        }
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
            setTimeout(() => {
                // Update the calendar content (skip immediate display update)
                this.navigatePeriod(direction, false);
                
                // Update the display to get new content
                this.updateCalendarDisplay();
                
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
            if (cityParam) return cityParam;

            // Fallback: detect from first path segment (supports aliases)
            const slug = this.getCitySlugFromPath();
            if (slug) return slug;

            // Legacy: hash or default
            const hash = window.location.hash.replace('#', '');
            return hash || 'new-york';
        } catch (e) {
            logger.warn('CITY', 'Failed to resolve city from URL, defaulting to new-york', { error: e?.message });
            return 'new-york';
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
        this.selectedEventSlug = null;
        this.selectedEventDateISO = null;
        if (hadSelection) {
            logger.userInteraction('EVENT', 'Event selection cleared');
        }
    }
    
    // Toggle/select event for URL/state
    toggleEventSelection(eventSlug, eventDateISO) {
        if (!eventSlug) return;
        const normalizedDateISO = eventDateISO && /^\d{4}-\d{2}-\d{2}$/.test(eventDateISO) ? eventDateISO : this.formatDateToISO(this.currentDate);
        if (this.selectedEventSlug === eventSlug && this.selectedEventDateISO === normalizedDateISO) {
            this.clearEventSelection();
        } else {
            this.selectedEventSlug = eventSlug;
            this.selectedEventDateISO = normalizedDateISO;
            // Align currentDate to selected date for consistency
            const parts = normalizedDateISO.split('-');
            const parsed = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            if (!isNaN(parsed.getTime())) {
                this.currentDate = parsed;
            }
            logger.userInteraction('EVENT', 'Event selected', { eventSlug, date: normalizedDateISO });
        }
        // Reflect selection in URL
        this.syncUrl(true);
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
                eventData.shortName = this.generateShortName(eventData.bar, eventData.name);
            }
        }
        return eventData;
    }

    // Generate short name from bar name or event name
    // The purpose of shortName is to provide BETTER BREAKPOINTS for word wrapping,
    // not necessarily to be shorter in character count (e.g., "MEGA-WOOF" vs "MEGAWOOF")
    generateShortName(barName, eventName) {
        // Prefer event name if available, otherwise use bar name
        const sourceName = eventName || barName;
        if (!sourceName) return '';
        
        // Remove common words while preserving original casing
        // Focus on creating natural breakpoints rather than just shortening
        const stopWords = ['the', 'and', 'or', 'at', 'in', 'on', 'with', 'for', 'of', 'to', 'a', 'an'];
        const words = sourceName.split(' ');
        const filteredWords = words.filter(word => !stopWords.includes(word.toLowerCase()));
        
        // If we filtered out all words (e.g., "The"), use the original
        if (filteredWords.length === 0) {
            return sourceName;
        }
        
        let result = filteredWords.join(' ');
        
        // For single long words, add intelligent hyphenation points for better breaking
        if (filteredWords.length === 1 && filteredWords[0].length > 8) {
            result = this.addIntelligentHyphens(filteredWords[0]);
        }
        
        // Return the filtered name - CSS word-wrap will handle the display
        // The key is that this version should have better breakpoints than the original
        return result;
    }
    
    // Add intelligent hyphenation points to long single words
    addIntelligentHyphens(word) {
        if (!word || word.length <= 8) return word;
        
        // Common patterns for hyphenation in event names
        const patterns = [
            // Bear community specific terms
            { pattern: /^(Rock)(strap)$/i, replacement: '$1-$2' },
            { pattern: /^(Under)(wear)$/i, replacement: '$1-$2' },
            { pattern: /^(Leather)(daddy|bear|night)$/i, replacement: '$1-$2' },
            { pattern: /^(Bear)(night|party|weekend)$/i, replacement: '$1-$2' },
            { pattern: /^(Happy)(hour)$/i, replacement: '$1-$2' },
            { pattern: /^(After)(party|hours)$/i, replacement: '$1-$2' },
            { pattern: /^(Pre)(game|party)$/i, replacement: '$1-$2' },
            { pattern: /^(Post)(game|party|work)$/i, replacement: '$1-$2' },
            { pattern: /^(Mid)(week|night)$/i, replacement: '$1-$2' },
            { pattern: /^(Week)(end|night)$/i, replacement: '$1-$2' },
            
            // General compound word patterns
            { pattern: /^(.{4,6})(night|party|fest|event)$/i, replacement: '$1-$2' },
            { pattern: /^(night|party|bear)(.{4,})$/i, replacement: '$1-$2' },
        ];
        
        // Try each pattern
        for (const { pattern, replacement } of patterns) {
            if (pattern.test(word)) {
                const result = word.replace(pattern, replacement);
                logger.debug('CALENDAR', `🔍 HYPHEN: Added intelligent hyphen to "${word}" → "${result}"`);
                return result;
            }
        }
        
        // Fallback: add hyphen after 4-6 characters if no pattern matches
        if (word.length > 8) {
            const breakPoint = Math.min(6, Math.floor(word.length / 2));
            const result = word.slice(0, breakPoint) + '-' + word.slice(breakPoint);
            logger.debug('CALENDAR', `🔍 HYPHEN: Added fallback hyphen to "${word}" → "${result}"`);
            return result;
        }
        
        return word;
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

    // Generate favicon HTML for map popup
    getFaviconHtml(websiteUrl) {
        if (!websiteUrl) return '';
        
        try {
            // Ensure URL has protocol
            let url = websiteUrl;
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }
            
            const hostname = new URL(url).hostname;
            return `<img src="https://www.google.com/s2/favicons?domain=${hostname}&sz=16" alt="favicon" class="popup-favicon" onerror="this.style.display='none'">`;
        } catch (error) {
            logger.warn('MAP', 'Failed to generate favicon HTML', { websiteUrl, error: error.message });
            return '';
        }
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
    switchToWeekView(dateString) {
        this.currentDate = new Date(dateString);
        this.currentView = 'week';
        
        // Update active button
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.view-btn[data-view="week"]').classList.add('active');
        
        // Remove modal
        document.querySelector('.day-events-modal')?.remove();
        
        // Clear current selection when jumping views
        this.clearEventSelection();
        this.updateCalendarDisplay();
        this.syncUrl(true);
    }

    navigatePeriod(direction, skipAnimation = false) {
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
            this.updateCalendarDisplay();
        }
    }

    goToToday() {
        this.currentDate = new Date();
        this.clearEventSelection();
        this.updateCalendarDisplay();
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
        
        logger.time('CALENDAR', `Loading ${cityConfig.name} calendar data`);
        
        // If proxy parameter is set, skip cached data and go directly to proxy
        if (useProxy) {
            logger.info('CALENDAR', 'Proxy parameter detected - using proxy for calendar data');
            const proxyResult = await this.loadCalendarDataViaProxy(cityKey, cityConfig);
            if (proxyResult) return proxyResult;
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
                source: 'github_actions_cache'
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
            const proxyResult = await this.loadCalendarDataViaProxy(cityKey, cityConfig);
            if (proxyResult) {
                return proxyResult;
            }
            
            // Fallback 2: try to load directly from Google (will likely fail due to CORS, but worth trying)
            return this.loadCalendarDataFallback(cityKey, cityConfig);
        }
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
            
            // City subdirectories (like /new-york/, /seattle/) need to go up one level
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
             this.showCalendarError();
             return null;
         }
     }
 
     // Show calendar error - only in the events container for cleaner display
     showCalendarError() {
         const errorMessage = `
             <div class="error-message">
                 <h3>📅 Calendar Temporarily Unavailable</h3>
                 <p>We're having trouble loading the latest events for ${this.currentCityConfig?.name || 'this city'}.</p>
                 <p><strong>What's happening:</strong> Our calendar data is updated automatically every 2 hours. The latest update may not be available yet.</p>
                 <p><strong>Try:</strong> Refreshing the page in a few minutes, or check our social media for the latest updates.</p>
             </div>
         `;
         
         // Only show error in the events container to avoid duplication
         const eventsContainer = document.querySelector('.events-list');
         if (eventsContainer) {
             eventsContainer.innerHTML = errorMessage;
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
        
        // New three-badge system
        const formatDayTime = (event) => {
            return this.getEnhancedDayTimeDisplay(event, this.currentView, periodBounds);
        };
        
        const recurringBadgeContent = this.getRecurringBadgeContent(event);
        const recurringBadge = recurringBadgeContent ? 
            `<span class="recurring-badge">${recurringBadgeContent}</span>` : '';
        
        const dateBadgeContent = this.getDateBadgeContent(event, periodBounds);
        const dateBadge = dateBadgeContent ? 
            `<span class="date-badge">${dateBadgeContent}</span>` : '';
        
        const notCheckedBadge = event.notChecked ? 
            `<span class="not-checked-badge" title="This event has not been verified yet">⚠️ Unverified</span>` : '';

        return `
            <div class="event-card detailed" data-event-slug="${event.slug}" data-lat="${event.coordinates?.lat || ''}" data-lng="${event.coordinates?.lng || ''}">
                <div class="event-header">
                    <h3>${event.name}</h3>
                    <div class="event-meta">
                        <div class="event-day">${formatDayTime(event)}</div>
                        ${recurringBadge}
                        ${dateBadge}
                        ${notCheckedBadge}
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
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
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
        
        const filtered = this.allEvents.filter(event => {
            if (!event.startDate) return false;
            
            // Filter out events marked as notChecked if configured to hide them
            if (event.notChecked && this.config?.hideUncheckedEvents) {
                logger.debug('CALENDAR', `Filtering out unchecked event: ${event.name}`);
                return false;
            }
            
            // For recurring events, check if they occur in this period
            if (event.recurring) {
                return this.isRecurringEventInPeriod(event, start, end);
            }
            
            // For one-time events, check if they fall within the period
            return this.isEventInPeriod(event.startDate, start, end);
        });
        
        // Sort events by upcoming time (earliest first)
        filtered.sort((a, b) => {
            const dateA = new Date(a.startDate);
            const dateB = new Date(b.startDate);
            
            // If dates are the same, sort by start time
            if (dateA.toDateString() === dateB.toDateString()) {
                return dateA.getTime() - dateB.getTime();
            }
            
            // Otherwise sort by date
            return dateA.getTime() - dateB.getTime();
        });
        
        return filtered;
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
        
        if (recurrence.includes('FREQ=WEEKLY')) {
            // Weekly events: occur on the same day of the week
            return eventDate.getDay() === checkDate.getDay();
        } else if (recurrence.includes('FREQ=MONTHLY')) {
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
        } else if (recurrence.includes('FREQ=DAILY')) {
            // Daily events: occur every day
            return true;
        } else if (recurrence.includes('FREQ=YEARLY')) {
            // Yearly events: same month and day
            return eventDate.getMonth() === checkDate.getMonth() && 
                   eventDate.getDate() === checkDate.getDate();
        }
        
        // Default fallback for other recurring patterns - use day of week
        return eventDate.getDay() === checkDate.getDay();
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
                
                if (event.recurring) {
                    return this.isEventOccurringOnDate(event, day);
                }
                
                const eventDate = new Date(event.startDate);
                eventDate.setHours(0, 0, 0, 0);
                const dayDate = new Date(day);
                dayDate.setHours(0, 0, 0, 0);
                
                return eventDate.getTime() === dayDate.getTime();
            });

            const eventsHtml = dayEvents.length > 0 
                ? dayEvents.map(event => {
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
            const eventCount = dayEvents.length;

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
                
                if (event.recurring) {
                    return this.isEventOccurringOnDate(event, day);
                }
                
                const eventDate = new Date(event.startDate);
                eventDate.setHours(0, 0, 0, 0);
                const dayDate = new Date(day);
                dayDate.setHours(0, 0, 0, 0);
                
                return eventDate.getTime() === dayDate.getTime();
            });

            const isToday = day.getTime() === today.getTime();
            const isCurrentMonth = day.getMonth() === start.getMonth();
            const currentClass = isToday ? ' current' : '';
            const otherMonthClass = isCurrentMonth ? '' : ' other-month';
            const hasEventsClass = dayEvents.length > 0 ? ' has-events' : '';

            // Ultra-simplified month view: show only 2 events with shortened names for better mobile viewing
            const eventsToShow = dayEvents.slice(0, 2);
            const additionalEventsCount = Math.max(0, dayEvents.length - 2);
            
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
        const mapContainer = document.querySelector('#events-map');
        if (!mapContainer || typeof L === 'undefined') return;

        try {
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
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 18
            }).addTo(map);



            // Add "fit all markers" control
            const fitMarkersControl = L.control({position: 'topleft'});
            fitMarkersControl.onAdd = function() {
                const div = L.DomUtil.create('div', 'leaflet-control-fit-markers');
                div.innerHTML = `
                    <button class="map-control-btn" onclick="fitAllMarkers()" title="Show All Events">
                        🎯
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
                    <button class="map-control-btn" onclick="showMyLocation()" title="Show My Location">
                        📍
                    </button>
                `;
                return div;
            };
            myLocationControl.addTo(map);

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
            
            // Create custom marker icon
            const logoPath = window.pathUtils ? window.pathUtils.getLogoPath() : 'Rising_Star_Ryan_Head_Compressed.png';
            const customIcon = L.divIcon({
                className: 'custom-marker',
                html: `
                    <div class="marker-pin">
                        <div class="marker-icon"><img src="${logoPath}" alt="chunky.dad" class="map-marker-icon"></div>
                    </div>
                `,
                iconSize: [44, 56],
                iconAnchor: [22, 56],
                popupAnchor: [0, -56]
            });

            events.forEach(event => {
                if (event.coordinates?.lat && event.coordinates?.lng && 
                    !isNaN(event.coordinates.lat) && !isNaN(event.coordinates.lng)) {
                    const marker = L.marker([event.coordinates.lat, event.coordinates.lng], {
                        icon: customIcon
                    })
                        .addTo(map)
                        .bindPopup(`
                            <div class="map-popup">
                                <div class="popup-header">
                                    <div class="popup-title-section">
                                        ${event.website ? this.getFaviconHtml(event.website) : ''}
                                        <h4>${event.shorterName || event.shortName || event.name}</h4>
                                    </div>
                                    ${event.instagram ? `<a href="${event.instagram}" target="_blank" class="popup-instagram" title="Instagram"><i class="bi bi-instagram"></i></a>` : ''}
                                </div>
                                <p><strong>📍 ${event.bar || 'Location'}</strong></p>
                                <p>📅 ${event.day} ${event.time}</p>
                                ${event.cover && event.cover.trim() && event.cover.toLowerCase() !== 'free' && event.cover.toLowerCase() !== 'no cover' ? `<p>💰 ${event.cover}</p>` : ''}
                                ${event.recurring ? `<p>🔄 ${event.eventType}</p>` : ''}
                            </div>
                        `);
                    markers.push(marker);
                    markersAdded++;
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
        } catch (error) {
            logger.componentError('MAP', 'Failed to initialize map', error);
        }
    }

    // Update calendar display with filtered events
    updateCalendarDisplay(hideEvents = false) {
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
        const calendarTitle = document.getElementById('calendar-title');
        if (calendarTitle) {
            calendarTitle.textContent = `What's the vibe?`;
        }
        
        // Update date range
        const dateRange = document.getElementById('date-range');
        if (dateRange) {
            const { start, end } = this.getCurrentPeriodBounds();
            dateRange.textContent = this.formatDateRange(start, end);
        }
        
        // Update calendar grid
        const calendarGrid = document.querySelector('.calendar-grid');
        if (calendarGrid) {
            calendarGrid.innerHTML = this.generateCalendarEvents(filteredEvents, hideEvents);
            
            // For measurement mode, make the grid invisible to users but keep same layout constraints
            if (hideEvents) {
                // Keep the element in its normal position but hide it behind background
                calendarGrid.style.position = 'relative';
                calendarGrid.style.zIndex = '-999'; // Behind everything else
                calendarGrid.style.opacity = '0'; // Invisible to users
                calendarGrid.style.pointerEvents = 'none'; // Can't interact with it
                calendarGrid.style.visibility = 'visible'; // Still measurable by JS
            } else {
                // Reset to normal visibility
                calendarGrid.style.position = '';
                calendarGrid.style.zIndex = '';
                calendarGrid.style.opacity = '1';
                calendarGrid.style.pointerEvents = '';
                calendarGrid.style.visibility = 'visible';
            }
            
            this.attachCalendarInteractions();
            
            // Update grid layout based on view
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
        
        // Update events list (show for both week and month views)
        const eventsList = document.querySelector('.events-list');
        const eventsSection = document.querySelector('.events');
        if (eventsList && eventsSection) {
            eventsSection.style.display = 'block';
            if (hideEvents) {
                // Keep existing loading message when hideEvents is true
                if (!eventsList.querySelector('.loading-message')) {
                    eventsList.innerHTML = '<div class="loading-message">📅 Getting events...</div>';
                }
            } else if (filteredEvents?.length > 0) {
                // Events are already sorted by upcoming time in getFilteredEvents()
                eventsList.innerHTML = filteredEvents.map(event => this.generateEventCard(event)).join('');

                // Deep-link: highlight event from ?event=<slug> or #<slug>
                try {
                    const url = new URL(window.location.href);
                    const eventParam = url.searchParams.get('event') || (window.location.hash ? window.location.hash.replace('#','') : '');
                    if (eventParam) {
                        const selector = `.event-card[data-event-slug="${CSS && CSS.escape ? CSS.escape(eventParam) : eventParam}"]`;
                        const target = document.querySelector(selector);
                        if (target) {
                            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            target.classList.add('highlight');
                            setTimeout(() => target.classList.remove('highlight'), 2000);
                            logger.debug('EVENT', `Deep-linked event highlighted: ${eventParam}`);
                            // Maintain selection state based on URL
                            const dateParam = url.searchParams.get('date');
                            if (dateParam) {
                                this.selectedEventSlug = eventParam;
                                this.selectedEventDateISO = dateParam;
                            }
                        } else {
                            logger.debug('EVENT', `Deep-linked event not found in current render: ${eventParam}`);
                        }
                    }
                } catch (_) {}
                
                // Add share button event handlers
                this.setupShareButtons();
                
                // Add card click handlers for selection toggle and URL sync
                this.attachEventCardSelectionHandlers();
            } else {
                eventsList.innerHTML = '<div class="loading-message">No events found for this period. Try switching Week/Month or check back soon.</div>';
                logger.info('CALENDAR', 'No events to display for current period', {
                    view: this.currentView,
                    city: this.currentCity
                });
            }
        }
        
        // Update map (show for both week and month views)
        const mapSection = document.querySelector('.events-map-section');
        if (mapSection && !hideEvents) {
            mapSection.style.display = 'block';
            this.initializeMap(this.currentCityConfig, filteredEvents);
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
        const eventItems = document.querySelectorAll('.event-item');
        
        eventItems.forEach(item => {
            item.addEventListener('click', (e) => {
                const eventSlug = item.dataset.eventSlug;
                // Determine the date for this event from the closest day element
                const dayEl = item.closest('[data-date]');
                const dayISO = dayEl ? dayEl.getAttribute('data-date') : this.formatDateToISO(this.currentDate);
                logger.userInteraction('EVENT', `Calendar event clicked: ${eventSlug}`, {
                    eventSlug,
                    city: this.currentCity
                });
                
                // Toggle selection and sync URL
                this.toggleEventSelection(eventSlug, dayISO);
                
                const eventCard = document.querySelector(`.event-card[data-event-slug="${eventSlug}"]`);
                if (eventCard) {
                    eventCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    eventCard.classList.add('highlight');
                    setTimeout(() => eventCard.classList.remove('highlight'), 2000);
                    logger.debug('EVENT', `Scrolled to event card: ${eventSlug}`);
                } else {
                    logger.warn('EVENT', `Event card not found for: ${eventSlug}`);
                }
            });
        });
        
        logger.debug('CALENDAR', `Attached interactions to ${eventItems.length} calendar items`);
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
                // Visual feedback
                card.classList.add('highlight');
                setTimeout(() => card.classList.remove('highlight'), 2000);
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
        
        // Update header for current city
        if (window.chunkyApp) {
            window.chunkyApp.updateHeaderForCity(this.currentCity);
        }
        
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
        const fakeEvent = {
            name: 'Sample Event Name For Width Measurement Testing',
            shortName: 'Sample Event', // Shorter than full name to trigger smart name logic
            bar: 'Sample Venue Name',
            time: '8:00 PM',
            day: 'Today',
            startDate: new Date(),
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
            
            if (!data || !data.events || !data.cityConfig) {
                logger.error('CALENDAR', '🔍 RENDER: Failed to load calendar data - showing error message', {
                    dataIsNull: data === null,
                    dataIsUndefined: data === undefined,
                    hasEvents: data && !!data.events,
                    hasCityConfig: data && !!data.cityConfig,
                    dataType: typeof data
                });
                // Clear fake event from allEvents to prevent it from showing
                this.allEvents = [];
                // Show error message instead of empty calendar
                this.showCalendarError();
                return;
            }
            
            // STEP 4: Display the real events with hideEvents: false
            logger.info('CALENDAR', '🔍 RENDER: Step 4: Displaying real events (hideEvents: false)', {
                eventCount: data.events.length,
                cachedWidth: this.cachedEventTextWidth,
                cachedCharsPerPixel: this.charsPerPixel?.toFixed(4)
            });
            
            this.updatePageContent(data.cityConfig, data.events, false); // hideEvents = false
            
            // Ensure URL reflects initial state after first render
            this.syncUrl(true);
            
        } catch (error) {
            logger.componentError('CALENDAR', '🔍 RENDER: Calendar loading failed with error', error);
            // Clear fake event from allEvents to prevent it from showing
            this.allEvents = [];
            // Show error message instead of empty calendar
            this.showCalendarError();
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
            eventCount: data.events.length,
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
                            // Handle test event addition if needed
                            logger.info('CALENDAR', 'Test event received from testing interface', event.data.data);
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
        
        const handleLayoutChange = (eventType = 'resize') => {
            const newWidth = window.innerWidth;
            const newBreakpoint = this.getCurrentBreakpoint();
            const breakpointChanged = newBreakpoint !== this.currentBreakpoint;
            const significantWidthChange = Math.abs(newWidth - this.lastScreenWidth) > 50; // 50px threshold
            
            logger.info('CALENDAR', `🔍 LAYOUT_CHANGE: Layout change detected via ${eventType}`, {
                eventType,
                oldWidth: this.lastScreenWidth,
                newWidth,
                widthChange: newWidth - this.lastScreenWidth,
                oldBreakpoint: this.currentBreakpoint,
                newBreakpoint,
                breakpointChanged,
                significantWidthChange,
                willClearCache: breakpointChanged || significantWidthChange
            });
            
            // Clear measurements on any significant resize, not just breakpoint changes
            if (breakpointChanged || significantWidthChange) {
                const oldBreakpoint = this.currentBreakpoint;
                const oldWidth = this.lastScreenWidth;
                
                this.clearMeasurementCache();
                this.clearEventNameCache();
                this.lastScreenWidth = newWidth;
                this.currentBreakpoint = newBreakpoint;
                
                logger.info('CALENDAR', `🔍 LAYOUT_CHANGE: Significant layout change detected via ${eventType}`, {
                    eventType,
                    oldBreakpoint,
                    newBreakpoint,
                    oldWidth,
                    newWidth,
                    widthChange: newWidth - oldWidth,
                    breakpointChanged,
                    significantWidthChange,
                    cacheCleared: true
                });
                
                // Debounce the calendar re-render to avoid excessive updates
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    logger.info('CALENDAR', `🔍 LAYOUT_CHANGE: Updating calendar display after ${eventType}`);
                    this.updateCalendarDisplay();
                    logger.info('CALENDAR', `🔍 LAYOUT_CHANGE: Calendar display updated after ${eventType}`);
                }, 150); // 150ms debounce
            } else {
                logger.debug('CALENDAR', `🔍 LAYOUT_CHANGE: Layout change not significant enough to clear cache`, {
                    eventType,
                    widthChange: newWidth - this.lastScreenWidth,
                    threshold: 50
                });
            }
        };
        
        // Listen to window resize events
        window.addEventListener('resize', () => handleLayoutChange('resize'));
        
        // Listen to orientation changes (important for mobile/tablet)
        window.addEventListener('orientationchange', () => handleLayoutChange('orientationchange'));
        
        // Listen for visual viewport changes (crucial for iPad split screen)
        if (window.visualViewport) {
            // Use a separate timeout for visual viewport to handle rapid changes during split screen transitions
            let visualViewportTimeout;
            window.visualViewport.addEventListener('resize', () => {
                clearTimeout(visualViewportTimeout);
                visualViewportTimeout = setTimeout(() => {
                    handleLayoutChange('visualViewport.resize');
                }, 100); // Slightly shorter debounce for visual viewport to be more responsive
            });
            // Note: We don't listen to visualViewport scroll as that's just scrolling, not layout change
        }
        
        logger.debug('CALENDAR', 'Layout change listeners set up for comprehensive detection', {
            events: ['resize', 'orientationchange', 'visualViewport.resize'],
            hasVisualViewport: !!window.visualViewport
        });
    }
    

    
    // Add test event (for testing functionality)
    addTestEvent(testEventData) {
        logger.info('CALENDAR', 'Test event added from test interface', testEventData);
        
        if (!this.allEvents) {
            this.allEvents = [];
        }
        
        // Create a test event object that matches our event structure
        const testEvent = {
            name: testEventData.name,
            shortName: testEventData.shortName,
            bar: testEventData.venue,
            time: testEventData.time,
            day: 'Today',
            startDate: new Date(),
            slug: 'test-event-' + Date.now(),
            recurring: false,
            coordinates: null,
            cover: 'Test Event',
            tea: 'This is a test event for character limit testing',
            image: testEventData.image || null,
            links: []
        };
        
        // Remove any existing test events
        this.allEvents = this.allEvents.filter(event => !event.slug.startsWith('test-event-'));
        
        // Add the new test event
        this.allEvents.unshift(testEvent);
        
        // Refresh the display
        this.updateCalendarDisplay();
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
            // Add timeout to prevent hanging initialization - 15s to account for delays + timeouts (0 + 1s + 3s delays + 1s + 3s + 5s timeouts + overhead)
            const initPromise = this.renderCityPage();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Calendar initialization timeout after 15 seconds')), 15000);
            });
            
            await Promise.race([initPromise, timeoutPromise]);
            this.isInitialized = true;
            logger.componentLoad('CALENDAR', 'Dynamic CalendarLoader initialization completed successfully');
        } catch (error) {
            logger.componentError('CALENDAR', 'Calendar initialization failed', error);
            throw error;
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

// Map control functions
function fitAllMarkers() {
    if (window.eventsMap && window.eventsMapMarkers && window.eventsMapMarkers.length > 0) {
        const group = new L.featureGroup(window.eventsMapMarkers);
        const isMobile = window.innerWidth <= 768;
        window.eventsMap.fitBounds(group.getBounds(), {
            padding: [20, 20],
            maxZoom: isMobile ? 11 : 12 // Reduced mobile zoom to 11, desktop stays at 12
        });
        logger.userInteraction('MAP', 'Fit all markers clicked', { markerCount: window.eventsMapMarkers.length });
    }
}



function showMyLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                
                if (window.eventsMap) {
                    // Remove existing location circle
                    if (window.myLocationCircle) {
                        window.eventsMap.removeLayer(window.myLocationCircle);
                    }
                    
                    // Add location circle instead of marker
                    window.myLocationCircle = L.circle([lat, lng], {
                        color: '#4285f4',
                        fillColor: '#4285f4',
                        fillOpacity: 0.2,
                        radius: 500,
                        weight: 3
                    }).addTo(window.eventsMap).bindPopup('📍 Your Location');
                    
                    // Calculate bounds that include both user location and all event markers
                    const bounds = L.latLngBounds([[lat, lng]]);
                    
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
                        window.eventsMap.setView([lat, lng], 14);
                    }
                    
                    logger.userInteraction('MAP', 'My location shown with events visible', { lat, lng });
                }
            },
            (error) => {
                console.warn('Location access denied or unavailable:', error);
                alert('Location access denied or unavailable. Please enable location services to use this feature.');
            }
        );
    } else {
        alert('Geolocation is not supported by this browser.');
    }
}

// Export class for use in app.js - no auto-initialization
if (typeof window !== 'undefined') {
    window.DynamicCalendarLoader = DynamicCalendarLoader;
}