const { promisify } = require('util')
const { exec } = require('child_process')
const fs = require('fs')
const path = require('path')

const execPromise = promisify(exec)

// Log messages with colors
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

// ** Helper function to handle readline input as a Promise **
const promptUser = async (query) => {
    const readline = (await import('readline')).default // Dynamically import readline
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

// Function to check if a .git folder exists and prompt for reinitialization
const checkGitInitialization = async () => {
    const gitDir = path.join(process.cwd(), '.git')

    if (fs.existsSync(gitDir)) {
        const response = await promptUser('A .git directory already exists. Do you want to reinitialize it? (yes/no): ')
        if (response.toLowerCase() === 'yes') {
            await execPromise('git init') // Reinitialize Git
            await logMessage('✔ Git reinitialized successfully!\n', 'success')
        } else {
            await logMessage('⚠️ Git initialization skipped!\n', 'warning')
        }
    } else {
        await execPromise('git init') // Initialize new Git repository
        await logMessage('✔ New Git repository initialized successfully!\n', 'success')
    }
}

// Export the function
module.exports = { checkGitInitialization }
