import OpenAI from 'openai'
import { config } from '../../config'

export interface EmbeddingOptions {
  batchSize?: number
  maxRetries?: number
}

export class OpenAIEmbeddingService {
  private client: OpenAI
  private readonly defaultOptions: Required<EmbeddingOptions> = {
    batchSize: 100,
    maxRetries: 3
  }

  constructor(apiKey: string, options?: EmbeddingOptions) {
    this.client = new OpenAI({ apiKey })
    this.defaultOptions = { ...this.defaultOptions, ...options }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.client.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        dimensions: 1536
      })

      return response.data[0].embedding
    } catch (error) {
      throw new Error(`Failed to generate embedding: ${error.message}`)
    }
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      const batches = this.chunkArray(texts, this.defaultOptions.batchSize)
      const embeddings: number[][] = []

      for (const batch of batches) {
        const response = await this.client.embeddings.create({
          model: 'text-embedding-3-small',
          input: batch,
          dimensions: 1536
        })

        embeddings.push(...response.data.map(d => d.embedding))
      }

      return embeddings
    } catch (error) {
      throw new Error(`Failed to generate batch embeddings: ${error.message}`)
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size))
    }
    return chunks
  }
} 