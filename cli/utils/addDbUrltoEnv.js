const fs = require('fs')
const path = require('path')
const { promisify } = require('util')
const exec = promisify(require('child_process').exec) // Using promisify to run commands

// Function to log messages with colors
const logMessage = async (message, type = 'info') => {
    const chalk = (await import('chalk')).default // Dynamically import chalk
    const colors = {
        info: chalk.blue,
        success: chalk.green,
        error: chalk.red,
        warning: chalk.yellow,
        reset: chalk.reset
    }

    console.log(colors[type](message))
}

// Function to update the DATABASE_URL in .env.development
const updateDatabaseUrlInDevEnv = async (dbUrl) => {
    const envFilePath = path.resolve(__dirname, '../../.env.development')

    // Prepare the new DATABASE_URL entry
    const newEntry = `DATABASE_URL="${dbUrl}"\n`

    // Check if the file exists
    if (fs.existsSync(envFilePath)) {
        // Read the existing content
        const fileContent = fs.readFileSync(envFilePath, 'utf-8')

        // Check if DATABASE_URL already exists and update or add it
        if (fileContent.includes('DATABASE_URL=')) {
            const updatedContent = fileContent.replace(/DATABASE_URL=".*?"/, newEntry.trim())
            fs.writeFileSync(envFilePath, updatedContent, 'utf-8')
            await logMessage('✔ DATABASE_URL updated in .env.development!', 'success')
        } else {
            fs.appendFileSync(envFilePath, newEntry)
            await logMessage('✔ DATABASE_URL added to .env.development!', 'success')
        }
    } else {
        // Create the file and add DATABASE_URL if it doesn't exist
        fs.writeFileSync(envFilePath, newEntry, 'utf-8')
        await logMessage('✔ .env.development file created and DATABASE_URL added!', 'success')
    }
}

// Helper function to handle readline input as a Promise
const promptUser = async (query) => {
    const readline = (await import('readline')).default
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        })
        rl.question(query, (answer) => {
            rl.close() // Close readline after response
            resolve(answer)
        })
    })
}

// Function to prompt the user for the database URL
const promptForDatabaseUrl = async () => {
    const chalk = (await import('chalk')).default // Dynamically import chalk

    const dbUrl = await promptUser(chalk.yellow('Please enter your MongoDB URL (or type "skip" to skip): '))

    if (dbUrl.toLowerCase() === 'skip') {
        await logMessage('⚠️ Skipped updating DATABASE_URL!', 'warning')
    } else {
        await updateDatabaseUrlInDevEnv(dbUrl)
    }
}

// Export the functions
module.exports = { promptForDatabaseUrl }
