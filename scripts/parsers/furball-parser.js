// Furball parser for extracting events from Furball NYC schedule pages
// Parses the UPCOMING EVENTS rich text block from Wix pages

class FurballParser {
    constructor(config = {}) {
        this.config = {
            source: 'furball',
            ...config
        };

        this.venueCityOverrides = {
            rockbar: 'nyc'
        };
    }

    // Main parsing method
    parseEvents(htmlData, parserConfig = {}, cityConfig = null) {
        try {
            const { html } = htmlData;
            const events = [];
            let additionalLinks = [];

            if (!html) {
                console.warn('🐻‍❄️ Furball: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }

            const scheduleText = this.extractUpcomingScheduleText(html);
            if (!scheduleText) {
                console.warn('🐻‍❄️ Furball: No UPCOMING schedule block found');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }

            events.push(...this.parseScheduleEntries(scheduleText, htmlData.url));

            additionalLinks = this.extractTicketLinks(html);

            console.log(`🐻‍❄️ Furball: Found ${events.length} events, ${additionalLinks.length} additional links`);

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
    parseScheduleEntries(text, sourceUrl) {
        const events = [];
        const dateMatches = this.getDateMatches(text);

        if (dateMatches.length === 0) {
            return events;
        }

        for (let i = 0; i < dateMatches.length; i++) {
            const current = dateMatches[i];
            const next = dateMatches[i + 1];
            const entryText = text.slice(current.end, next ? next.index : text.length).trim();
            const event = this.parseScheduleEntry(current.value, entryText, sourceUrl);
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

    parseScheduleEntry(dateString, entryText, sourceUrl) {
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
                address: venue || '',
                url: sourceUrl,
                ticketUrl: '',
                source: this.config.source
            };

            const cityOverride = this.getVenueCityOverride(title, venue);
            if (cityOverride) {
                event.city = cityOverride;
            }

            return event;
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to parse schedule entry: ${error}`);
            return null;
        }
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

    getVenueCityOverride(title, venue) {
        const combined = `${title} ${venue}`.toLowerCase();
        for (const [key, city] of Object.entries(this.venueCityOverrides)) {
            if (combined.includes(key)) {
                return city;
            }
        }
        return '';
    }

    // Extract ticket links from HTML
    extractTicketLinks(html) {
        const links = [];
        try {
            const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
            let match;
            while ((match = linkRegex.exec(html)) !== null) {
                const href = match[1];
                const text = match[2].replace(/<[^>]+>/g, '').trim();
                if (this.isLikelyTicketLink(text, href)) {
                    links.push(href);
                }
            }
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to extract ticket links: ${error}`);
        }
        return links;
    }

    isLikelyTicketLink(text, href) {
        const ticketKeywords = ['ticket', 'buy', 'purchase', 'eventbrite', 'ticketweb', 'tickets', 'ticketleap'];
        const textLower = (text || '').toLowerCase();
        const hrefLower = (href || '').toLowerCase();

        return ticketKeywords.some(keyword =>
            textLower.includes(keyword) || hrefLower.includes(keyword)
        );
    }
}

module.exports = { FurballParser };
