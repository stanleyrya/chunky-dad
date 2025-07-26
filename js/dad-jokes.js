// Dad Jokes Module - Handles bear-themed dad joke functionality with typewriter animation
class DadJokesManager {
    constructor() {
        this.currentJokeIndex = 0;
        this.jokeBubble = null;
        this.setupElement = null;
        this.punchlineElement = null;
        this.isTyping = false;
        
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
                setup: "What do you call a bear who loves to travel?",
                punchline: "A roam-ing bear!"
            },
            {
                setup: "Why did the bear go to therapy?",
                punchline: "He had too many bear-ied emotions!"
            },
            {
                setup: "What's a bear's favorite drink at the bar?",
                punchline: "Bear-itas!"
            },
            {
                setup: "Why don't bears ever lie?",
                punchline: "Because the truth is un-bear-able to hide!"
            },
            {
                setup: "What do you call a bear who's great at parties?",
                punchline: "The life of the bear-ty!"
            },
            {
                setup: "Why did the bear become a tour guide?",
                punchline: "He wanted to show everyone the bear minimum of fun!"
            },
            {
                setup: "What's a bear's favorite app?",
                punchline: "Grindr... I mean, Bear-der!"
            }
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
        
        if (!this.setupElement || !this.punchlineElement) {
            logger.componentError('PAGE', 'Joke elements not found', { setupElement: !!this.setupElement, punchlineElement: !!this.punchlineElement });
            return;
        }

        this.setupEventListeners();
        this.initializeWithRandomJoke();
        
        logger.componentLoad('PAGE', 'Dad jokes manager initialized', { totalJokes: this.bearJokes.length });
    }

    setupEventListeners() {
        // Button click handler
        const newJokeBtn = this.jokeBubble.querySelector('.new-joke-btn');
        if (newJokeBtn) {
            newJokeBtn.addEventListener('click', () => {
                logger.userInteraction('PAGE', 'New joke button clicked');
                this.newJoke();
            });
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

    initializeWithRandomJoke() {
        this.currentJokeIndex = Math.floor(Math.random() * this.bearJokes.length);
        logger.debug('PAGE', 'Initializing with random joke', { jokeIndex: this.currentJokeIndex });
        this.displayJokeInstantly();
    }

    displayJokeInstantly() {
        const joke = this.bearJokes[this.currentJokeIndex];
        this.setupElement.textContent = joke.setup;
        this.punchlineElement.textContent = joke.punchline;
        logger.debug('PAGE', 'Initial joke displayed', { setup: joke.setup });
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

    async newJoke() {
        if (this.isTyping) {
            logger.debug('PAGE', 'Joke request ignored - already typing');
            return;
        }

        this.isTyping = true;
        this.currentJokeIndex = (this.currentJokeIndex + 1) % this.bearJokes.length;
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
    if (window.dadJokesManager) {
        window.dadJokesManager.newJoke();
    } else {
        logger.warn('PAGE', 'Dad jokes manager not available');
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DadJokesManager;
}

// Make DadJokesManager globally available
window.DadJokesManager = DadJokesManager;