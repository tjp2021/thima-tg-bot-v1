module.exports = {
  apps: [{
    name: 'telegram-bot',
    script: 'node_modules/.bin/tsx',
    args: 'agent/src/index.ts',
    cwd: './',
    env: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      TELEGRAM_ACCOUNT_APP_ID: '24578804',
      TELEGRAM_ACCOUNT_APP_HASH: 'f7926f2230fcbb0fec893b0858181c41',
      TELEGRAM_ACCOUNT_PHONE: '+12094800633',
      TELEGRAM_ACCOUNT_DEVICE_MODEL: 'Desktop',
      TELEGRAM_ACCOUNT_SYSTEM_VERSION: '1.0.0',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      PINECONE_API_KEY: process.env.PINECONE_API_KEY,
      PINECONE_HOST: process.env.PINECONE_HOST,
      PINECONE_INDEX: process.env.PINECONE_INDEX
    },
    env_development: {
      NODE_ENV: 'development',
      LOG_LEVEL: 'debug'
    },
    watch: false,
    max_memory_restart: '1G',
    restart_delay: 3000,
    max_restarts: 10,
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    time: true
  }]
} 