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

/**
 * Run the npm build command and check for the dist folder.
 */
const runNpmBuildAndCheckDist = async () => {
    const distFolderPath = path.resolve(__dirname, '../../dist') // Path to the dist folder

    await logMessage('🔨 Starting npm build process...', 'info')

    try {
        // Execute npm run build command
        await exec('npm run build')
        await logMessage('✔ npm run build executed successfully!\n', 'success')
    } catch (error) {
        await logMessage(`✖ Error during npm build: ${error.message}`, 'error')
        process.exit(1) // Exit if the build fails
    }

    // Check if the dist folder exists
    if (fs.existsSync(distFolderPath)) {
        await logMessage('🎉 The dist folder was created successfully!\n', 'success')
    } else {
        await logMessage('⚠️ Warning: The dist folder was not created. Please check your build process.', 'warning')
    }
}

// Export the function
module.exports = { runNpmBuildAndCheckDist }
