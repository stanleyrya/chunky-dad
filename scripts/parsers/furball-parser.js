// Furball parser for extracting events from Furball NYC ticket information page
// Generic parser that works with any FURBALL events using HTML structure

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
            const events = [];
            const additionalLinks = [];

            if (!html) {
                console.warn('🐻‍❄️ Furball: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }

            // Extract event blocks from the HTML using component structure
            const eventBlocks = this.extractEventBlocks(html);
            for (const block of eventBlocks) {
                const event = this.parseEventBlock(block, htmlData.url);
                if (event) {
                    // Enforce endDate since system does not support missing end dates
                    if (!event.endDate && event.startDate) {
                        event.endDate = new Date(event.startDate);
                    }
                    events.push(event);
                }

                // Collect ticket links from the block
                const links = this.extractTicketLinks(block.textContent);
                for (const link of links) {
                    if (!additionalLinks.includes(link)) {
                        additionalLinks.push(link);
                    }
                }
            }

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

    // Extract event sections from HTML - look for sections containing date patterns
    extractEventSections(html) {
        const sections = [];
        try {
            // Look for any sections containing event data (date patterns)
            const sectionRegex = /<section[^>]*>([\s\S]*?)<\/section>/gi;
            let match;
            while ((match = sectionRegex.exec(html)) !== null) {
                const sectionContent = match[1];
                if (this.containsEventDate(sectionContent)) {
                    sections.push(sectionContent);
                }
            }
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to extract event sections: ${error}`);
        }
        return sections;
    }

    // Extract individual event blocks using HTML component structure
    extractEventBlocks(content) {
        const events = [];
        try {
            // Look for rich text components that contain event data
            // Pattern: <div id="comp-XXXXX" class="...wixui-rich-text"...>...DATE...FURBALL...VENUE...</div>
            const richTextRegex = /<div[^>]*class="[^"]*wixui-rich-text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
            let match;
            
            while ((match = richTextRegex.exec(content)) !== null) {
                const richTextContent = match[1];
                // Check if this rich text contains a date and FURBALL
                if (this.containsEventDate(richTextContent) && richTextContent.includes('FURBALL')) {
                    // Find the closest image component in the same section
                    const imageComponent = this.findImageComponentsInSection(content, match.index);
                    
                    // Create event block with both text and image data
                    const eventBlock = {
                        textContent: richTextContent,
                        imageComponent: imageComponent
                    };
                    events.push(eventBlock);
                }
            }
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to extract event blocks: ${error}`);
        }
        return events;
    }

    // Find all image components in the same section as the rich text
    findImageComponentsInSection(content, richTextIndex) {
        try {
            // Look for all image components in the content
            const imageRegex = /<div[^>]*class="[^"]*wixui-image[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
            let match;
            const imageComponents = [];
            
            while ((match = imageRegex.exec(content)) !== null) {
                imageComponents.push({
                    content: match[1],
                    index: match.index
                });
            }
            
            // Return the closest image component (before or after the rich text)
            if (imageComponents.length === 0) {
                return null;
            }
            
            // Find the closest image component to the rich text
            let closestImage = null;
            let closestDistance = Infinity;
            
            for (const image of imageComponents) {
                const distance = Math.abs(image.index - richTextIndex);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestImage = image.content;
                }
            }
            
            return closestImage;
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to find image components in section: ${error}`);
            return null;
        }
    }

    // Check if section content contains an event date
    containsEventDate(content) {
        const datePatterns = [
            /(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+\d{1,2},\s*\d{4}/i,
            /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{1,2},\s*\d{4}/i
        ];
        return datePatterns.some(pattern => pattern.test(content));
    }

    // Parse a single event block into an event object
    parseEventBlock(block, sourceUrl) {
        try {
            // Extract date from the text content
            const dateMatch = block.textContent.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}/i);
            if (!dateMatch) {
                return null;
            }
            const startDate = this.parseDate(dateMatch[0]);
            if (!startDate) {
                return null;
            }

            // Extract event title and venue from text content
            const textContent = this.extractTextContent(block.textContent);
            const lines = textContent.split('\n').map(s => s.trim()).filter(Boolean);
            
            // Find the event title and venue information
            let title = '';
            let bar = '';
            let address = '';
            
            // Process the text content to extract title, venue, and address
            // The text is usually in one line with format: "DATE FURBALL EVENT_NAME VENUE - LOCATION BUTTON_TEXT"
            const fullText = lines.join(' ');
            
            // Extract title and venue using a more precise approach
            // Look for the pattern: FURBALL [TITLE] [VENUE] - [LOCATION]
            // The venue is usually the last word before " - "
            const eventMatch = fullText.match(/FURBALL\s+([^-]+?)\s+([A-Z][a-zA-Z\s]+?)\s*-\s*([A-Z][^!]+)/i);
            if (eventMatch) {
                const rawTitle = eventMatch[1].trim();
                const rawVenue = eventMatch[2].trim();
                address = eventMatch[3].trim();
                
                // Extract venue (last word in the venue string)
                const venueWords = rawVenue.split(/\s+/);
                bar = venueWords[venueWords.length - 1]; // Last word is the venue name
                
                // Title is everything except the venue name
                title = rawTitle + ' ' + venueWords.slice(0, -1).join(' ');
                
                // Clean up title
                title = title.replace(/More Info Here!.*$/, '').trim();
                title = title.replace(/FOXY Tickets Here!.*$/, '').trim();
                title = title.replace(/Tickets Here!.*$/, '').trim();
                title = title.replace(/Buy Tickets.*$/, '').trim();
                title = title.replace(/Purchase.*$/, '').trim();
                title = title.replace(/&nbsp;/g, ' ').trim();
                
                // Clean up address
                address = address.replace(/More Info Here!.*$/, '').trim();
                address = address.replace(/FOXY Tickets Here!.*$/, '').trim();
                address = address.replace(/Tickets Here!.*$/, '').trim();
                address = address.replace(/Buy Tickets.*$/, '').trim();
                address = address.replace(/Purchase.*$/, '').trim();
            }

            // Extract images from the image component
            const images = this.extractImagesFromImageComponent(block.imageComponent);
            const image = images.length > 0 ? images[0].src : '';

            // Extract ticket URL
            const ticketUrl = this.extractTicketUrl(block.textContent);

            // FURBALL events always run 10 PM - 2 AM (next day)
            const startDateTime = new Date(startDate);
            startDateTime.setHours(22, 0, 0, 0); // 10 PM
            
            const endDateTime = new Date(startDate);
            endDateTime.setHours(2, 0, 0, 0); // 2 AM next day
            endDateTime.setDate(endDateTime.getDate() + 1); // Move to next day

            const event = {
                title,
                startDate: startDateTime,
                endDate: endDateTime,
                bar,
                address,
                url: sourceUrl,
                ticketUrl,
                source: this.config.source,
                image: image
            };

            return event;
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to parse event block: ${error}`);
            return null;
        }
    }

    // Extract text content from HTML, removing tags
    extractTextContent(html) {
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

    // Extract images from an image component
    extractImagesFromImageComponent(imageComponent) {
        const images = [];
        if (!imageComponent) {
            return images;
        }
        
        try {
            // Match img tags with src attributes
            const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi;
            let match;
            while ((match = imgRegex.exec(imageComponent)) !== null) {
                const src = match[1];
                const altMatch = match[0].match(/alt="([^"]*)"/i);
                const alt = altMatch ? altMatch[1] : '';
                
                // Filter out common non-content images (logos, icons, etc.)
                if (this.isContentImage(src, alt)) {
                    images.push({
                        src: src,
                        alt: alt,
                        type: this.getImageType(src, alt)
                    });
                }
            }
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to extract images from image component: ${error}`);
        }
        return images;
    }

    // Determine if an image is likely content (not just logos/icons)
    isContentImage(src, alt) {
        // Skip common non-content images
        const skipPatterns = [
            /logo/i,
            /icon/i,
            /favicon/i,
            /button/i,
            /arrow/i,
            /social/i,
            /facebook/i,
            /twitter/i,
            /instagram/i,
            /youtube/i,
            /linkedin/i,
            /pinterest/i,
            /mixcloud/i,
            /\.svg$/i,
            /placeholder/i,
            /loading/i,
            /spinner/i,
            /screen shot/i,
            /screenshot/i,
            /footer/i,
            /header/i,
            /nav/i,
            /menu/i
        ];
        
        const combinedText = `${src} ${alt}`.toLowerCase();
        
        // Also skip very small images (likely icons)
        const sizeMatch = src.match(/w_(\d+),h_(\d+)/);
        if (sizeMatch) {
            const width = parseInt(sizeMatch[1]);
            const height = parseInt(sizeMatch[2]);
            if (width < 100 || height < 100) {
                return false;
            }
        }
        
        return !skipPatterns.some(pattern => pattern.test(combinedText));
    }

    // Determine image type based on src and alt
    getImageType(src, alt) {
        const combinedText = `${src} ${alt}`.toLowerCase();
        
        if (combinedText.includes('poster') || combinedText.includes('flyer')) {
            return 'poster';
        } else if (combinedText.includes('photo') || combinedText.includes('image')) {
            return 'photo';
        } else if (combinedText.includes('banner') || combinedText.includes('header')) {
            return 'banner';
        } else {
            return 'image';
        }
    }

    // Extract ticket URL from section
    extractTicketUrl(section) {
        try {
            // Look for ticket links
            const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
            let match;
            while ((match = linkRegex.exec(section)) !== null) {
                const href = match[1];
                const text = match[2].replace(/<[^>]+>/g, '').trim();
                if (this.isLikelyTicketLink(text, href)) {
                    return href;
                }
            }
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to extract ticket URL: ${error}`);
        }
        return '';
    }

    // Check if a link is likely a ticket link
    isLikelyTicketLink(text, href) {
        const ticketKeywords = ['ticket', 'buy', 'purchase', 'eventbrite', 'ticketweb', 'tickets'];
        const textLower = text.toLowerCase();
        const hrefLower = href.toLowerCase();
        
        return ticketKeywords.some(keyword => 
            textLower.includes(keyword) || hrefLower.includes(keyword)
        );
    }

    // Extract ticket links from section
    extractTicketLinks(section) {
        const links = [];
        try {
            const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
            let match;
            while ((match = linkRegex.exec(section)) !== null) {
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

    // Parse date string into a Date object
    parseDate(dateString) {
        if (!dateString) return null;
        const date = new Date(dateString);
        return isNaN(date.getTime()) ? null : date;
    }
}

module.exports = { FurballParser };