// Calendar Controls Module - Handles calendar navigation and view management
class CalendarControls {
    constructor() {
        this.debugMode = true;
        this.currentView = 'week';
        this.currentDate = new Date();
        this.initialized = false;
    }

    log(message, data = null) {
        if (this.debugMode) {
            console.log(`[CalendarControls] ${message}`, data || '');
        }
    }

    error(message, data = null) {
        console.error(`[CalendarControls ERROR] ${message}`, data || '');
    }

    // Initialize calendar controls
    initialize() {
        if (this.initialized) return;

        this.setupViewToggle();
        this.setupNavigationButtons();
        this.setupTodayButton();
        this.setupCalendarInteractions();
        
        this.initialized = true;
        this.log('Calendar controls initialized');
    }

    // Setup view toggle buttons (week/month)
    setupViewToggle() {
        const viewButtons = document.querySelectorAll('.view-btn');
        
        viewButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const view = e.target.dataset.view;
                if (view && view !== this.currentView) {
                    this.switchView(view);
                }
            });
        });
    }

    // Setup navigation buttons (prev/next)
    setupNavigationButtons() {
        const prevButton = document.getElementById('prev-period');
        const nextButton = document.getElementById('next-period');

        if (prevButton) {
            prevButton.addEventListener('click', () => this.navigatePeriod('prev'));
        }

        if (nextButton) {
            nextButton.addEventListener('click', () => this.navigatePeriod('next'));
        }
    }

    // Setup today button
    setupTodayButton() {
        const todayButton = document.getElementById('today-btn');
        
        if (todayButton) {
            todayButton.addEventListener('click', () => this.goToToday());
        }
    }

    // Setup calendar day interactions
    setupCalendarInteractions() {
        // Use event delegation for calendar day clicks
        const calendarGrid = document.querySelector('.calendar-grid');
        
        if (calendarGrid) {
            calendarGrid.addEventListener('click', (e) => {
                const calendarDay = e.target.closest('.calendar-day');
                
                if (calendarDay && this.currentView === 'month') {
                    const dateString = calendarDay.dataset.date;
                    if (dateString) {
                        this.handleDayClick(dateString);
                    }
                }
            });
        }
    }

    // Switch between week and month views
    switchView(view) {
        if (view === this.currentView) return;

        this.currentView = view;
        
        // Update active button
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        const activeButton = document.querySelector(`.view-btn[data-view="${view}"]`);
        if (activeButton) {
            activeButton.classList.add('active');
        }

        // Trigger calendar update
        this.onViewChange();
        
        this.log(`Switched to ${view} view`);
    }

    // Navigate to previous or next period
    navigatePeriod(direction) {
        const delta = direction === 'next' ? 1 : -1;
        
        if (this.currentView === 'week') {
            this.currentDate.setDate(this.currentDate.getDate() + (delta * 7));
        } else {
            this.currentDate.setMonth(this.currentDate.getMonth() + delta);
        }
        
        this.onDateChange();
        
        this.log(`Navigated ${direction} to ${this.currentDate.toDateString()}`);
    }

    // Go to today
    goToToday() {
        this.currentDate = new Date();
        this.onDateChange();
        this.log('Navigated to today');
    }

    // Switch to week view for specific date
    switchToWeekView(dateString) {
        this.currentDate = new Date(dateString);
        this.switchView('week');
        
        // Remove any open modals
        document.querySelector('.day-events-modal')?.remove();
        
        this.log(`Switched to week view for ${dateString}`);
    }

    // Handle day click in month view
    handleDayClick(dateString) {
        const date = new Date(dateString);
        
        // Get events for this day
        if (window.calendarManager && window.calendarManager.getEventsForDay) {
            const dayEvents = window.calendarManager.getEventsForDay(dateString);
            
            if (dayEvents.length > 0) {
                // Show day events modal
                if (window.calendarUI) {
                    window.calendarUI.showDayEventsModal(dateString, dayEvents);
                }
            } else {
                // Switch to week view to show the day
                this.switchToWeekView(dateString);
            }
        }
        
        this.log(`Day clicked: ${dateString}`);
    }

    // Get current view
    getCurrentView() {
        return this.currentView;
    }

    // Get current date
    getCurrentDate() {
        return new Date(this.currentDate);
    }

    // Set current date
    setCurrentDate(date) {
        this.currentDate = new Date(date);
        this.onDateChange();
    }

    // Set current view
    setCurrentView(view) {
        this.switchView(view);
    }

    // Callback for view changes
    onViewChange() {
        // Trigger calendar update
        if (window.calendarManager && window.calendarManager.updateDisplay) {
            window.calendarManager.updateDisplay();
        }
    }

    // Callback for date changes
    onDateChange() {
        // Trigger calendar update
        if (window.calendarManager && window.calendarManager.updateDisplay) {
            window.calendarManager.updateDisplay();
        }
    }

    // Update calendar title based on current view and date
    updateCalendarTitle() {
        const titleElement = document.getElementById('calendar-title');
        if (!titleElement) return;

        let title = '';
        if (this.currentView === 'week') {
            title = 'This Week\'s Schedule';
        } else {
            title = 'Monthly Overview';
        }

        titleElement.textContent = title;
    }

    // Get period bounds for current view and date
    getCurrentPeriodBounds() {
        if (this.currentView === 'week') {
            return this.getWeekBounds(this.currentDate);
        } else {
            return this.getMonthBounds(this.currentDate);
        }
    }

    // Get week bounds for a given date
    getWeekBounds(date) {
        const start = new Date(date);
        const day = start.getDay();
        start.setDate(start.getDate() - day);
        start.setHours(0, 0, 0, 0);
        
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        
        return { start, end };
    }

    // Get month bounds for a given date
    getMonthBounds(date) {
        const start = new Date(date.getFullYear(), date.getMonth(), 1);
        start.setHours(0, 0, 0, 0);
        
        const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
        
        return { start, end };
    }

    // Format date range for display
    formatDateRange() {
        const bounds = this.getCurrentPeriodBounds();
        const options = { month: 'short', day: 'numeric' };
        
        if (this.currentView === 'week') {
            if (bounds.start.getMonth() === bounds.end.getMonth()) {
                return `${bounds.start.toLocaleDateString('en-US', { month: 'short' })} ${bounds.start.getDate()}-${bounds.end.getDate()}`;
            } else {
                return `${bounds.start.toLocaleDateString('en-US', options)} - ${bounds.end.toLocaleDateString('en-US', options)}`;
            }
        } else {
            return bounds.start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        }
    }

    // Update date range display
    updateDateRangeDisplay() {
        const dateRangeElement = document.getElementById('date-range');
        if (dateRangeElement) {
            dateRangeElement.textContent = this.formatDateRange();
        }
    }

    // Reset to defaults
    reset() {
        this.currentView = 'week';
        this.currentDate = new Date();
        this.updateCalendarTitle();
        this.updateDateRangeDisplay();
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.CalendarControls = CalendarControls;
}