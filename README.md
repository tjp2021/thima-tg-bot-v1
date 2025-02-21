# ThiMa Telegram Bot

A Telegram user bot powered by GPT-4 that processes messages in batches, analyzes sentiment, and detects price-related discussions.

## Features

- Message batch processing with 30-second windows
- Sentiment analysis using OpenAI embeddings
- Price mention detection and trend analysis
- Persistent session management
- Production-ready with PM2 process management

## Prerequisites

- Node.js >= 20.0.0
- PNPM package manager
- Telegram account
- OpenAI API key
- Pinecone account and API key

## Setup

1. Clone the repository:
\`\`\`bash
git clone <repository-url>
cd eliza
\`\`\`

2. Install dependencies:
\`\`\`bash
pnpm install
\`\`\`

3. Create a `.env` file with the following variables:
\`\`\`env
# Telegram User Bot Authentication
TELEGRAM_ACCOUNT_APP_ID=           # Your Telegram API ID
TELEGRAM_ACCOUNT_APP_HASH=         # Your Telegram API Hash
TELEGRAM_ACCOUNT_PHONE=            # Your phone number
TELEGRAM_ACCOUNT_DEVICE_MODEL=Desktop
TELEGRAM_ACCOUNT_SYSTEM_VERSION=1.0.0

# OpenAI Configuration
OPENAI_API_KEY=                    # Your OpenAI API key

# Pinecone Configuration
PINECONE_API_KEY=                  # Your Pinecone API key
PINECONE_INDEX=                    # Your Pinecone index name
PINECONE_HOST=                     # Your Pinecone host URL
\`\`\`

4. Run the authentication script:
\`\`\`bash
pnpm tsx auth-telegram.js
\`\`\`

## Development

Run in development mode:
\`\`\`bash
NODE_ENV=development LOG_LEVEL=debug pnpm tsx agent/src/index.ts
\`\`\`

## Production Deployment

1. Install PM2:
\`\`\`bash
npm install -g pm2
\`\`\`

2. Start the bot:
\`\`\`bash
pm2 start ecosystem.config.cjs
\`\`\`

3. Monitor the bot:
\`\`\`bash
pm2 monit
\`\`\`

4. View logs:
\`\`\`bash
pm2 logs telegram-bot
\`\`\`

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request
