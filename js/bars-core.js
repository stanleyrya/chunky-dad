// Bars Core Module - Handles bars data parsing, Google Sheets integration, and bar data management
class BarsCore {
    constructor() {
        this.barsData = null;
        this.allBars = [];
        this.currentCity = null;
        this.googleSheetsConfig = {
            url: null,
            secretKey: null
        };
        
        logger.componentInit('BARS', 'Bars core initialized');
    }

    // Set Google Sheets configuration
    setGoogleSheetsConfig(url, secretKey) {
        this.googleSheetsConfig.url = url;
        this.googleSheetsConfig.secretKey = secretKey;
        logger.info('BARS', 'Google Sheets configuration set', {
            hasUrl: !!url,
            hasSecretKey: !!secretKey
        });
    }

    // Parse bar data from Google Sheets response
    parseBarsData(sheetsData) {
        logger.time('BARS', 'Bars data parsing');
        logger.info('BARS', 'Starting bars data parsing', {
            dataLength: sheetsData.length
        });

        const bars = [];
        const invalidBars = [];

        for (let i = 0; i < sheetsData.length; i++) {
            const row = sheetsData[i];
            
            try {
                const barData = this.parseBarRow(row, i);
                if (barData) {
                    bars.push(barData);
                    logger.debug('BARS', `✅ Successfully parsed bar: ${barData.name}`, {
                        barIndex: i,
                        city: barData.city,
                        type: barData.type
                    });
                } else {
                    invalidBars.push({ row, index: i });
                    logger.warn('BARS', `❌ Failed to parse bar at row ${i}`, {
                        rowData: row
                    });
                }
            } catch (error) {
                invalidBars.push({ row, index: i, error: error.message });
                logger.componentError('BARS', `Error parsing bar at row ${i}`, error);
            }
        }

        logger.timeEnd('BARS', 'Bars data parsing');
        logger.info('BARS', `📊 Bars parsing complete. Found ${bars.length} valid bars, ${invalidBars.length} invalid`, {
            successRate: `${Math.round((bars.length / sheetsData.length) * 100)}%`,
            invalidCount: invalidBars.length
        });

        return bars;
    }

    // Parse individual bar row from Google Sheets
    parseBarRow(row, index) {
        try {
            // Expected columns from Google Sheets (matching the app script):
            // timestamp, name, importId, city, googleMaps, address, coordinates, instagram, website, nickname, type, hours
            const barData = {
                name: row.name || '',
                importId: row.importId || '',
                city: row.city || '',
                googleMaps: row.googleMaps || '',
                address: row.address || '',
                coordinates: this.parseCoordinates(row.coordinates),
                instagram: row.instagram || '',
                website: row.website || '',
                nickname: row.nickname || '',
                type: row.type || 'bar',
                hours: row.hours || '',
                timestamp: row.timestamp || new Date().toISOString()
            };

            // Validate required fields
            if (!barData.name || !barData.city) {
                logger.warn('BARS', `Bar at row ${index} missing required fields`, {
                    hasName: !!barData.name,
                    hasCity: !!barData.city,
                    barData
                });
                return null;
            }

            // Generate slug for URL-friendly identification
            barData.slug = this.generateSlug(barData.name, barData.importId);

            // Parse links
            barData.links = this.parseLinks(barData);

            return barData;
        } catch (error) {
            logger.componentError('BARS', `Failed to parse bar row ${index}`, error);
            return null;
        }
    }

    // Parse coordinates string (e.g., "40.7831, -73.9712")
    parseCoordinates(coordinatesStr) {
        if (!coordinatesStr || typeof coordinatesStr !== 'string') {
            return null;
        }

        try {
            const parts = coordinatesStr.split(',');
            if (parts.length >= 2) {
                const lat = parseFloat(parts[0].trim());
                const lng = parseFloat(parts[1].trim());
                
                if (!isNaN(lat) && !isNaN(lng)) {
                    return { lat, lng };
                }
            }
        } catch (error) {
            logger.warn('BARS', 'Failed to parse coordinates', {
                coordinatesStr,
                error: error.message
            });
        }

        return null;
    }

    // Parse links from bar data
    parseLinks(barData) {
        const links = [];
        
        if (barData.website) {
            links.push({ type: 'website', url: barData.website, label: '🌐 Website' });
        }
        if (barData.instagram) {
            links.push({ type: 'instagram', url: barData.instagram, label: '📷 Instagram' });
        }
        if (barData.googleMaps) {
            links.push({ type: 'gmaps', url: barData.googleMaps, label: '🗺️ Google Maps' });
        }
        
        return links.length > 0 ? links : null;
    }

    // Generate URL slug from bar name and import ID
    generateSlug(name, importId = null) {
        const baseSlug = name.toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
        
        // Add import ID hash suffix to ensure uniqueness
        if (importId) {
            const idHash = this.hashString(importId);
            return `${baseSlug}-${idHash}`;
        }
        
        return baseSlug;
    }

    // Create a short hash from string for clean URLs
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        // Convert to positive hex string and take first 8 characters
        return Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8);
    }

    // Load bars data from Google Sheets
    async loadBarsData() {
        try {
            logger.time('BARS', 'Bars data loading');
            logger.apiCall('BARS', 'Loading bars data from Google Sheets');

            if (!this.googleSheetsConfig.url || !this.googleSheetsConfig.secretKey) {
                throw new Error('Google Sheets configuration not set');
            }

            const url = new URL(this.googleSheetsConfig.url);
            url.searchParams.set('token', this.googleSheetsConfig.secretKey);

            const response = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const sheetsData = await response.json();
            const bars = this.parseBarsData(sheetsData);

            this.barsData = bars;
            this.allBars = bars;

            logger.timeEnd('BARS', 'Bars data loading');
            logger.componentLoad('BARS', 'Bars data loaded successfully', {
                barCount: bars.length
            });

            return bars;
        } catch (error) {
            logger.componentError('BARS', 'Failed to load bars data', error);
            throw error;
        }
    }

    // Save bar data to Google Sheets
    async saveBarData(barData) {
        try {
            logger.apiCall('BARS', 'Saving bar data to Google Sheets', {
                barName: barData.name,
                city: barData.city
            });

            if (!this.googleSheetsConfig.url || !this.googleSheetsConfig.secretKey) {
                throw new Error('Google Sheets configuration not set');
            }

            const payload = {
                name: barData.name,
                importId: barData.importId || '',
                city: barData.city,
                googleMaps: barData.googleMaps || '',
                address: barData.address || '',
                coordinates: barData.coordinates ? `${barData.coordinates.lat}, ${barData.coordinates.lng}` : '',
                instagram: barData.instagram || '',
                website: barData.website || '',
                nickname: barData.nickname || '',
                type: barData.type || 'bar',
                hours: barData.hours || ''
            };

            const response = await fetch(this.googleSheetsConfig.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }

            const result = await response.text();
            logger.componentLoad('BARS', 'Bar data saved successfully', {
                result,
                barName: barData.name
            });

            return result;
        } catch (error) {
            logger.componentError('BARS', 'Failed to save bar data', error);
            throw error;
        }
    }

    // Filter bars by city
    filterBarsByCity(bars, cityKey) {
        return bars.filter(bar => 
            bar.city && bar.city.toLowerCase().replace(/\s+/g, '-') === cityKey
        );
    }

    // Filter bars by type
    filterBarsByType(bars, type) {
        return bars.filter(bar => 
            bar.type && bar.type.toLowerCase() === type.toLowerCase()
        );
    }

    // Search bars by name or nickname
    searchBars(bars, searchTerm) {
        if (!searchTerm) return bars;
        
        const term = searchTerm.toLowerCase();
        return bars.filter(bar => 
            (bar.name && bar.name.toLowerCase().includes(term)) ||
            (bar.nickname && bar.nickname.toLowerCase().includes(term)) ||
            (bar.address && bar.address.toLowerCase().includes(term))
        );
    }

    // Get bars within distance of coordinates
    getBarsNearLocation(bars, userLat, userLng, maxDistanceKm = 10) {
        return bars.filter(bar => {
            if (!bar.coordinates) return false;
            
            const distance = this.calculateDistance(
                userLat, userLng,
                bar.coordinates.lat, bar.coordinates.lng
            );
            
            return distance <= maxDistanceKm;
        }).sort((a, b) => {
            const distanceA = this.calculateDistance(
                userLat, userLng,
                a.coordinates.lat, a.coordinates.lng
            );
            const distanceB = this.calculateDistance(
                userLat, userLng,
                b.coordinates.lat, b.coordinates.lng
            );
            return distanceA - distanceB;
        });
    }

    // Calculate distance between two coordinates (Haversine formula)
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371; // Earth's radius in kilometers
        const dLat = this.toRadians(lat2 - lat1);
        const dLng = this.toRadians(lng2 - lng1);
        
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // Convert degrees to radians
    toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    // Get bar statistics
    getBarStatistics(bars) {
        const stats = {
            total: bars.length,
            byCity: {},
            byType: {},
            withCoordinates: 0,
            withWebsite: 0,
            withInstagram: 0
        };

        bars.forEach(bar => {
            // Count by city
            if (bar.city) {
                stats.byCity[bar.city] = (stats.byCity[bar.city] || 0) + 1;
            }

            // Count by type
            if (bar.type) {
                stats.byType[bar.type] = (stats.byType[bar.type] || 0) + 1;
            }

            // Count features
            if (bar.coordinates) stats.withCoordinates++;
            if (bar.website) stats.withWebsite++;
            if (bar.instagram) stats.withInstagram++;
        });

        return stats;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BarsCore;
} else {
    window.BarsCore = BarsCore;
}
