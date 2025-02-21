import { describe, expect, it, beforeAll, afterAll } from '@jest/globals'
import { PineconeService } from '../../vector-store/pinecone.config'
import { OpenAIEmbeddingService } from '../../embeddings/openai.service'
import { SentimentAnalysisService, SentimentAnalysisResult } from '../sentiment.service'
import BetterSqlite3 from 'better-sqlite3'
import { config } from 'dotenv'
import path from 'path'
import { sqliteTables } from '../../../../packages/adapter-sqlite/src/sqliteTables'

// Load test environment variables
config({ path: path.resolve(process.cwd(), '.env.test') })

// Type assertion to ensure environment variables are strings
const requiredEnvVars = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY as string,
  PINECONE_API_KEY: process.env.PINECONE_API_KEY as string,
  PINECONE_HOST: process.env.PINECONE_HOST as string,
  PINECONE_INDEX: process.env.PINECONE_INDEX as string
}

// Validate environment variables
Object.entries(requiredEnvVars).forEach(([key, value]) => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
})

let vectorStore: PineconeService
let embeddingService: OpenAIEmbeddingService
let sentimentService: SentimentAnalysisService
let db: BetterSqlite3.Database

describe('SentimentAnalysis Integration Tests', () => {
  beforeAll(async () => {
    embeddingService = new OpenAIEmbeddingService(requiredEnvVars.OPENAI_API_KEY)
    vectorStore = new PineconeService({
      apiKey: requiredEnvVars.PINECONE_API_KEY,
      host: requiredEnvVars.PINECONE_HOST,
      indexName: requiredEnvVars.PINECONE_INDEX
    })
    await vectorStore.initialize()
    
    // Initialize SQLite database with schema
    db = new BetterSqlite3(':memory:')
    db.exec(sqliteTables)
    
    sentimentService = new SentimentAnalysisService(embeddingService, vectorStore, db)
    await sentimentService.initialize() // Initialize reference embeddings
  }, 30000) // Increased timeout for initialization

  afterAll(async () => {
    db.close()
  })

  it('should analyze sentiment correctly', async () => {
    const testCases = [
      {
        input: 'I am absolutely thrilled and overjoyed with this amazing achievement! 🎉',
        expectedCategory: 'strongly_positive' as const
      },
      {
        input: 'This is the worst experience ever! I am absolutely furious and disgusted! 😡',
        expectedCategory: 'strongly_negative' as const
      },
      {
        input: 'I feel a bit uneasy about the upcoming changes',
        expectedCategory: 'mildly_negative' as const
      },
      {
        input: 'The weather is nice today',
        expectedCategory: 'mildly_positive' as const
      }
    ]

    for (const testCase of testCases) {
      const result = await sentimentService.analyzeSentiment(testCase.input)
      expect(result.score.category).toBe(testCase.expectedCategory)
      expect(result.score.confidence).toBeGreaterThan(0)
      expect(result.score.confidence).toBeLessThanOrEqual(1)
    }
  }, 10000)

  it('should handle context and trends', async () => {
    const messages = [
      'I am absolutely thrilled and overjoyed! 🎉',
      'This is fantastic news! I cannot contain my excitement! 🚀',
      'Everything is going perfectly! I am on top of the world! ⭐'
    ]

    const results: SentimentAnalysisResult[] = []
    for (const message of messages) {
      const result = await sentimentService.analyzeSentiment(message)
      results.push(result)
    }

    const lastResult = results[results.length - 1]
    expect(lastResult.context.recentTrend).toBeGreaterThan(0.3) // Trending strongly positive
    expect(lastResult.context.dominantCategory).toBe('strongly_positive')
  }, 10000)

  it('should handle complex emotional expressions', async () => {
    const result = await sentimentService.analyzeSentiment(
      'I am excited about the new project but also quite anxious and stressed about the tight deadlines. The uncertainty is really getting to me, even though the opportunity is amazing.'
    )

    expect(result.context.volatility).toBeGreaterThan(0.3) // Mixed emotions should show higher volatility
  }, 10000)

  it('should detect sarcasm', async () => {
    const result = await sentimentService.analyzeSentiment(
      'Oh great, another pointless meeting that could have been an email. Just what I needed to waste my time! 🙄'
    )

    expect(['mildly_negative', 'strongly_negative'] as const).toContain(result.score.category)
  }, 10000)

  it('should handle modern language with emojis', async () => {
    const result = await sentimentService.analyzeSentiment(
      'This is absolutely lit! 🔥 Crushing it rn, no cap! Best day ever frfr! 💯 💪'
    )

    expect(result.score.category).toBe('strongly_positive')
  }, 10000)

  it('should handle neutral statements', async () => {
    const result = await sentimentService.analyzeSentiment(
      'The meeting is scheduled for tomorrow at 3 PM.'
    )

    expect(result.score.category).toBe('neutral')
  }, 10000)

  it('should detect subtle negative sentiment', async () => {
    const result = await sentimentService.analyzeSentiment(
      'I suppose it could have been worse, but I expected better.'
    )

    expect(result.score.category).toBe('mildly_negative')
  }, 10000)

  it('should detect subtle positive sentiment', async () => {
    const result = await sentimentService.analyzeSentiment(
      'Things are starting to look up, making some progress.'
    )

    expect(result.score.category).toBe('mildly_positive')
  }, 10000)
}) 