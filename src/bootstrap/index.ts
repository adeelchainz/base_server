import { initRateLimiter } from '../config/rate-limiter'
import logger from '../handlers/logger'
import database from '../services/database'

export async function bootstrap(): Promise<void> {
    try {
        const connection = await database.connect()
        logger.info(`Database connection established`, {
            meta: { CONNECTION_NAME: connection.name }
        })

        initRateLimiter(connection)
        logger.info(`Rate limiter initiated`)
    } catch (error) {
        logger.error(`Error during bootstrap:`, { meta: error })
        throw error
    }
}
