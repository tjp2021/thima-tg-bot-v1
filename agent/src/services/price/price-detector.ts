interface PriceMention {
    type: 'marketcap' | 'term' | 'emoji'
    value: string
    index: number
}

export class PriceDetector {
    // Basic price-related terms
    private static PRICE_TERMS = ['pump', 'dump', 'moon', 'dip', 'ath', 'atl']
    
    // Basic price emojis
    private static PRICE_EMOJIS = ['📈', '📉', '💰', '🚀', '💎']

    /**
     * Detects price mentions in a message
     * Returns array of price mentions found
     */
    public detectPriceMentions(message: string): PriceMention[] {
        const mentions: PriceMention[] = []

        // Check for market cap values with various formats:
        // 100mc, 100m, 100mil, 100 mil, 100 market cap
        const mcRegex = /\d+\.?\d*\s*(mc|m\b|mil\b|million|market\s*cap)/gi
        let match
        while ((match = mcRegex.exec(message)) !== null) {
            mentions.push({
                type: 'marketcap',
                value: match[0].trim(),
                index: match.index
            })
        }

        // Check for price terms
        const terms = PriceDetector.PRICE_TERMS
        for (const term of terms) {
            const regex = new RegExp(`\\b${term}\\b`, 'gi')
            while ((match = regex.exec(message)) !== null) {
                mentions.push({
                    type: 'term',
                    value: match[0],
                    index: match.index
                })
            }
        }

        // Check for emojis
        for (const emoji of PriceDetector.PRICE_EMOJIS) {
            let index = message.indexOf(emoji)
            while (index !== -1) {
                mentions.push({
                    type: 'emoji',
                    value: emoji,
                    index
                })
                index = message.indexOf(emoji, index + 1)
            }
        }

        return mentions
    }

    /**
     * Simple check if a message contains any price mentions
     */
    public hasPriceMentions(message: string): boolean {
        return this.detectPriceMentions(message).length > 0
    }
} 