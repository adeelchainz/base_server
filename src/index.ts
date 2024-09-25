import app from './app'
import config from './config/config'
import logger from './handlers/logger'

const server = app.listen(config.PORT)

;(() => {
    try {
        logger.info(`Application started`, {
            meta: {
                PORT: config.PORT,
                SERVER_URL: config.SERVER_URL
            }
        })
    } catch (error) {
        logger.error(`error`, { meta: error })

        server.close((err) => {
            if (err) logger.error(`error`, { meta: error })

            process.exit(1)
        })
    }
})()
