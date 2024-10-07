#!/usr/bin/env node

/**
 * Node.js setup script for the base server setup.
 * This script checks for the required Node.js version, installs project dependencies,
 * configures environment files, initializes Git, and runs the build and tests.
 * It provides a CLI interface for automating the setup process.
 */

// Importing required modules
const fs = require('fs')
const path = require('path')
const semver = require('semver') // Used to validate Node.js version
const { promisify } = require('util') // Promisify allows to use exec as a promise-based function

// Importing utility functions
const { installProjectPackages } = require('./utils/npmInstaller')
const { createEnvFiles } = require('./utils/createEnvFiles')
const { installRequiredDependencies } = require('./utils/installRequiredDependencies')
const { promptForDatabaseUrl } = require('./utils/addDbUrltoEnv')
const { runNpmBuildAndCheckDist } = require('./utils/runNpmBuildAndCheckDist ')
const { runTests } = require('./utils/runTests')
const { askRunMethod } = require('./utils/askRunMethod')
const { checkGitInitialization } = require('./utils/gitHandler')

// Promisify the exec function to run shell commands
const exec = promisify(require('child_process').exec)

// Define the path to the package.json file
const packageJsonPath = path.resolve(__dirname, '../package.json')

/**
 * Logs messages to the console in different colors based on message type.
 * @param {string} message - The message to log.
 * @param {string} [type='info'] - The type of the message ('info', 'success', 'error', 'warning').
 */
const logMessage = (message, type = 'info') => {
    const colors = {
        info: '\x1b[34m', // Blue color for info
        success: '\x1b[32m', // Green color for success
        error: '\x1b[31m', // Red color for error
        warning: '\x1b[33m', // Yellow color for warning
        reset: '\x1b[0m' // Reset to default console color
    }

    console.log(`${colors[type]}${message}${colors.reset}`)
}

/**
 * Fetches the required Node.js version from the package.json file.
 * @returns {string} - The required Node.js version, or '>=14.0.0' as default.
 */
const getRequiredNodeVersion = () => {
    // Check if package.json exists in the project root
    if (!fs.existsSync(packageJsonPath)) {
        logMessage('✖ Error: package.json not found. Please ensure you are running this script in the project root.', 'error')
        process.exit(1)
    }

    // Parse package.json and fetch the required Node.js version
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    const requiredNodeVersion = packageJson.engines?.node || '>=14.0.0' // Default to >=14.0.0 if not specified

    logMessage(`Required Node.js version: ${requiredNodeVersion}`)
    return requiredNodeVersion
}

/**
 * Checks if the current Node.js version meets the required version.
 * @param {string} requiredVersion - The required Node.js version.
 */
const checkNodeVersion = (requiredVersion) => {
    const currentVersion = process.versions.node // Get the current Node.js version

    logMessage(`Current Node.js version: ${currentVersion}`)

    // Check if the current Node.js version is compatible with the required version
    if (!semver.satisfies(currentVersion, requiredVersion)) {
        logMessage(`✖ Error: Your Node.js version ${currentVersion} is not compatible.`, 'error')
        logMessage(`Please install a version that satisfies: ${requiredVersion}`, 'warning')
        process.exit(1) // Exit if the Node.js version is incompatible
    } else {
        logMessage('✔ Node.js version is compatible.\n', 'success')
    }
}

/**
 * Checks if a given package is installed.
 * @param {string} packageName - The name of the package to check.
 * @returns {Promise<boolean>} - Returns true if the package is installed, otherwise false.
 */
const isPackageInstalled = async (packageName) => {
    try {
        await exec(`npm list ${packageName} --depth=0`) // Check if the package is installed at the top level
        return true
    } catch (error) {
        return false // Package is not installed
    }
}

/**
 * Installs a specific npm package.
 * @param {string} packageName - The name of the package to install.
 */
const installPackage = async (packageName) => {
    logMessage(`Installing package: ${packageName}...`)
    try {
        await exec(`npm install ${packageName}`) // Install the package using npm
        logMessage(`✔ Package installed: ${packageName}`, 'success')
    } catch (error) {
        logMessage(`✖ Error installing package ${packageName}: ${error.message || error}`, 'error')
        process.exit(1)
    }
}

/**
 * Dynamically imports a package after ensuring it's installed.
 * @param {string} packageName - The name of the package to install and import.
 * @returns {Promise<any>} - Returns the imported module.
 */
const dynamicImport = async (packageName) => {
    const installed = await isPackageInstalled(packageName) // Check if the package is installed
    if (!installed) {
        await installPackage(packageName) // Install the package if not already installed
    }
    return import(packageName) // Dynamic import of the package
}

/**
 * Main function to orchestrate the setup process.
 * Executes the following tasks:
 * - Node.js version check
 * - Install project dependencies
 * - Create environment files
 * - Initialize Git if not already initialized
 * - Run build and test commands
 * - Prompt for database configuration
 * - Prompt for Docker/npm run method
 */
const main = async () => {
    logMessage('\n✨ Welcome to the Base Server Setup CLI!')
    logMessage('-------------------------------------------------\n')

    const requiredNodeVersion = getRequiredNodeVersion() // Step 1: Get the required Node.js version from package.json
    checkNodeVersion(requiredNodeVersion) // Step 2: Check Node.js version compatibility

    await installRequiredDependencies() // Step 3: Install required dependencies

    logMessage('All required dependencies are installed and ready to use!\n', 'success')

    await installProjectPackages() // Step 4: Install project-specific packages
    await createEnvFiles() // Step 5: Create necessary .env files
    await checkGitInitialization() // Step 6: Check and initialize Git if needed

    // Additional setup tasks
    await runNpmBuildAndCheckDist() // Step 7: Run npm build and check if 'dist' is created
    await runTests() // Step 8: Run tests to ensure everything works
    await promptForDatabaseUrl() // Step 9: Prompt user for database URL configuration
    await askRunMethod() // Step 10: Ask whether to run via Docker or npm
}

// Execute the main function and handle errors
main().catch((error) => {
    logMessage(`✖ Unexpected error: ${error.message}`, 'error')
    process.exit(1) // Exit with failure if an unexpected error occurs
})
