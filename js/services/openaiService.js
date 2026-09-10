// js/services/openaiService.js

class OpenAIService {
    constructor() {
        // 🔥 REPLACE WITH YOUR OPENAI API KEY
        this.apiKey = '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';
        this.apiUrl = 'https://api.openai.com/v1/chat/completions';
        this.useMock = !this.apiKey || this.apiKey === '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';
        
        if (this.useMock) {
            console.warn('⚠️ Using mock AI classification (no API key configured)');
        }
    }

    // ============================================
    // CLASSIFY EMERGENCY
    // ============================================
    async classifyEmergency(description) {
        try {
            // Try OpenAI first if key is configured
            if (!this.useMock) {
                const result = await this._callOpenAI(description);
                if (result) return result;
            }
            
            // Fallback to mock classification
            return this._mockClassification(description);
            
        } catch (error) {
            console.error('❌ Classification failed:', error);
            return this._mockClassification(description);
        }
    }

    // ============================================
    // OPENAI API CALL
    // ============================================
    async _callOpenAI(description) {
        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        {
                            role: 'system',
                            content: `You are an emergency dispatcher in the Philippines.
                            
                            Return ONLY valid JSON. Analyze the emergency report and return:
                            - "type": one of ["fire","flood","armed_conflict","medical","accident","natural_disaster","other"]
                            - "priority": one of ["low","medium","high","critical"]
                            - "requiresImmediateAction": boolean
                            - "suggestedResources": array of resources
                            - "confidence": number 0-1
                            - "title": short descriptive title`
                        },
                        {
                            role: 'user',
                            content: `Classify: "${description}"`
                        }
                    ],
                    response_format: { type: "json_object" },
                    temperature: 0.3
                })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            const result = JSON.parse(data.choices[0].message.content);
            
            return {
                type: result.type || 'other',
                priority: result.priority || 'medium',
                requiresImmediateAction: result.requiresImmediateAction || false,
                suggestedResources: result.suggestedResources || ['Barangay Response Team'],
                confidence: result.confidence || 0.5,
                title: result.title || 'Emergency Report'
            };

        } catch (error) {
            console.warn('⚠️ OpenAI API error:', error.message);
            return null;
        }
    }

    // ============================================
    // MOCK CLASSIFICATION
    // ============================================
    _mockClassification(description) {
        const lower = description.toLowerCase();
        
        // Fire - CRITICAL
        if (lower.includes('fire') || lower.includes('smoke') || lower.includes('burning') || 
            lower.includes('explosion') || lower.includes('blaze')) {
            return {
                type: 'fire',
                priority: 'critical',
                requiresImmediateAction: true,
                suggestedResources: ['Fire Truck', 'Ambulance', 'Fire Extinguisher'],
                confidence: 0.95,
                title: '🔥 FIRE EMERGENCY'
            };
        }
        
        // Medical - CRITICAL
        if (lower.includes('unconscious') || lower.includes('not breathing') || 
            lower.includes('heart attack') || lower.includes('stroke') ||
            lower.includes('severe bleeding') || lower.includes('choking') ||
            lower.includes('heart') || lower.includes('bleeding')) {
            return {
                type: 'medical',
                priority: 'critical',
                requiresImmediateAction: true,
                suggestedResources: ['Ambulance', 'Medical Team', 'First Aid Kit'],
                confidence: 0.95,
                title: '🏥 MEDICAL EMERGENCY'
            };
        }
        
        // Armed Conflict - CRITICAL
        if (lower.includes('gun') || lower.includes('shooting') || lower.includes('fight') || 
            lower.includes('armed') || lower.includes('violence') || lower.includes('shooter')) {
            return {
                type: 'armed_conflict',
                priority: 'critical',
                requiresImmediateAction: true,
                suggestedResources: ['Police', 'Military', 'SWAT'],
                confidence: 0.92,
                title: '⚔️ SECURITY THREAT'
            };
        }
        
        // Natural Disaster - HIGH
        if (lower.includes('earthquake') || lower.includes('typhoon') || lower.includes('storm') || 
            lower.includes('landslide') || lower.includes('tornado')) {
            return {
                type: 'natural_disaster',
                priority: 'high',
                requiresImmediateAction: true,
                suggestedResources: ['Rescue Team', 'Evacuation Center', 'Emergency Supplies'],
                confidence: 0.88,
                title: '🌪️ NATURAL DISASTER'
            };
        }
        
        // Flood - HIGH
        if (lower.includes('flood') || lower.includes('water rising') || lower.includes('drowning')) {
            return {
                type: 'flood',
                priority: 'high',
                requiresImmediateAction: true,
                suggestedResources: ['Rescue Boat', 'Life Vests', 'Evacuation Center'],
                confidence: 0.88,
                title: '🌊 FLOOD EMERGENCY'
            };
        }
        
        // Accident - HIGH
        if (lower.includes('accident') || lower.includes('crash') || lower.includes('collision')) {
            return {
                type: 'accident',
                priority: 'high',
                requiresImmediateAction: true,
                suggestedResources: ['Ambulance', 'Police', 'Tow Truck'],
                confidence: 0.85,
                title: '💥 ACCIDENT'
            };
        }
        
        // Default
        return {
            type: 'other',
            priority: 'medium',
            requiresImmediateAction: false,
            suggestedResources: ['Barangay Response Team'],
            confidence: 0.50,
            title: '📋 Emergency Report'
        };
    }

    // ============================================
    // SUMMARIZE TEXT
    // ============================================
    async summarize(text) {
        if (this.useMock || text.length < 50) {
            return text.substring(0, 150) + (text.length > 150 ? '...' : '');
        }
        
        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        {
                            role: 'system',
                            content: 'Summarize in 1-2 sentences. Be concise.'
                        },
                        {
                            role: 'user',
                            content: text
                        }
                    ],
                    temperature: 0.3,
                    max_tokens: 60
                })
            });

            if (!response.ok) throw new Error('API error');
            const data = await response.json();
            return data.choices[0].message.content.trim();

        } catch (error) {
            console.warn('⚠️ Summarize error:', error);
            return text.substring(0, 150) + '...';
        }
    }
}

// Make global
window.OpenAIService = new OpenAIService();