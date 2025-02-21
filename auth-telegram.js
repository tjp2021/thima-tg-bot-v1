import 'dotenv/config'
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import input from 'input'

const apiId = parseInt(process.env.TELEGRAM_ACCOUNT_APP_ID)
const apiHash = process.env.TELEGRAM_ACCOUNT_APP_HASH
const phoneNumber = process.env.TELEGRAM_ACCOUNT_PHONE

;(async () => {
    console.log('Initializing Telegram client...')
    
    // Create client
    const client = new TelegramClient(
        new StringSession(''), // Empty session for first login
        apiId,
        apiHash,
        {
            connectionRetries: 5,
            deviceModel: process.env.TELEGRAM_ACCOUNT_DEVICE_MODEL || 'Desktop',
            systemVersion: process.env.TELEGRAM_ACCOUNT_SYSTEM_VERSION || '1.0.0',
        }
    )

    try {
        // Start the client
        await client.start({
            phoneNumber: async () => phoneNumber,
            password: async () => await input.text('Please enter your password (if any): '),
            phoneCode: async () => await input.text('Please enter the code you received: '),
            onError: (err) => console.log(err),
        })

        console.log('Connected successfully!')

        // Save session string
        const sessionString = client.session.save()
        console.log('\nYour session string (save this):\n', sessionString)

        // Get and display basic account info
        const me = await client.getMe()
        console.log('\nAccount info:', {
            firstName: me.firstName,
            lastName: me.lastName,
            username: me.username,
            phone: me.phone,
        })

    } catch (error) {
        console.error('Failed to connect:', error)
    } finally {
        await client.disconnect()
    }
})() 