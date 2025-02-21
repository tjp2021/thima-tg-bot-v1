import pino from 'pino'

export interface MessageWindow {
    windowId: string
    startTime: number
    endTime: number
    chatId: string
    messages: Array<{
        text: string
        timestamp: number
        userId: string
        telegramData?: {
            peerId: any  // Using any for now since we don't have the Telegram types
            messageId: number
        }
    }>
    status: 'collecting' | 'processing' | 'completed'
}

export interface MessageInput {
    text: string
    userId: string
    chatId: string
    timestamp?: number
    telegramData?: {
        peerId: any
        messageId: number
    }
}

export type WindowProcessor = (window: MessageWindow) => Promise<void>

export class MessageWindowManager {
    private readonly WINDOW_SIZE_MS = 30000  // 30s
    private readonly MIN_MESSAGES = 2
    private readonly MAX_MESSAGES = 5  // Add max messages per window
    private readonly PROCESSING_INTERVAL_MS = 10000  // 10s
    private readonly activeWindows = new Map<string, MessageWindow>()
    private readonly logger: pino.Logger
    private processingInterval: NodeJS.Timeout | null = null
    private windowProcessor: WindowProcessor | null = null

    constructor(logger: pino.Logger) {
        this.logger = logger
    }

    startProcessing(processor: WindowProcessor): void {
        if (this.processingInterval) {
            this.logger.warn('Processing loop already started')
            return
        }
        
        this.windowProcessor = processor
        this.processingInterval = setInterval(() => this.processReadyWindows(), this.PROCESSING_INTERVAL_MS)
        this.logger.info('Started message window processing loop')
    }

    stopProcessing(): void {
        if (this.processingInterval) {
            clearInterval(this.processingInterval)
            this.processingInterval = null
            this.windowProcessor = null
            this.logger.info('Stopped message window processing loop')
        }
    }

    private async processReadyWindows(): Promise<void> {
        if (!this.windowProcessor) return

        const readyWindows = this.getReadyWindows()
        for (const window of readyWindows) {
            try {
                await this.windowProcessor(window)
                this.markWindowComplete(window.windowId)
            } catch (error) {
                this.logger.error({ error, windowId: window.windowId }, 'Error processing window')
            }
        }
    }

    addMessage(message: MessageInput): MessageWindow {
        const now = Date.now()
        const windowId = this.getWindowId(message.chatId, now)
        
        let window = this.activeWindows.get(windowId)
        if (!window) {
            window = {
                windowId,
                startTime: now,
                endTime: now + this.WINDOW_SIZE_MS,
                chatId: message.chatId,
                messages: [],
                status: 'collecting' as const
            }
            this.activeWindows.set(windowId, window)
            this.logger.debug({ windowId }, 'Created new message window')
        }

        if (window.status === 'collecting') {
            window.messages.push({
                text: message.text,
                timestamp: message.timestamp || now,
                userId: message.userId,
                telegramData: message.telegramData
            })
            this.logger.debug({ windowId, messageCount: window.messages.length }, 'Added message to window')
        } else {
            // If window is already processing/completed, create a new one
            const newWindow: MessageWindow = {
                windowId: `${windowId}_overflow`,
                startTime: now,
                endTime: now + this.WINDOW_SIZE_MS,
                chatId: message.chatId,
                messages: [{
                    text: message.text,
                    timestamp: message.timestamp || now,
                    userId: message.userId,
                    telegramData: message.telegramData
                }],
                status: 'collecting'
            }
            this.activeWindows.set(newWindow.windowId, newWindow)
            this.logger.debug({ newWindowId: newWindow.windowId }, 'Created overflow window')
            return newWindow
        }

        return window
    }

    private getWindowId(chatId: string, timestamp: number): string {
        const windowStartTime = timestamp - (timestamp % this.WINDOW_SIZE_MS)
        return `${chatId}_${windowStartTime}`
    }

    getReadyWindows(): MessageWindow[] {
        const now = Date.now()
        const readyWindows: MessageWindow[] = []

        for (const [id, window] of this.activeWindows.entries()) {
            if (window.status !== 'collecting') continue

            const isTimeUp = now >= window.endTime
            const hasMinMessages = window.messages.length >= this.MIN_MESSAGES
            const hasMaxMessages = window.messages.length >= this.MAX_MESSAGES

            // Mark window ready if:
            // 1. Time is up AND we have minimum messages, OR
            // 2. We've hit max messages for this window
            if ((isTimeUp && hasMinMessages) || hasMaxMessages) {
                window.status = 'processing'
                readyWindows.push(window)
                this.logger.debug({ 
                    windowId: id, 
                    messageCount: window.messages.length,
                    isTimeUp,
                    hasMinMessages,
                    hasMaxMessages
                }, 'Window marked as ready')
            }
        }

        return readyWindows
    }

    markWindowComplete(windowId: string): void {
        const window = this.activeWindows.get(windowId)
        if (window) {
            window.status = 'completed'
            this.logger.debug({ windowId }, 'Window marked as completed')
        }
    }

    cleanup(): void {
        const now = Date.now()
        for (const [id, window] of this.activeWindows.entries()) {
            if (window.status === 'completed' || now - window.startTime > this.WINDOW_SIZE_MS * 2) {
                this.activeWindows.delete(id)
                this.logger.debug({ windowId: id }, 'Cleaned up message window')
            }
        }
    }
} 