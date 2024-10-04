const chalk = require('chalk')

// Logging levels
const LOG_LEVELS = {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info'
}

// Current log level
const currentLogLevel = LOG_LEVELS.INFO

// Centralized logging function
const log = (level, message) => {
    const levels = Object.values(LOG_LEVELS)
    if (levels.indexOf(level) <= levels.indexOf(currentLogLevel)) {
        const prefix = level === LOG_LEVELS.ERROR ? chalk.red('❌') : level === LOG_LEVELS.WARN ? chalk.yellow('⚠️') : chalk.blue('ℹ️')
        console.log(`${prefix} ${message}`)
    }
}

// Centralized error logging function
const logError = (error, context = '') => {
    log(LOG_LEVELS.ERROR, `Error occurred${context ? ' in ' + context : ''}:`)
    log(LOG_LEVELS.ERROR, `   Message: ${error.message}`)
    log(LOG_LEVELS.ERROR, `   Stack: ${error.stack}`)
}

module.exports = { log, logError }
