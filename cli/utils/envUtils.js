const fs = require('fs')
const path = require('path')
const ora = require('ora')
const { log, logError } = require('./logger')

// Function to create environment files from .env.example
const createEnvFiles = async () => {
    const envExamplePath = path.join(__dirname, '.env.example')
    const envFiles = ['.env.development', '.env.production', '.env.test']

    const spinner = ora('📝 Creating environment files...').start()
    try {
        for (const envFile of envFiles) {
            await execAsync(`cp ${envExamplePath} ${path.join(__dirname, envFile)}`, 'createEnvFiles')
            log(LOG_LEVELS.INFO, `Created ${envFile}`)
        }
        spinner.succeed('🎉 Environment files created.')
    } catch (error) {
        spinner.fail('❌ Failed to create environment files.')
        logError(error, 'createEnvFiles')
        throw new Error(error)
    }
}

// Function to prompt for MongoDB URL and update env files
const promptMongoDBURL = async () => {
    // (Same implementation as before)
}

module.exports = { createEnvFiles, promptMongoDBURL }
