// Furball parser for extracting events from Furball homepage schedule
// Parses the UPCOMING EVENTS rich text block from the Wix homepage

class FurballParser {
    constructor(config = {}) {
        this.config = {
            source: 'furball',
            ...config
        };

    }

    // Main parsing method
    parseEvents(htmlData, parserConfig = {}, cityConfig = null) {
        try {
            const { html } = htmlData;
            let scheduleEvents = [];
            let additionalLinks = [];

            if (!html) {
                console.warn('🐻‍❄️ Furball: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }

            const scheduleText = this.extractUpcomingScheduleText(html);
            if (!scheduleText) {
                console.warn('🐻‍❄️ Furball: No UPCOMING schedule block found');
            } else {
                scheduleEvents = this.parseScheduleEntries(scheduleText, htmlData.url, parserConfig, cityConfig);
            }

            const events = scheduleEvents;
            additionalLinks = [];

            console.log(`🐻‍❄️ Furball: Found ${events.length} events`);

            return {
                events,
                additionalLinks,
                source: this.config.source,
                url: htmlData.url
            };
        } catch (error) {
            console.error(`🐻‍❄️ Furball: Error parsing events: ${error}`);
            return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
        }
    }

    // Find the UPCOMING schedule block and return cleaned text
    extractUpcomingScheduleText(html) {
        const blocks = this.extractRichTextBlocks(html);
        const candidates = [];

        for (const block of blocks) {
            const text = this.cleanRichText(block);
            if (!text) {
                continue;
            }

            if (this.containsEventDate(text) && /upcoming/i.test(text)) {
                candidates.push({ text, count: this.countDates(text) });
            }
        }

        if (candidates.length === 0) {
            return '';
        }

        candidates.sort((a, b) => b.count - a.count);
        return candidates[0].text;
    }

    // Extract rich text blocks from Wix HTML
    extractRichTextBlocks(html) {
        const blocks = [];
        try {
            const richTextRegex = /<div[^>]*class="[^"]*wixui-rich-text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
            let match;
            while ((match = richTextRegex.exec(html)) !== null) {
                blocks.push(match[1]);
            }
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to extract rich text blocks: ${error}`);
        }
        return blocks;
    }

    // Clean HTML into normalized text
    cleanRichText(html) {
        return html
            .replace(/<br[^>]*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Check for date patterns
    containsEventDate(text) {
        const dateRegex = this.getDateRegex();
        return dateRegex.test(text);
    }

    countDates(text) {
        const dateRegex = this.getDateRegex();
        const matches = text.match(dateRegex);
        return matches ? matches.length : 0;
    }

    getDateRegex() {
        return /\b(?:\d{1,2}\/\d{1,2}\/\d{4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s*\d{4})\b/gi;
    }

    // Parse schedule text into event objects
    parseScheduleEntries(text, sourceUrl, parserConfig = {}, cityConfig = null) {
        const events = [];
        const dateMatches = this.getDateMatches(text);

        if (dateMatches.length === 0) {
            return events;
        }

        for (let i = 0; i < dateMatches.length; i++) {
            const current = dateMatches[i];
            const next = dateMatches[i + 1];
            const entryText = text.slice(current.end, next ? next.index : text.length).trim();
            const event = this.parseScheduleEntry(current.value, entryText, sourceUrl, parserConfig, cityConfig);
            if (event) {
                events.push(event);
            }
        }

        return events;
    }

    getDateMatches(text) {
        const matches = [];
        const dateRegex = this.getDateRegex();
        let match;

        while ((match = dateRegex.exec(text)) !== null) {
            matches.push({
                value: match[0],
                index: match.index,
                end: dateRegex.lastIndex
            });
        }

        return matches;
    }

    parseScheduleEntry(dateString, entryText, sourceUrl, parserConfig = {}, cityConfig = null) {
        try {
            const startDate = this.parseDateString(dateString);
            if (!startDate) {
                return null;
            }

            let cleanedEntry = this.normalizeWhitespace(entryText);
            cleanedEntry = cleanedEntry.replace(/^[\-–—:]+/, '').trim();
            if (!cleanedEntry) {
                return null;
            }

            if (!/\b(FURBALL|UNDERBEAR)\b/i.test(cleanedEntry)) {
                return null;
            }

            let title = cleanedEntry;
            let venue = '';
            const separatorIndex = cleanedEntry.indexOf(' - ');
            if (separatorIndex !== -1) {
                title = cleanedEntry.slice(0, separatorIndex).trim();
                venue = cleanedEntry.slice(separatorIndex + 3).trim();
            }

            title = this.normalizeWhitespace(title);
            venue = this.normalizeWhitespace(venue);

            const startDateTime = new Date(startDate);
            startDateTime.setHours(22, 0, 0, 0);

            const endDateTime = new Date(startDate);
            endDateTime.setHours(2, 0, 0, 0);
            endDateTime.setDate(endDateTime.getDate() + 1);

            const event = {
                title,
                startDate: startDateTime,
                endDate: endDateTime,
                bar: venue || '',
                address: '',
                url: sourceUrl,
                ticketUrl: '',
                source: this.config.source
            };

            const detectedCity = this.detectCityFromText(`${title} ${venue}`, cityConfig);
            const defaultCity = this.getDefaultCity(parserConfig, cityConfig);
            if (detectedCity) {
                event.city = detectedCity;
            } else if (defaultCity) {
                event.city = defaultCity;
            }

            return event;
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to parse schedule entry: ${error}`);
            return null;
        }
    }

    detectCityFromText(text, cityConfig) {
        if (!text || !cityConfig) {
            return '';
        }

        const lowerText = String(text).toLowerCase();
        for (const [cityKey, config] of Object.entries(cityConfig)) {
            const patterns = Array.isArray(config.patterns) ? config.patterns : [];
            for (const pattern of patterns) {
                const escapedPattern = this.escapeRegex(pattern).replace(/\s+/g, '\\s+');
                const regex = new RegExp(`\\b${escapedPattern}\\b`, 'i');
                if (regex.test(lowerText)) {
                    return cityKey;
                }
            }
        }

        return '';
    }

    getDefaultCity(parserConfig, cityConfig) {
        const configuredCity = String(parserConfig.defaultCity || '').toLowerCase().trim();
        if (!configuredCity) {
            return '';
        }
        if (cityConfig && cityConfig[configuredCity]) {
            return configuredCity;
        }
        return '';
    }

    escapeRegex(text) {
        return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    parseDateString(dateString) {
        if (!dateString) return null;
        const numericMatch = dateString.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (numericMatch) {
            const month = Number(numericMatch[1]);
            const day = Number(numericMatch[2]);
            const year = Number(numericMatch[3]);
            const date = new Date(year, month - 1, day);
            return isNaN(date.getTime()) ? null : date;
        }

        const parsed = new Date(dateString);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    normalizeWhitespace(text) {
        return (text || '').replace(/\s+/g, ' ').trim();
    }

}

module.exports = { FurballParser };
