// installRequiredDependencies.js

const { promisify } = require('util')
const exec = promisify(require('child_process').exec)
const fs = require('fs')
const path = require('path')

const requiredDependencies = ['execa', 'ora', 'chalk', 'semver', 'progress'] // List of required dependencies

// Function to log messages
const logMessage = (message, type = 'info') => {
    const colors = {
        info: '\x1b[34m', // Blue
        success: '\x1b[32m', // Green
        error: '\x1b[31m', // Red
        warning: '\x1b[33m', // Yellow
        reset: '\x1b[0m' // Reset
    }

    console.log(`${colors[type]}${message}${colors.reset}`)
}

/**
 * Install required dependencies.
 */
const installRequiredDependencies = async () => {
    logMessage('Checking for required dependencies...')

    for (const dep of requiredDependencies) {
        try {
            await exec(`npm install ${dep}`)
            logMessage(`✔ Package installed: ${dep}`, 'success')
        } catch (error) {
            logMessage(`✖ Error installing package ${dep}: ${error.message}`, 'error')
            process.exit(1) // Exit if there's an error
        }
    }
}

// Export the installRequiredDependencies function
module.exports = { installRequiredDependencies }
