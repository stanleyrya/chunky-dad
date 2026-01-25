// Dad Jokes Module - Handles bear-themed dad joke functionality with typewriter animation
class DadJokesManager {
    constructor() {
        this.currentJokeIndex = 0;
        this.jokeBubble = null;
        this.setupElement = null;
        this.punchlineElement = null;
        this.newJokeButton = null;
        this.isTyping = false;
        this.isIntroActive = true;

        this.introLines = [
            "Traveling? Staying local? Dad's got you covered either way.",
            "Find where the bears are... and the cubs, otters, and chasers too!",
            "Still looking for the bear 411?"
        ];
        this.introLine2 = "chunky.dad is your go-to guide for bear friendly events, bars, and more.";

        this.bearJokes = [
            {
                setup: "Why don't bears ever get lost?",
                punchline: "Because they always know where the bear necessities are!"
            },
            {
                setup: "What do you call a bear with no teeth?",
                punchline: "A gummy bear!"
            },
            {
                setup: "Why did the bear break up with his boyfriend?",
                punchline: "He couldn't bear the drama anymore!"
            },
            {
                setup: "What's a bear's favorite type of music?",
                punchline: "Bear-itone!"
            },
            {
                setup: "Why don't bears wear shoes?",
                punchline: "Because they have bear feet!"
            },
            {
                setup: "Why did the bear go to therapy?",
                punchline: "He had too many bear-ied emotions!"
            },
            {
                setup: "Why don't bears ever lie?",
                punchline: "Because the truth is un-bear-able to hide!"
            },
            {
                setup: "Why did the bear bring a ladder to the bar?",
                punchline: "He heard the drinks were on the house!"
            },
        ];
        
        this.init();
    }

    init() {
        logger.componentInit('PAGE', 'Dad jokes manager initializing');
        
        this.jokeBubble = document.getElementById('joke-bubble');
        if (!this.jokeBubble) {
            logger.debug('PAGE', 'Joke bubble not found - dad jokes disabled');
            return;
        }

        this.setupElement = this.jokeBubble.querySelector('.joke-text');
        this.punchlineElement = this.jokeBubble.querySelector('.joke-punchline');
        this.newJokeButton = this.jokeBubble.querySelector('.new-joke-btn');
        
        if (!this.setupElement || !this.punchlineElement) {
            logger.componentError('PAGE', 'Joke elements not found', { setupElement: !!this.setupElement, punchlineElement: !!this.punchlineElement });
            return;
        }

        if (!this.newJokeButton) {
            logger.warn('PAGE', 'New joke button not found');
        } else {
            this.updateButtonLabel();
            this.setButtonVisibility(false);
        }

        this.setupEventListeners();
        this.initializeWithIntro();
        
        logger.componentLoad('PAGE', 'Dad jokes manager initialized', { 
            totalJokes: this.bearJokes.length,
            introOptions: this.introLines.length
        });
    }

    setupEventListeners() {
        // Button click handler
        if (this.newJokeButton) {
            this.newJokeButton.addEventListener('click', (e) => {
                e.preventDefault();
                logger.userInteraction('PAGE', 'New joke button clicked');
                this.newJoke();
            });
        } else {
            logger.warn('PAGE', 'New joke button not found');
        }

        // Keyboard shortcut (J key)
        document.addEventListener('keydown', (e) => {
            if ((e.key === 'j' || e.key === 'J') && !this.isTyping) {
                logger.userInteraction('PAGE', 'Keyboard shortcut used for new joke', { key: e.key });
                this.newJoke();
            }
        });

        logger.componentLoad('PAGE', 'Dad jokes event listeners setup');
    }

    initializeWithIntro() {
        this.isIntroActive = true;
        logger.debug('PAGE', 'Initializing with intro message');
        this.applyIntroStyles(true);

        const introLine = this.introLines[Math.floor(Math.random() * this.introLines.length)];
        this.setupElement.textContent = introLine;
        this.punchlineElement.textContent = this.introLine2;
        this.setupElement.classList.remove('typewriter');
        this.punchlineElement.classList.remove('typewriter');
        this.updateButtonLabel();
        this.setButtonVisibility(true);
    }

    applyIntroStyles(isIntro) {
        if (!this.jokeBubble) {
            return;
        }

        this.jokeBubble.classList.toggle('is-intro', isIntro);
    }

    typeText(element, text, speed = 50) {
        return new Promise((resolve) => {
            element.textContent = '';
            element.classList.add('typewriter');
            let i = 0;
            
            const typeInterval = setInterval(() => {
                element.textContent += text.charAt(i);
                i++;
                
                if (i >= text.length) {
                    clearInterval(typeInterval);
                    // Remove typewriter cursor after a brief pause
                    setTimeout(() => {
                        element.classList.remove('typewriter');
                        resolve();
                    }, 500);
                }
            }, speed);
        });
    }

    updateButtonLabel() {
        if (!this.newJokeButton) {
            return;
        }

        const label = this.isIntroActive ? 'Tell a dad joke 🐻' : 'New Joke 🐻';
        this.newJokeButton.textContent = label;
    }

    setButtonVisibility(isVisible) {
        if (!this.newJokeButton) {
            return;
        }

        this.newJokeButton.classList.toggle('is-hidden', !isVisible);
        this.newJokeButton.setAttribute('aria-hidden', String(!isVisible));
        this.newJokeButton.tabIndex = isVisible ? 0 : -1;
    }

    async newJoke() {
        if (this.isTyping) {
            logger.debug('PAGE', 'Joke request ignored - already typing');
            return;
        }

        this.isTyping = true;
        let nextJokeIndex = this.currentJokeIndex;
        if (this.isIntroActive) {
            this.isIntroActive = false;
            this.applyIntroStyles(false);
            nextJokeIndex = Math.floor(Math.random() * this.bearJokes.length);
            this.updateButtonLabel();
            logger.debug('PAGE', 'Replacing intro with first joke', { jokeIndex: nextJokeIndex });
        } else {
            nextJokeIndex = (this.currentJokeIndex + 1) % this.bearJokes.length;
        }

        this.currentJokeIndex = nextJokeIndex;
        const joke = this.bearJokes[this.currentJokeIndex];
        const jokeContent = this.jokeBubble.querySelector('.joke-content');
        
        logger.debug('PAGE', 'Starting new joke animation', { 
            jokeIndex: this.currentJokeIndex, 
            setup: joke.setup 
        });

        try {
            // Fade out
            jokeContent.style.opacity = '0';
            
            await new Promise(resolve => setTimeout(resolve, 200));

            // Clear content
            this.setupElement.textContent = '';
            this.punchlineElement.textContent = '';
            
            // Fade in
            jokeContent.style.opacity = '1';
            
            // Type the setup first
            logger.debug('PAGE', 'Typing joke setup');
            await this.typeText(this.setupElement, joke.setup, 30);
            
            // Wait a moment for comedic timing
            await new Promise(resolve => setTimeout(resolve, 800));
            
            // Type the punchline
            logger.debug('PAGE', 'Typing joke punchline');
            await this.typeText(this.punchlineElement, joke.punchline, 40);
            
            logger.componentLoad('PAGE', 'Joke animation completed', { jokeIndex: this.currentJokeIndex });
            
        } catch (error) {
            logger.componentError('PAGE', 'Error during joke animation', error);
        } finally {
            this.isTyping = false;
        }
    }
}

// Global function for backwards compatibility and external calls
function newJoke() {
    try {
        if (window.dadJokesManager && typeof window.dadJokesManager.newJoke === 'function') {
            window.dadJokesManager.newJoke();
        } else {
            logger.warn('PAGE', 'Dad jokes manager not available or newJoke method missing');
        }
    } catch (error) {
        logger.componentError('PAGE', 'Error calling newJoke function', error);
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DadJokesManager;
}

// Make DadJokesManager globally available
window.DadJokesManager = DadJokesManager;