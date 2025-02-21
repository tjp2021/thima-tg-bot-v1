import { SentimentAnalysisService, type SentimentAnalysisResult } from './sentiment.service'
import { OpenAIEmbeddingService } from '../embeddings/openai.service'
import { PineconeService } from '../vector-store/pinecone.config'
import BetterSqlite3, { Database } from 'better-sqlite3'
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { jest } from '@jest/globals'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load test environment variables
config({ path: resolve(__dirname, '../../../.env.test') })

// Set global test timeout
jest.setTimeout(10000) // 10 seconds per test

describe('SentimentAnalysisService Integration Tests', () => {
    let service: SentimentAnalysisService
    let db: Database | null = null
    let vectorStore: PineconeService | null = null

    beforeAll(async () => {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY is required for tests')
        }
        if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX) {
            throw new Error('PINECONE_API_KEY and PINECONE_INDEX are required for tests')
        }

        // Initialize SQLite database
        db = new BetterSqlite3(':memory:')
        db.exec(`
            CREATE TABLE IF NOT EXISTS sentiment_cache (
                id TEXT PRIMARY KEY,
                messageHash TEXT UNIQUE NOT NULL,
                embedding BLOB NOT NULL,
                sentiment REAL NOT NULL,
                confidence REAL NOT NULL,
                context TEXT NOT NULL,
                expiresAt TEXT,
                userId TEXT,
                roomId TEXT,
                createdAt TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_message_hash ON sentiment_cache(messageHash);
            CREATE INDEX IF NOT EXISTS idx_expires_at ON sentiment_cache(expiresAt);
        `)

        // Use real services with proper configuration
        const embeddingService = new OpenAIEmbeddingService(process.env.OPENAI_API_KEY)
        vectorStore = new PineconeService({
            apiKey: process.env.PINECONE_API_KEY,
            indexName: process.env.PINECONE_INDEX,
            host: process.env.PINECONE_HOST
        })
        
        service = new SentimentAnalysisService(embeddingService, vectorStore, db)
        await service.initialize() // Actually initialize with real embeddings
    }, 30000) // 30 second timeout for initialization

    afterAll(async () => {
        if (db) {
            db.close()
        }
        if (vectorStore) {
            // Clean up any test data
            try {
                const index = await vectorStore.getIndex()
                await index.deleteAll()
            } catch (error) {
                // If the index doesn't exist or deletion fails, log and continue
                console.warn('Warning: Could not clean up test data:', error)
            }
        }
    })

    describe('Real Sentiment Analysis', () => {
        it('should analyze strongly positive messages', async () => {
            const messages = [
                "This is absolutely amazing! I'm so happy!",
                "Best day ever! Everything is perfect!",
                "I'm thrilled with these incredible results!"
            ]

            for (const message of messages) {
                const result = await service.analyzeSentiment(message)
                expect(result.score.category).toBe('strongly_positive')
                expect(result.score.confidence).toBeGreaterThan(0.7)
            }
        })

        it('should analyze strongly negative messages', async () => {
            const messages = [
                "This is terrible! I hate everything about it!",
                "Worst experience ever! Absolutely horrible!",
                "I'm furious about this complete disaster!"
            ]

            for (const message of messages) {
                const result = await service.analyzeSentiment(message)
                expect(result.score.category).toBe('strongly_negative')
                expect(result.score.confidence).toBeGreaterThan(0.7)
            }
        })

        it('should analyze neutral messages', async () => {
            const messages = [
                "The meeting is scheduled for tomorrow.",
                "The document has been updated.",
                "I'm going to the store."
            ]

            for (const message of messages) {
                const result = await service.analyzeSentiment(message)
                expect(result.score.category).toBe('neutral')
                // Neutral messages often have lower confidence
                expect(result.score.confidence).toBeLessThan(0.8)
            }
        })

        it('should detect sentiment changes in conversation flow', async () => {
            const conversation = [
                "I'm really excited about this project!",
                "But these requirements are frustrating.",
                "However, I think we can make it work.",
                "Actually, this is turning out great!"
            ]

            const results = await Promise.all(
                conversation.map(msg => service.analyzeSentiment(msg))
            )

            // Verify sentiment progression
            expect(results[0].score.category).toBe('strongly_positive')
            expect(results[1].score.category).toBe('mildly_negative')
            expect(results[2].score.category).toBe('mildly_positive')
            expect(results[3].score.category).toBe('strongly_positive')

            // Verify context is tracking changes
            expect(results[3].context.recentTrend).toBeGreaterThan(0)
            expect(results[3].context.volatility).toBeGreaterThan(0.3)
        })

        it('should handle real-world messages with mixed sentiment', async () => {
            const message = "While I'm disappointed with the delay, I'm impressed with the quality of work."
            const result = await service.analyzeSentiment(message)
            
            // Should detect the mixed sentiment
            expect(result.score.confidence).toBeLessThan(0.8)
            expect(result.context.volatility).toBeGreaterThan(0)
        })

        it('should analyze messages in different languages', async () => {
            const messages = [
                { text: "¡Esto es maravilloso!", expected: 'strongly_positive' },
                { text: "C'est terrible!", expected: 'strongly_negative' },
                { text: "Das ist in Ordnung.", expected: 'neutral' }
            ]

            for (const { text, expected } of messages) {
                const result = await service.analyzeSentiment(text)
                expect(result.score.category).toBe(expected)
            }
        })

        it('should handle empty or whitespace messages', async () => {
            const messages = ['', ' ', '\n', '\t']
            
            for (const message of messages) {
                const result = await service.analyzeSentiment(message)
                expect(result.score.category).toBe('neutral')
                expect(result.score.confidence).toBe(1) // Should be highly confident about empty messages
            }
        })

        it('should analyze messages with emojis', async () => {
            const messages = [
                { text: "This is great! 🎉 🎊 🥳", expected: 'strongly_positive' },
                { text: "So sad 😢 😭 💔", expected: 'strongly_negative' },
                { text: "Just got coffee ☕", expected: 'neutral' }
            ]

            for (const { text, expected } of messages) {
                const result = await service.analyzeSentiment(text)
                expect(result.score.category).toBe(expected)
            }
        })

        it('should handle messages with special characters and formatting', async () => {
            const messages = [
                { text: "ABSOLUTELY AMAZING!!!", expected: 'strongly_positive' },
                { text: "this...is...terrible...", expected: 'strongly_negative' },
                { text: "normal message with *formatting* and _underscores_", expected: 'neutral' }
            ]

            for (const { text, expected } of messages) {
                const result = await service.analyzeSentiment(text)
                expect(result.score.category).toBe(expected)
            }
        })

        it('should analyze context over multiple messages', async () => {
            const conversation = [
                "Let's start this project!",
                "Making good progress.",
                "This is getting challenging.",
                "But we're almost done!",
                "Success! Project completed! 🎉"
            ]

            const results: SentimentAnalysisResult[] = []
            for (const message of conversation) {
                const result = await service.analyzeSentiment(message)
                results.push(result)
            }

            // Verify sentiment progression
            expect(results[0].score.category).toBe('mildly_positive')
            expect(results[1].score.category).toBe('mildly_positive')
            expect(results[2].score.category).toBe('mildly_negative')
            expect(results[3].score.category).toBe('mildly_positive')
            expect(results[4].score.category).toBe('strongly_positive')

            // Verify context
            expect(results[4].context.recentTrend).toBeGreaterThan(0)
            expect(results[4].context.volatility).toBeGreaterThan(0)
            expect(results[4].context.dominantCategory).toBe('mildly_positive')
        }, 30000) // Increased timeout to 30 seconds
    })
}) 