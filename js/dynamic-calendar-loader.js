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
        const urlParams = new URLSearchParams(window.location.search);
        const cityParam = urlParams.get('city');
        
        // If no city parameter, try to get from hash or default to new-york
        if (!cityParam) {
            const hash = window.location.hash.replace('#', '');
            return hash || 'new-york';
        }
        
        return cityParam;
    }

    // Set up city selector and populate with available cities
    setupCitySelector() {
        const availableCitiesList = document.getElementById('available-cities-list');
        


        // Populate available cities list for error page
        if (availableCitiesList) {
            availableCitiesList.innerHTML = getAvailableCities()
                .filter(city => hasCityCalendar(city.key))
                .map(city => `
                    <a href="city.html?city=${city.key}" class="city-link">
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
    generateShortName(barName, eventName) {
        // Prefer event name if available, otherwise use bar name
        const sourceName = eventName || barName;
        if (!sourceName) return '';
        
        // Remove common words while preserving original casing
        // Let the per-line logic handle all length trimming to avoid double-trimming
        const stopWords = ['the', 'and', 'or', 'at', 'in', 'on', 'with', 'for', 'of', 'to', 'a', 'an'];
        const words = sourceName.split(' ');
        const filteredWords = words.filter(word => !stopWords.includes(word.toLowerCase()));
        
        // If we filtered out all words (e.g., "The"), use the original
        if (filteredWords.length === 0) {
            return sourceName;
        }
        
        // Return the filtered name without aggressive length trimming
        // The getSmartEventNameForBreakpoint() function will handle per-screen trimming
        return filteredWords.join(' ');
    }



    getSmartEventNameForBreakpoint(event, breakpoint) {
        // Get the nickname/shortname
        const shortName = event.shortName || event.nickname || '';
        const fullName = event.name || '';
        
        // If no shortname, return the full name
        if (!shortName) return fullName;
        
        // Get characters per pixel ratio (calculated once and cached)
        const charsPerPixel = this.charsPerPixel || this.calculateCharsPerPixel();
        
        // Get actual available width for event text
        const availableWidth = this.getEventTextWidth();
        
        // If measurement not ready yet, prefer shortName over fullName for real rendering
        // Only use fullName as fallback during measurement mode (when we need consistent sizing)
        if (availableWidth === null) {
            logger.debug('CALENDAR', `Measurement not ready for ${breakpoint}, using short name instead of full name`, {
                shortName: shortName,
                fullName: fullName
            });
            return shortName;
        }
        
        // Calculate how many characters can fit on one line
        const charLimitPerLine = Math.floor(availableWidth * charsPerPixel);
        
        logger.debug('CALENDAR', `Dynamic char calculation for ${breakpoint}`, {
            availableWidth: availableWidth.toFixed(2),
            charsPerPixel: charsPerPixel.toFixed(4),
            charLimitPerLine,
            eventName: shortName,
            shortNameLength: shortName.length,
            screenWidth: window.innerWidth
        });
        
        // Process the shortname - remove hyphens except escaped ones (\-)
        const processedShortName = shortName.replace(/(?<!\\)-/g, '');
        
        // Split the name into words
        const words = processedShortName.split(' ').filter(word => word.length > 0);
        
        // If the entire name fits on one line, return it
        if (processedShortName.length <= charLimitPerLine) {
            logger.debug('CALENDAR', `Event name fits without hyphens: "${processedShortName}" (${processedShortName.length} <= ${charLimitPerLine})`);
            return processedShortName;
        }
        
        // Try to fit the original hyphenated name on one line
        if (shortName.length <= charLimitPerLine) {
            logger.debug('CALENDAR', `Event name fits with hyphens: "${shortName}" (${shortName.length} <= ${charLimitPerLine})`);
            return shortName;
        }
        
        logger.debug('CALENDAR', `Event name too long, needs truncation/hyphenation: "${shortName}" (${shortName.length} > ${charLimitPerLine})`);
        
        // For very small character limits (4 or less), try to use shorterName if available
        if (charLimitPerLine <= 4 && event.shorterName?.trim() && event.shorterName.trim().length <= charLimitPerLine) {
            logger.debug('CALENDAR', `Using shorterName for ${charLimitPerLine} char limit: "${event.shorterName}"`);
            return event.shorterName.trim();
        }
        
        // Build lines that respect the character limit per line
        const lines = [];
        let currentLine = '';
        
        for (const word of words) {
            // If adding this word would exceed the limit
            if (currentLine && (currentLine + ' ' + word).length > charLimitPerLine) {
                // If the current line has content, save it and start a new line
                if (currentLine) {
                    lines.push(currentLine);
                    currentLine = '';
                }
            }
            
            // Check if the word itself is too long for a line
            if (word.length > charLimitPerLine) {
                // First try to split at hyphens in the original word (before hyphen removal)
                const originalWord = shortName.split(' ').find(orig => orig.replace(/(?<!\\)-/g, '') === word);
                if (originalWord && originalWord.includes('-') && !originalWord.includes('\\-')) {
                    const hyphenParts = originalWord.split('-').filter(part => part.length > 0);
                    let tempLine = currentLine;
                    
                    for (let i = 0; i < hyphenParts.length; i++) {
                        const part = hyphenParts[i];
                        const isLastPart = i === hyphenParts.length - 1;
                        const partWithHyphen = isLastPart ? part : part + '-';
                        
                        if (tempLine && (tempLine + ' ' + partWithHyphen).length > charLimitPerLine) {
                            lines.push(tempLine);
                            tempLine = partWithHyphen;
                        } else {
                            tempLine = tempLine ? tempLine + ' ' + partWithHyphen : partWithHyphen;
                        }
                        
                        // If even a single hyphen part is too long, truncate it
                        if (partWithHyphen.length > charLimitPerLine) {
                            if (tempLine === partWithHyphen) {
                                lines.push(partWithHyphen.substring(0, charLimitPerLine - 1) + '…');
                                tempLine = '';
                            }
                            break;
                        }
                    }
                    currentLine = tempLine;
                } else {
                    // If no hyphens to split on, truncate the word
                    const truncatedWord = word.substring(0, charLimitPerLine - 1) + '…';
                    if (currentLine) {
                        lines.push(currentLine);
                        lines.push(truncatedWord);
                        currentLine = '';
                    } else {
                        lines.push(truncatedWord);
                    }
                }
            } else {
                // Add the word to the current line
                currentLine = currentLine ? currentLine + ' ' + word : word;
            }
        }
        
        // Add the last line if it has content
        if (currentLine) {
            lines.push(currentLine);
        }
        
        // Join lines with line breaks (HTML will handle the display)
        // Limit to 3 lines maximum for all breakpoints
        const maxLines = 3;
        const displayLines = lines.slice(0, maxLines);
        
        // If we had to cut lines, add ellipsis to the last line
        if (lines.length > maxLines && displayLines.length > 0) {
            const lastLine = displayLines[displayLines.length - 1];
            if (lastLine.length >= charLimitPerLine - 1) {
                // Truncate the last line to make room for ellipsis
                displayLines[displayLines.length - 1] = lastLine.substring(0, charLimitPerLine - 1) + '…';
            } else {
                displayLines[displayLines.length - 1] = lastLine + '…';
            }
        }
        
        // Return the multi-line name as a single string (CSS will handle wrapping)
        return displayLines.join(' ');
    }

    // Calculate characters per pixel based on actual font metrics
    calculateCharsPerPixel() {
        try {
            // Create a temporary element to measure character width
            const testElement = document.createElement('div');
            testElement.style.cssText = `
                position: absolute;
                visibility: hidden;
                white-space: nowrap;
                font-family: 'Poppins', sans-serif;
                font-size: var(--event-name-font-size);
                font-weight: var(--event-name-font-weight);
                line-height: var(--event-name-line-height);
            `;
            
            // Use a representative string of average characters
            testElement.textContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789- ';
            document.body.appendChild(testElement);
            
            const width = testElement.getBoundingClientRect().width;
            const charCount = testElement.textContent.length;
            const pixelsPerChar = width / charCount;
            let charsPerPixel = 1 / pixelsPerChar;
            
            // Get the computed styles to verify what we're actually using
            const computedStyles = window.getComputedStyle(testElement);
            const actualFontSize = computedStyles.fontSize;
            const actualFontWeight = computedStyles.fontWeight;
            const actualFontFamily = computedStyles.fontFamily;
            
            // Simple zoom adjustment: use visual viewport scale for zoom detection
            const visualZoom = (window.visualViewport && window.visualViewport.scale) || 1;
            
            // When zoomed IN (visualZoom > 1), text appears larger, so FEWER characters fit
            // When zoomed OUT (visualZoom < 1), text appears smaller, so MORE characters fit
            // Therefore, we DIVIDE by zoom level, not multiply
            charsPerPixel = charsPerPixel / visualZoom;
            
            document.body.removeChild(testElement);
            
            logger.info('CALENDAR', `Calculated chars per pixel: ${charsPerPixel.toFixed(4)} (${pixelsPerChar.toFixed(2)}px per char, zoom: ${visualZoom.toFixed(2)})`, {
                width: width.toFixed(2),
                charCount,
                pixelsPerChar: pixelsPerChar.toFixed(2),
                charsPerPixel: charsPerPixel.toFixed(4),
                visualZoom: visualZoom.toFixed(2),
                zoomDirection: visualZoom > 1 ? 'zoomed in' : visualZoom < 1 ? 'zoomed out' : 'normal',
                actualFontSize,
                actualFontWeight,
                actualFontFamily,
                screenWidth: window.innerWidth
            });
            
            // Cache the result
            this.charsPerPixel = charsPerPixel;
            return charsPerPixel;
        } catch (error) {
            logger.componentError('CALENDAR', 'Could not calculate chars per pixel', error);
            throw error; // Don't use fallbacks, fail properly
        }
    }

    // Get the actual width available for event text from the fake event rendered invisibly
    getEventTextWidth() {
        // Check if we already have a cached measurement
        if (this.cachedEventTextWidth) {
            return this.cachedEventTextWidth;
        }
        
        // Find the fake event that was rendered invisibly for measurement
        const eventName = document.querySelector('.event-name');
        
        // If the element doesn't exist yet, we can't measure - return null to indicate measurement not ready
        if (!eventName) {
            logger.debug('CALENDAR', 'Event name element not found for measurement - DOM not ready yet');
            return null;
        }
        
        // Measure the actual rendered event name width
        const eventNameRect = eventName.getBoundingClientRect();
        this.cachedEventTextWidth = eventNameRect.width;
        
        logger.info('CALENDAR', `Measured actual event text width from fake event: ${this.cachedEventTextWidth}px`);
        
        return this.cachedEventTextWidth;
    }

    // Clear cached measurements (call when layout changes)
    clearMeasurementCache() {
        this.cachedEventTextWidth = null;
        this.charsPerPixel = null;
        logger.debug('CALENDAR', 'Measurement cache cleared');
    }

    // Clear cached event names (call when screen size changes)
    clearEventNameCache() {
        this.cachedEventNames.clear();
        logger.debug('CALENDAR', 'Event name cache cleared');
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
        
        // If we're in measurement mode (hideEvents), always use full name to avoid measurement loops
        if (hideEvents) {
            logger.debug('CALENDAR', 'Measurement mode: using full name without caching', {
                eventName: fullName,
                hideEvents: true
            });
            return `<div class="event-name">${fullName}</div>`;
        }
        
        // If no shortname, just return the full name
        if (!hasShortName) {
            return `<div class="event-name">${fullName}</div>`;
        }
        
        // Create a cache key for this event + current breakpoint
        const eventKey = `${event.name || ''}-${event.shortName || ''}-${event.nickname || ''}-${this.currentBreakpoint}`;
        
        // Check if we have cached name for this event at current breakpoint
        if (this.cachedEventNames.has(eventKey)) {
            const cachedName = this.cachedEventNames.get(eventKey);
            logger.debug('CALENDAR', 'Using cached event name', { 
                eventKey, 
                breakpoint: this.currentBreakpoint, 
                cachedName: cachedName,
                hideEvents: false
            });
            return `<div class="event-name">${cachedName}</div>`;
        }
        
        // Calculate name for current breakpoint only
        logger.debug('CALENDAR', 'Calculating event name for current breakpoint', { 
            eventKey, 
            breakpoint: this.currentBreakpoint,
            hideEvents: false
        });
        const eventName = this.getSmartEventNameForBreakpoint(event, this.currentBreakpoint);
        
        // Cache the result for real rendering only (not measurement mode)
        this.cachedEventNames.set(eventKey, eventName);
        logger.debug('CALENDAR', 'Cached calculated event name', {
            eventKey,
            calculatedName: eventName,
            shortName: event.shortName || event.nickname || '',
            fullName: fullName
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
        
        this.updateCalendarDisplay();
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
            this.currentDate.setMonth(this.currentDate.getMonth() + delta);
        }
        
        // Only update display immediately if not part of a swipe animation
        if (skipAnimation) {
            this.updateCalendarDisplay();
        }
    }

    goToToday() {
        this.currentDate = new Date();
        this.updateCalendarDisplay();
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

    // Load calendar data for specific city (override to use CORS proxy)
    async loadCalendarData(cityKey) {
        const cityConfig = getCityConfig(cityKey);
        if (!cityConfig || !cityConfig.calendarId) {
            logger.componentError('CALENDAR', `No calendar configuration found for city: ${cityKey}`);
            return null;
        }
        
        logger.time('CALENDAR', `Loading ${cityConfig.name} calendar data`);
        logger.info('CALENDAR', `🌐 Step 3: Starting API call to load calendar data for ${cityConfig.name}`, {
            cityKey,
            calendarId: cityConfig.calendarId,
            step: 'Step 3: Loading real calendar data'
        });
        
        try {
            const icalUrl = `https://calendar.google.com/calendar/ical/${cityConfig.calendarId}/public/basic.ics`;
            const corsProxy = 'https://api.allorigins.win/raw?url=';
            const fullUrl = corsProxy + encodeURIComponent(icalUrl);
            
            const response = await fetch(fullUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const icalText = await response.text();
            logger.apiCall('CALENDAR', 'Successfully fetched iCal data', {
                dataLength: icalText.length,
                city: cityConfig.name,
                url: icalUrl
            });
            
            // Log sample of the fetched data for debugging
            if (icalText.length > 0) {
                logger.debug('CALENDAR', 'Raw iCal data sample', {
                    firstLine: icalText.split('\n')[0],
                    hasEvents: icalText.includes('BEGIN:VEVENT'),
                    eventCount: (icalText.match(/BEGIN:VEVENT/g) || []).length,
                    calendarName: icalText.match(/X-WR-CALNAME:(.+)/)?.[1]?.trim() || 'Unknown',
                    encoding: icalText.includes('BEGIN:VCALENDAR') ? 'Valid iCal' : 'Invalid format'
                });
            } else {
                logger.warn('CALENDAR', 'Empty iCal data received', {
                    city: cityConfig.name,
                    url: icalUrl
                });
            }
            
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
            logger.componentLoad('CALENDAR', `Successfully processed calendar data for ${cityConfig.name}`, {
                eventCount: events.length,
                cityKey,
                calendarTimezone: this.calendarTimezone,
                hasTimezoneData: !!this.timezoneData
            });
            return this.eventsData;
        } catch (error) {
            logger.componentError('CALENDAR', 'Error loading calendar data', error);
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
                <p><strong>Try:</strong> Refreshing the page in a few minutes, or check our social media for updates.</p>
            </div>
        `;
        
        // Only show error in the events container to avoid duplication
        const eventsContainer = document.querySelector('.events-list');
        if (eventsContainer) {
            eventsContainer.innerHTML = errorMessage;
        }

    }







    // Generate event card
    generateEventCard(event) {
        const linksHtml = event.links ? event.links.map(link => {
            // Add appropriate emoji based on link type
            let emoji = '🔗'; // default link emoji
            const label = link.label.toLowerCase();
            
            if (label.includes('facebook')) emoji = '📘';
            else if (label.includes('instagram')) emoji = '📷';
            else if (label.includes('twitter')) emoji = '🐦';
            else if (label.includes('website') || label.includes('site')) emoji = '🔗';
            else if (label.includes('tickets') || label.includes('ticket')) emoji = '🎫';
            else if (label.includes('rsvp')) emoji = '✅';
            else if (label.includes('more info')) emoji = 'ℹ️';
            
            return `<a href="${link.url}" target="_blank" rel="noopener" class="event-link">${link.label}</a>`;
        }).join(' ') : '';

        const teaHtml = event.tea ? `
            <div class="detail-row">
                <span class="label">Tea:</span>
                <span class="value">${event.tea}</span>
            </div>
        ` : '';

        const locationHtml = event.coordinates && event.coordinates.lat && event.coordinates.lng ? 
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

        // Only show cover if it exists and has meaningful content
        const coverHtml = event.cover && event.cover.trim() && event.cover.toLowerCase() !== 'free' && event.cover.toLowerCase() !== 'no cover' ? `
            <div class="detail-row">
                <span class="label">Cover:</span>
                <span class="value">${event.cover}</span>
            </div>
        ` : '';

        const recurringBadge = event.recurring ? 
            `<span class="recurring-badge">🔄 ${event.eventType}</span>` : '';
        
        const notCheckedBadge = event.notChecked ? 
            `<span class="not-checked-badge" title="This event has not been verified yet">⚠️ Unverified</span>` : '';

        // Format day/time more concisely (e.g., "Thu 5pm-9pm")
        const formatDayTime = (day, time) => {
            // For desktop, show full day name; for mobile, show abbreviated
            const isDesktop = window.innerWidth > 768;
            const displayDay = isDesktop ? day : (day.length > 3 ? day.substring(0, 3) : day);
            return `${displayDay} ${time}`;
        };

        return `
            <div class="event-card detailed" data-event-slug="${event.slug}" data-lat="${event.coordinates?.lat || ''}" data-lng="${event.coordinates?.lng || ''}">
                <div class="event-header">
                    <h3>${event.name}</h3>
                    <div class="event-meta">
                        <div class="event-day">${formatDayTime(event.day, event.time)}</div>
                        ${recurringBadge}
                        ${notCheckedBadge}
                    </div>
                </div>
                <div class="event-details">
                    ${locationHtml}
                    ${coverHtml}
                    ${teaHtml}
                    <div class="event-links">
                        ${linksHtml}
                    </div>
                </div>
            </div>
        `;
    }

    // Filter events by current period
    getFilteredEvents() {
        // Handle case where allEvents is not yet loaded
        if (!this.allEvents || !Array.isArray(this.allEvents)) {
            return [];
        }
        
        const { start, end } = this.getCurrentPeriodBounds();
        
        return this.allEvents.filter(event => {
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
            const customIcon = L.divIcon({
                className: 'custom-marker',
                html: `
                    <div class="marker-pin">
                        <div class="marker-icon"><img src="Rising_Star_Ryan_Head_Compressed.png" alt="chunky.dad" class="map-marker-icon"></div>
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
                                <h4>${event.name}</h4>
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
        
        logger.info('CALENDAR', `Updating calendar display (${hideEvents ? 'HIDDEN for measurement' : 'VISIBLE for display'})`, {
            view: this.currentView,
            eventCount: filteredEvents.length,
            city: this.currentCity,
            hideEvents,
            step: hideEvents ? 'Step 1: Creating structure' : 'Step 4: Showing real events'
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
                eventsList.innerHTML = filteredEvents.map(event => this.generateEventCard(event)).join('');
            } else {
                eventsList.innerHTML = '';
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
                    
                    this.updateCalendarDisplay();
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
                logger.userInteraction('EVENT', `Calendar event clicked: ${eventSlug}`, {
                    eventSlug,
                    city: this.currentCity
                });
                
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

    // Main render function
    async renderCityPage() {
        this.currentCity = this.getCityFromURL();
        this.currentCityConfig = getCityConfig(this.currentCity);
        
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
            shortName: 'Sample Event Name',
            bar: 'Sample Venue Name',
            time: '8:00 PM',
            day: 'Today',
            startDate: new Date(),
            slug: 'measurement-test',
            recurring: false
        };
        
        logger.debug('CALENDAR', 'Step 1: Creating calendar structure with fake event (hideEvents: true)');
        
        // Set the fake event as allEvents for measurement
        this.allEvents = [fakeEvent];
        
        // Show calendar structure with fake event but hidden for measurements
        this.updatePageContent(this.currentCityConfig, [fakeEvent], true); // hideEvents = true
        
        // STEP 2: Wait for DOM to be fully updated and then measure
        logger.debug('CALENDAR', 'Step 2: Waiting for DOM to be ready for measurement');
        
        // Use requestAnimationFrame to ensure DOM is rendered
        await new Promise(resolve => {
            requestAnimationFrame(() => {
                // Wait one more frame to be absolutely sure
                requestAnimationFrame(resolve);
            });
        });
        
        // Measure the fake event width - should work reliably now
        const measurementWidth = this.getEventTextWidth();
        
        if (measurementWidth === null) {
            logger.warn('CALENDAR', 'Failed to measure event text width - using fallback calculation');
            // Force calculate chars per pixel as fallback
            this.calculateCharsPerPixel();
        } else {
            logger.info('CALENDAR', `Successfully measured event text width: ${measurementWidth}px`);
        }
        
        // STEP 3: Load calendar data from the API
        logger.debug('CALENDAR', 'Step 3: Loading real calendar data');
        const data = await this.loadCalendarData(this.currentCity);
        
        if (!data) {
            logger.error('CALENDAR', 'Failed to load calendar data');
            return;
        }
        
        // STEP 4: Display the real events with hideEvents: false
        logger.debug('CALENDAR', 'Step 4: Displaying real events (hideEvents: false)');
        this.updatePageContent(data.cityConfig, data.events, false); // hideEvents = false
        
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
            
            // Clear measurements on any significant resize, not just breakpoint changes
            if (breakpointChanged || significantWidthChange) {
                const oldBreakpoint = this.currentBreakpoint;
                const oldWidth = this.lastScreenWidth;
                
                this.clearMeasurementCache();
                this.clearEventNameCache();
                this.lastScreenWidth = newWidth;
                this.currentBreakpoint = newBreakpoint;
                
                logger.debug('CALENDAR', `Significant layout change detected via ${eventType}`, {
                    eventType,
                    oldBreakpoint,
                    newBreakpoint,
                    oldWidth,
                    newWidth,
                    widthChange: newWidth - oldWidth,
                    breakpointChanged,
                    significantWidthChange
                });
                
                // Debounce the calendar re-render to avoid excessive updates
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    this.updateCalendarDisplay();
                    logger.debug('CALENDAR', `Calendar display updated after ${eventType}`);
                }, 150); // 150ms debounce
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
            await this.renderCityPage();
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