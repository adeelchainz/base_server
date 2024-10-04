const fs = require('fs')
const path = require('path')
const ora = require('ora')
const chalk = require('chalk')
const execAsync = require('./dependencies').execAsync // Reuse execAsync function

const createEnvFiles = async () => {
    const envExamplePath = path.join(__dirname, '..', '.env.example')
    const envFiles = ['.env.development', '.env.production', '.env.test']

    const spinner = ora('📝 Creating environment files...').start()
    try {
        for (const envFile of envFiles) {
            await execAsync(`cp ${envExamplePath} ${path.join(__dirname, '..', envFile)}`)
            console.log(`Created ${chalk.green(envFile)}`)
        }
        spinner.succeed('🎉 Environment files created successfully.')
    } catch (error) {
        spinner.fail('❌ Failed to create environment files.')
        throw error
    }
}

module.exports = { createEnvFiles }
