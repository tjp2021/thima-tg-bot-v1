import 'dotenv/config'
import { Telegraf } from 'telegraf'
import OpenAI from 'openai'
import { BotConfig } from './types/config'
import { MessageContext, Character } from './types/common'
import pino from 'pino'
import BetterSqlite3 from 'better-sqlite3'
import { OpenAIEmbeddingService } from './services/embeddings/openai.service'
import { PineconeService } from './services/vector-store/pinecone.config'
import { SentimentAnalysisService, SentimentAnalysisResult } from './services/sentiment/sentiment.service'
import fs from 'fs'
import { PerformanceMonitor } from '@elizaos/monitoring/dist/performance'
import { MessageWindow, MessageWindowManager } from './services/sentiment/message-window'
import { createPriceProcessor } from './services/price/price-processor'

// Initialize logger with more verbose output
const logger = pino({
    name: 'TelegramBot',
    level: 'debug',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true
        }
    }
})

// Load character config
const characterConfig: Character = JSON.parse(fs.readFileSync('../telegram-bot.character.json', 'utf8'))

// Custom error classes
class BotConfigError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'BotConfigError'
    }
}

// Initialize bot with config
const config: BotConfig = {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    pineconeApiKey: process.env.PINECONE_API_KEY || '',
    pineconeIndex: process.env.PINECONE_INDEX || '',
    pineconeHost: process.env.PINECONE_HOST
}

// Log config (without sensitive data)
logger.info('Starting bot with config:', {
    hasToken: !!config.botToken,
    hasOpenAI: !!config.openaiApiKey,
    hasPinecone: !!config.pineconeApiKey
})

// Validate config
if (!config.botToken || !config.openaiApiKey || !config.pineconeApiKey || !config.pineconeIndex) {
    throw new Error('Missing required environment variables')
}

// Initialize performance monitor as client
// console.log('Initializing performance monitor as client...')
// const monitor = PerformanceMonitor.getInstance(false)
// console.log('Performance monitor initialized')

// Initialize services
const openai = new OpenAI({
    apiKey: config.openaiApiKey
})

// Initialize MessageWindowManager
const messageWindowManager = new MessageWindowManager(logger)

const embeddingService = new OpenAIEmbeddingService(config.openaiApiKey)
const vectorStore = new PineconeService({
    apiKey: config.pineconeApiKey,
    indexName: config.pineconeIndex,
    host: config.pineconeHost
})

// Initialize price processor
logger.info('Initializing price processor...')
const priceProcessor = createPriceProcessor(logger)
logger.info('Price processor initialized')

// Initialize SQLite database
const db = new BetterSqlite3('sentiment_cache.db')
db.exec(`
  DROP TABLE IF EXISTS sentiment_cache;
  CREATE TABLE sentiment_cache (
    messageHash TEXT PRIMARY KEY,
    embedding TEXT NOT NULL,
    sentiment TEXT NOT NULL,
    confidence REAL NOT NULL,
    context TEXT NOT NULL,
    userId TEXT NOT NULL,
    roomId TEXT NOT NULL,
    senderName TEXT NOT NULL DEFAULT 'Unknown',
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER NOT NULL
  )
`)

const sentimentAnalyzer = new SentimentAnalysisService(embeddingService, vectorStore, db)

// Initialize bot
const bot = new Telegraf(config.botToken)

// Message handler
bot.on('text', async (ctx) => {
    try {
        logger.info('Received message:', {
            from: ctx.from.first_name,
            chatType: ctx.chat.type,
            messageId: ctx.message.message_id
        })

        // Only add message to window - no processing here
        messageWindowManager.addMessage({
            text: ctx.message.text,
            userId: ctx.from.id.toString(),
            chatId: ctx.chat.id.toString()
        })

    } catch (error) {
        logger.error(error, 'Error processing message')
        await ctx.reply('Sorry, I encountered an error processing your message.')
    }
})

// Process message windows
async function processMessageWindow(window: MessageWindow): Promise<void> {
    try {
        logger.info({ 
            windowId: window.windowId,
            messageCount: window.messages.length,
            messages: window.messages.map(m => m.text)
        }, 'Processing message window')
        
        // Process price mentions
        try {
            logger.debug('Running price processor...')
            await priceProcessor(window)
            logger.debug('Price processor completed')
        } catch (error) {
            logger.error({ error }, 'Error in price processor')
        }
        
        // Process each message in the window for sentiment
        const sentiments: SentimentAnalysisResult[] = await Promise.all(
            window.messages.map(msg => sentimentAnalyzer.analyzeSentiment(msg.text, {
                userId: msg.userId,
                roomId: window.chatId,
                senderName: msg.userId // TODO: Get actual sender name
            }))
        )

        // Calculate overall sentiment
        const totalConfidence = sentiments.reduce((sum, s) => sum + s.score.confidence, 0)
        const weightedScore = sentiments.reduce((sum, s) => sum + (s.score.score * s.score.confidence), 0)
        const overallSentiment = {
            score: {
                category: determineOverallCategory(sentiments),
                score: weightedScore / totalConfidence,
                confidence: totalConfidence / sentiments.length
            },
            context: {
                trends: sentiments.map(s => s.score.category)
            }
        }

        // Generate response considering all messages
        const completion = await openai.chat.completions.create({
            model: 'gpt-4-turbo-preview',
            messages: [
                {
                    role: 'system',
                    content: characterConfig.templates.messageHandlerTemplate.content
                },
                {
                    role: 'user',
                    content: `[Window Messages: ${window.messages.map(m => m.text).join(' | ')}]
[Overall Sentiment: ${overallSentiment.score.category}, Confidence: ${overallSentiment.score.confidence}]
[Sentiment Trends: ${overallSentiment.context.trends.join(', ')}]`
                }
            ],
            temperature: 0.9
        })

        const response = completion.choices[0]?.message?.content || 'No response generated'
        
        // Send response
        const ctx = bot.telegram
        await ctx.sendMessage(window.chatId, response)
        
        // Mark window as complete
        messageWindowManager.markWindowComplete(window.windowId)
        
        logger.info({ 
            windowId: window.windowId,
            messageCount: window.messages.length,
            response: response
        }, 'Window processing complete')

    } catch (error) {
        logger.error({ error, windowId: window.windowId }, 'Error processing message window')
    }
}

// Helper function to determine overall sentiment category
function determineOverallCategory(sentiments: SentimentAnalysisResult[]): string {
    const categoryCounts = sentiments.reduce((counts: {[key: string]: number}, s) => {
        counts[s.score.category] = (counts[s.score.category] || 0) + 1
        return counts
    }, {})
    
    return Object.entries(categoryCounts)
        .sort(([,a], [,b]) => b - a)[0][0]
}

// Initialize services and start bot
;(async () => {
    try {
        // Initialize sentiment analyzer
        logger.info('Initializing sentiment analyzer...')
        await sentimentAnalyzer.initialize()
        logger.info('Sentiment analyzer initialized')

        // Start message window processing
        messageWindowManager.startProcessing(processMessageWindow)
        logger.info('Message window processing started')

        // Start bot
        logger.info('Starting bot...')
        try {
            await bot.launch()
            logger.info('Bot started successfully')
        } catch (botError) {
            logger.error('Failed to launch bot:', botError)
            throw botError
        }
    } catch (error) {
        logger.error('Failed to initialize services:', error)
        process.exit(1)
    }
})()

// Enable graceful stop
process.once('SIGINT', () => {
    logger.info('Received SIGINT, stopping bot...')
    messageWindowManager.stopProcessing()
    bot.stop('SIGINT')
})
process.once('SIGTERM', () => {
    logger.info('Received SIGTERM, stopping bot...')
    messageWindowManager.stopProcessing()
    bot.stop('SIGTERM')
}) 