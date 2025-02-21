import { Database } from 'better-sqlite3'
import { createHash } from 'crypto'
import pino from 'pino'

const logger = pino({
    name: 'SentimentCache',
    level: process.env.LOG_LEVEL || 'info'
})

interface SentimentCacheEntry {
    messageHash: string
    embedding: string
    sentiment: string
    confidence: number
    context: string
    userId: string
    roomId: string
    senderName: string
    expiresAt: number
    createdAt: number
}

interface DBResult {
    id: string
    messageHash: string
    embedding: Buffer
    sentiment: number
    confidence: number
    context: string
    expiresAt?: string
    userId?: string
    roomId?: string
}

export class SentimentCacheService {
    private db: Database
    private logger: pino.Logger

    constructor(db: Database) {
        this.db = db
        this.logger = pino({ name: 'SentimentCache' })
    }

    private generateMessageHash(message: string): string {
        return createHash('sha256').update(message).digest('hex')
    }

    async getCachedSentiment(message: string): Promise<SentimentCacheEntry | null> {
        try {
            const messageHash = this.generateMessageHash(message)
            const stmt = this.db.prepare(`
                SELECT * FROM sentiment_cache 
                WHERE messageHash = ? 
                AND (expiresAt IS NULL OR expiresAt > datetime('now'))
            `)
            const result = stmt.get(messageHash) as DBResult | undefined

            if (!result) {
                return null
            }

            // Convert BLOB to Float32Array
            const embedding = new Float32Array(result.embedding)
            const context = JSON.parse(result.context) as Record<string, unknown>
            
            return {
                id: result.id,
                messageHash: result.messageHash,
                embedding,
                sentiment: result.sentiment,
                confidence: result.confidence,
                context,
                expiresAt: result.expiresAt ? new Date(result.expiresAt) : undefined,
                userId: result.userId,
                roomId: result.roomId
            }
        } catch (error) {
            logger.error('Error retrieving cached sentiment:', error)
            return null
        }
    }

    async cacheSentiment(data: Omit<SentimentCacheEntry, 'expiresAt' | 'createdAt'>): Promise<void> {
        try {
            const now = Date.now()
            const entry: SentimentCacheEntry = {
                ...data,
                expiresAt: now + 24 * 60 * 60 * 1000, // 24 hours
                createdAt: now
            }

            const stmt = this.db.prepare(`
                INSERT INTO sentiment_cache (
                    messageHash,
                    embedding,
                    sentiment,
                    confidence,
                    context,
                    userId,
                    roomId,
                    senderName,
                    expiresAt,
                    createdAt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)

            stmt.run(
                entry.messageHash,
                entry.embedding,
                entry.sentiment,
                entry.confidence,
                entry.context,
                entry.userId,
                entry.roomId,
                entry.senderName,
                entry.expiresAt,
                entry.createdAt
            )

            this.logger.info({ messageHash: entry.messageHash }, 'Sentiment cached successfully')
        } catch (error) {
            this.logger.error('Error caching sentiment:', error)
            throw error
        }
    }

    async cleanup(): Promise<void> {
        try {
            const stmt = this.db.prepare('DELETE FROM sentiment_cache WHERE expiresAt <= datetime("now")')
            stmt.run()
        } catch (error) {
            logger.error('Error cleaning up sentiment cache:', error)
            throw error
        }
    }
} 