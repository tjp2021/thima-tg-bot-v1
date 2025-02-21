export interface BotConfig {
    botToken: string
    openaiApiKey: string
    pineconeApiKey: string
    pineconeIndex: string
    pineconeHost?: string
}

export interface RuntimeConfig {
    modelProvider: string
    token: string
    settings: {
        temperature: number
        maxTokens: number
        topP: number
        frequencyPenalty: number
        presencePenalty: number
        model: string
    }
} 