import 'dotenv/config'
import { Api, TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { NewMessage, NewMessageEvent } from 'telegram/events'
import { SqliteDatabaseAdapter } from '@elizaos/adapter-sqlite'
import { generateText, ModelClass } from '@elizaos/core'
import BetterSqlite3 from 'better-sqlite3'
import pino from 'pino'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { MessageWindowManager, MessageWindow } from './services/sentiment/message-window'
import { createPriceProcessor } from './services/price/price-processor'
import { OpenAIEmbeddingService } from './services/embeddings/openai.service'
import { PineconeService } from './services/vector-store/pinecone.config'
import { SentimentAnalysisService, SentimentAnalysisResult } from './services/sentiment/sentiment.service'
import OpenAI from 'openai'
import { PerformanceMonitor } from '@elizaos/monitoring/dist/performance'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Initialize logger with more verbose output
const logger = pino({
    name: 'TelegramBot',
    level: process.env.LOG_LEVEL || 'debug',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true
        }
    }
})

// Load character config
const characterConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../../telegram-bot.character.json'), 'utf8'))

// Custom error classes for better error handling
class BotConfigError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'BotConfigError'
    }
}

class BotRuntimeError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'BotRuntimeError'
    }
}

class TelegramUserBot {
    private client: TelegramClient
    private db: BetterSqlite3.Database
    private readonly SESSION_FILE = path.join(process.cwd(), 'telegram_session.txt')
    private messageWindowManager: MessageWindowManager
    private priceProcessor: ReturnType<typeof createPriceProcessor>
    private embeddingService: OpenAIEmbeddingService
    private pineconeService: PineconeService
    private sentimentService: SentimentAnalysisService
    private openai: OpenAI

    constructor() {
        logger.info('Initializing TelegramUserBot...')

        // Validate required environment variables
        const requiredEnvVars = {
            TELEGRAM_ACCOUNT_APP_ID: process.env.TELEGRAM_ACCOUNT_APP_ID,
            TELEGRAM_ACCOUNT_APP_HASH: process.env.TELEGRAM_ACCOUNT_APP_HASH,
            OPENAI_API_KEY: process.env.OPENAI_API_KEY,
            PINECONE_API_KEY: process.env.PINECONE_API_KEY,
            PINECONE_INDEX: process.env.PINECONE_INDEX
        }

        for (const [key, value] of Object.entries(requiredEnvVars)) {
            if (!value) throw new BotConfigError(`Missing required environment variable: ${key}`)
        }

        // Initialize OpenAI
        this.openai = new OpenAI({
            apiKey: requiredEnvVars.OPENAI_API_KEY
        })

        // Initialize services
        this.embeddingService = new OpenAIEmbeddingService(requiredEnvVars.OPENAI_API_KEY)
        this.pineconeService = new PineconeService({
            apiKey: requiredEnvVars.PINECONE_API_KEY,
            indexName: requiredEnvVars.PINECONE_INDEX,
            host: process.env.PINECONE_HOST
        })

        // Initialize SQLite database
        this.db = new BetterSqlite3('sentiment_cache.db')
        this.initializeDatabase()

        // Initialize sentiment service
        this.sentimentService = new SentimentAnalysisService(
            this.embeddingService,
            this.pineconeService,
            this.db
        )
        
        // Initialize message window manager
        this.messageWindowManager = new MessageWindowManager(logger)
        
        // Initialize price processor
        logger.info('Initializing price processor...')
        try {
            this.priceProcessor = createPriceProcessor(logger)
            logger.info('Price processor initialized successfully')
        } catch (error) {
            logger.error({ error }, 'Failed to initialize price processor')
            throw error
        }

        // Initialize Telegram client
        const apiId = parseInt(requiredEnvVars.TELEGRAM_ACCOUNT_APP_ID)
        const apiHash = requiredEnvVars.TELEGRAM_ACCOUNT_APP_HASH

        // ALWAYS try to load existing session first
        let session: StringSession
        if (fs.existsSync(this.SESSION_FILE)) {
            try {
                const savedSession = fs.readFileSync(this.SESSION_FILE, 'utf8').trim()
                session = new StringSession(savedSession)
                logger.info('Loaded existing session')
            } catch (error) {
                logger.warn({ error }, 'Failed to load session, creating new one')
                session = new StringSession('')
            }
        } else {
            logger.info('No existing session found, creating new one')
            session = new StringSession('')
        }

        this.client = new TelegramClient(session, apiId, apiHash, {
            connectionRetries: 5
        })

        // Initialize message window processing
        this.messageWindowManager.startProcessing(this.processMessageWindow.bind(this))
        logger.info('Message window processing started')
    }

    private initializeDatabase() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sentiment_cache (
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
    }

    private async processMessageWindow(window: MessageWindow): Promise<void> {
        try {
            logger.info({ 
                windowId: window.windowId,
                messageCount: window.messages.length,
                messages: window.messages.map(m => m.text)
            }, 'Processing message window')
            
            // Get the peer entity from the first message's Telegram data
            const firstMessage = window.messages[0]
            if (!firstMessage?.telegramData?.peerId) {
                logger.error('No Telegram data found in window messages')
                return
            }

            // Resolve the entity once for this window
            const entity = await this.client.getEntity(firstMessage.telegramData.peerId)
            if (!entity) {
                logger.error('Failed to get entity for peer')
                return
            }
            
            // Process price mentions
            try {
                logger.debug('Running price processor...')
                await this.priceProcessor(window)
                logger.debug('Price processor completed')
            } catch (error) {
                logger.error({ error }, 'Error in price processor')
            }

            // Process sentiment and generate response
            try {
                const sentiments: SentimentAnalysisResult[] = await Promise.all(
                    window.messages.map(msg => this.sentimentService.analyzeSentiment(msg.text, {
                        userId: msg.userId,
                        roomId: window.chatId,
                        senderName: msg.userId
                    }))
                )

                // Calculate overall sentiment
                const totalConfidence = sentiments.reduce((sum, s) => sum + s.score.confidence, 0)
                const weightedScore = sentiments.reduce((sum, s) => sum + (s.score.score * s.score.confidence), 0)
                const overallSentiment = {
                    score: {
                        category: this.determineOverallCategory(sentiments),
                        score: weightedScore / totalConfidence,
                        confidence: totalConfidence / sentiments.length
                    },
                    context: {
                        trends: sentiments.map(s => s.score.category)
                    }
                }

                // Generate GPT response considering all context
                const completion = await this.openai.chat.completions.create({
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

                const response = completion.choices[0]?.message?.content
                if (response) {
                    await this.client.sendMessage(entity, { message: response })
                    logger.info('GPT response sent successfully')
                }

            } catch (error) {
                logger.error({ error }, 'Error processing sentiment and generating response')
            }
            
            logger.info({ 
                windowId: window.windowId,
                messageCount: window.messages.length
            }, 'Window processing complete')

        } catch (error) {
            logger.error({ error, windowId: window.windowId }, 'Error processing message window')
        }
    }

    private determineOverallCategory(sentiments: SentimentAnalysisResult[]): string {
        const categoryCounts = sentiments.reduce((counts: {[key: string]: number}, s) => {
            counts[s.score.category] = (counts[s.score.category] || 0) + 1
            return counts
        }, {})
        
        return Object.entries(categoryCounts)
            .sort(([,a], [,b]) => b - a)[0][0]
    }

    async start() {
        try {
            logger.info('Starting TelegramUserBot...')
            
            // Initialize services
            await this.pineconeService.initialize()
            await this.sentimentService.initialize()
            
            // Connect to Telegram
            await this.client.connect()
            logger.info('Connected to Telegram')

            // Cache entities by getting all dialogs first
            logger.info('Caching entities...')
            await this.client.getDialogs({})
            logger.info('Entities cached')

            // Save session string after successful connection
            const sessionString = (this.client.session as StringSession).save()
            fs.writeFileSync(this.SESSION_FILE, sessionString)
            logger.info('Session saved')

            // Add event handler for new messages - ONLY handle group messages
            this.client.addEventHandler(this.handleMessage.bind(this), new NewMessage({
                incoming: true,
                outgoing: false
            }))
            logger.info('Message handler registered')

            // Log that we're ready
            const me = await this.client.getMe()
            logger.info('Bot started and ready to respond as:', me.className)

            logger.info('TelegramUserBot started successfully')
        } catch (error) {
            logger.error({ error }, 'Failed to start TelegramUserBot')
            throw error
        }
    }

    private async handleMessage(event: NewMessageEvent) {
        try {
            const message = event.message
            
            // Skip empty messages
            if (!message.text) return
            
            // SUPER verbose logging
            logger.debug('Received message:', {
                text: message.text,
                chatId: message.chatId?.toString(),
                senderId: message.senderId?.toString(),
                fromId: message.fromId?.toString(),
                peerId: message.peerId?.toString(),
                chat: message.chat,
                raw: {
                    chat: message.chat,
                    sender: message.sender,
                    fromId: message.fromId,
                    peerId: message.peerId
                }
            })
            
            // Add message to window manager with Telegram metadata
            this.messageWindowManager.addMessage({
                text: message.text,
                userId: message.sender?.id?.toString() || 'unknown',
                chatId: message.chatId?.toString() || 'unknown',
                timestamp: Date.now(),
                telegramData: {
                    peerId: message.peerId,
                    messageId: message.id
                }
            })

        } catch (error) {
            logger.error({
                error,
                stack: error.stack,
                name: error.name,
                message: error.message,
                code: error.code
            }, 'Error handling message')
        }
    }

    async stop() {
        try {
            logger.info('Stopping TelegramUserBot...')
            this.messageWindowManager.stopProcessing()
            await this.client.disconnect()
            this.db.close()
            logger.info('TelegramUserBot stopped')
        } catch (error) {
            logger.error({ error }, 'Error stopping TelegramUserBot')
        }
    }
}

// Create and start bot
const bot = new TelegramUserBot()

// Handle shutdown gracefully
process.once('SIGINT', async () => {
    logger.info('Received SIGINT')
    await bot.stop()
})

process.once('SIGTERM', async () => {
    logger.info('Received SIGTERM')
    await bot.stop()
})

// Start the bot
bot.start().catch(error => {
    logger.error({ error }, 'Failed to start bot')
    process.exit(1)
})
