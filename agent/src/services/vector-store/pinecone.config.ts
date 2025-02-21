import { Pinecone, Index } from '@pinecone-database/pinecone'
import pino from 'pino'

export interface PineconeConfig {
  apiKey: string
  host?: string
  indexName: string
}

export interface IndexConfig {
  dimension: number
  metric: 'cosine' | 'euclidean' | 'dotproduct'
}

export class PineconeService {
  private client: Pinecone
  private readonly config: PineconeConfig
  private readonly indexConfig: IndexConfig
  private index: Index | null = null
  private readonly logger: pino.Logger = pino({ name: 'PineconeService' })
  private initialized: boolean = false

  constructor(config: PineconeConfig) {
    this.config = config
    this.client = new Pinecone({
      apiKey: config.apiKey
    })
    this.indexConfig = {
      dimension: 1536, // OpenAI text-embedding-3-small dimension
      metric: 'cosine'
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      // Check if index exists, if not create it
      const indexes = await this.client.listIndexes()
      const indexNames = Object.keys(indexes)
      
      if (!indexNames.includes(this.config.indexName)) {
        try {
          await this.createIndex()
          // Wait for index to be ready
          await new Promise(resolve => setTimeout(resolve, 60000))
        } catch (error: unknown) {
          if (error instanceof Error && !error.message?.includes('ALREADY_EXISTS')) {
            throw error
          }
          // Otherwise, index exists which is fine
        }
      }

      // Initialize the index
      this.index = this.client.index(this.config.indexName)
      this.initialized = true
      this.logger.info('Pinecone service initialized successfully')
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Failed to initialize Pinecone client: ${error.message}`)
      }
      throw new Error('Failed to initialize Pinecone client: Unknown error')
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  private async createIndex(): Promise<void> {
    try {
      await this.client.createIndex({
        name: this.config.indexName,
        dimension: this.indexConfig.dimension,
        metric: this.indexConfig.metric,
        spec: {
          serverless: {
            cloud: 'aws',
            region: 'us-east-1'
          }
        }
      })
    } catch (error) {
      throw new Error(`Failed to create Pinecone index: ${error.message}`)
    }
  }

  async getIndex(): Promise<Index> {
    await this.ensureInitialized()
    
    if (!this.index) {
      throw new Error('Pinecone index not initialized')
    }

    return this.index
  }

  async healthCheck(): Promise<boolean> {
    try {
      const indexes = await this.client.listIndexes()
      const indexNames = Object.keys(indexes)
      return indexNames.includes(this.config.indexName)
    } catch (error) {
      throw new Error(`Pinecone health check failed: ${error.message}`)
    }
  }

  async query(params: {
    vector: number[]
    topK: number
    includeMetadata?: boolean
  }): Promise<{
    matches: Array<{
      id: string
      score: number
      metadata?: Record<string, any>
    }>
  }> {
    await this.ensureInitialized()

    if (!this.index) {
      throw new Error('Pinecone index not initialized')
    }

    try {
      const result = await this.index.query({
        vector: params.vector,
        topK: params.topK,
        includeMetadata: params.includeMetadata
      })
      return result
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error('Error querying Pinecone:', error)
      } else {
        this.logger.error('Unknown error querying Pinecone:', { error })
      }
      throw error
    }
  }

  async upsert(vectors: Array<{
    id: string
    values: number[]
    metadata?: Record<string, any>
  }>): Promise<void> {
    await this.ensureInitialized()

    if (!this.index) {
      throw new Error('Pinecone index not initialized')
    }

    try {
      await this.index.upsert({
        vectors
      })
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error('Error upserting to Pinecone:', error)
      } else {
        this.logger.error('Unknown error upserting to Pinecone:', { error })
      }
      throw error
    }
  }
} 