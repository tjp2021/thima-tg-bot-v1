// Module level debug
console.log('Price processor module loading')

import { PriceDetector } from './price-detector'
import { MessageWindow } from '../sentiment/message-window'
import pino from 'pino'

// Create logger with specific name
const logger = pino({ 
    name: 'PriceAnalysis',
    level: process.env.LOG_LEVEL || 'debug' // Ensure we see all logs
})

console.log('Price processor module initializing logger')

export const createPriceProcessor = (parentLogger: pino.Logger) => {
    console.log('createPriceProcessor called')
    // Use child logger to maintain context
    const processorLogger = parentLogger.child({ component: 'PriceProcessor' })
    processorLogger.info('Initializing price processor')
    
    let detector
    try {
        detector = new PriceDetector()
        processorLogger.info('Price detector created successfully')
    } catch (error) {
        processorLogger.error({ error }, 'Failed to create price detector')
        throw error
    }

    if (!detector) {
        throw new Error('Price detector is undefined after creation')
    }

    return async (window: MessageWindow): Promise<void> => {
        const startTime = Date.now()
        try {
            processorLogger.info({ 
                windowId: window.windowId,
                messageCount: window.messages.length,
                messages: window.messages.map(m => m.text)
            }, 'Price processor starting')

            processorLogger.debug({ 
                windowId: window.windowId,
                messageCount: window.messages.length,
                messages: window.messages.map(m => m.text)
            }, 'Processing window for price mentions')
            
            // Get unique users who mentioned market caps
            const marketCapMentions = new Map<string, Set<string>>() // marketCap -> Set of userIds
            const termMentions = new Map<string, Set<string>>() // term -> Set of userIds
            const emojiMentions = new Map<string, Set<string>>() // emoji -> Set of userIds

            // Process each message
            for (const message of window.messages) {
                const mentions = detector.detectPriceMentions(message.text)
                
                processorLogger.debug({ 
                    windowId: window.windowId,
                    messageText: message.text,
                    userId: message.userId,
                    mentionsFound: mentions.length,
                    mentions: mentions.map(m => ({ type: m.type, value: m.value }))
                }, 'Price mentions detected in message')

                // Group mentions by type
                for (const mention of mentions) {
                    const targetMap = mention.type === 'marketcap' ? marketCapMentions :
                                    mention.type === 'term' ? termMentions :
                                    emojiMentions

                    if (!targetMap.has(mention.value)) {
                        targetMap.set(mention.value, new Set())
                    }
                    targetMap.get(mention.value)?.add(message.userId)
                }
            }

            const processingTime = Date.now() - startTime

            // Log market cap trends
            for (const [marketCap, users] of marketCapMentions.entries()) {
                if (users.size >= 2) {
                    processorLogger.info({
                        windowId: window.windowId,
                        marketCap,
                        userCount: users.size,
                        users: Array.from(users),
                        processingTime
                    }, 'Market cap trend detected')
                } else {
                    processorLogger.debug({
                        windowId: window.windowId,
                        marketCap,
                        userCount: users.size,
                        users: Array.from(users)
                    }, 'Single user market cap mention')
                }
            }

            // Log term trends
            for (const [term, users] of termMentions.entries()) {
                if (users.size >= 2) {
                    processorLogger.info({
                        windowId: window.windowId,
                        term,
                        userCount: users.size,
                        users: Array.from(users),
                        processingTime
                    }, 'Price term trend detected')
                } else {
                    processorLogger.debug({
                        windowId: window.windowId,
                        term,
                        userCount: users.size,
                        users: Array.from(users)
                    }, 'Single user price term mention')
                }
            }

            // Log emoji trends
            for (const [emoji, users] of emojiMentions.entries()) {
                if (users.size >= 2) {
                    processorLogger.info({
                        windowId: window.windowId,
                        emoji,
                        userCount: users.size,
                        users: Array.from(users),
                        processingTime
                    }, 'Price emoji trend detected')
                } else {
                    processorLogger.debug({
                        windowId: window.windowId,
                        emoji,
                        userCount: users.size,
                        users: Array.from(users)
                    }, 'Single user price emoji mention')
                }
            }

            // Log window summary
            processorLogger.info({
                windowId: window.windowId,
                messageCount: window.messages.length,
                processingTime,
                stats: {
                    marketCaps: marketCapMentions.size,
                    terms: termMentions.size,
                    emojis: emojiMentions.size,
                    totalMentions: marketCapMentions.size + termMentions.size + emojiMentions.size
                }
            }, 'Price window processing complete')

        } catch (error) {
            processorLogger.error({ 
                error, 
                windowId: window.windowId,
                messageCount: window.messages.length,
                processingTime: Date.now() - startTime
            }, 'Error processing price window')
            throw error
        }
    }
} 