export interface MessageContext {
    messageText: string
    senderId: string
    senderName: string
    chatId: string
    chatType: string
    isPrivate: boolean
}

export interface ConversationContext {
    lastMessageTimestamp: number
    messageCount: number
    conversationHistory: Array<{
        role: 'user' | 'assistant'
        content: string
        timestamp: number
        sentiment?: any
    }>
}

export interface CharacterTemplate {
    role: string
    content: string
}

export interface Character {
    name: string
    description: string
    templates: {
        messageHandlerTemplate: CharacterTemplate
        shouldRespondTemplate: CharacterTemplate
    }
} 