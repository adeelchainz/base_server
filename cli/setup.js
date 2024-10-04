#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const semver = require('semver')
const { promisify } = require('util')
const { installProjectPackages } = require('./npmInstaller')
const { createEnvFiles } = require('./createEnvFiles')
const { installRequiredDependencies } = require('./installRequiredDependencies')
const { promptForDatabaseUrl } = require('./addDbUrltoEnv')
const { runNpmBuildAndCheckDist } = require('./runNpmBuildAndCheckDist ')
const { runTests } = require('./runTests')
const { askRunMethod } = require('./askRunMethod')
const exec = promisify(require('child_process').exec) // Using promisify to run commands

const packageJsonPath = path.resolve(__dirname, '../package.json') // Path to package.json

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

// Function to get the required Node.js version from package.json
const getRequiredNodeVersion = () => {
    if (!fs.existsSync(packageJsonPath)) {
        logMessage('✖ Error: package.json not found. Please ensure you are running this script in the project root.', 'error')
        process.exit(1)
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    const requiredNodeVersion = packageJson.engines?.node || '>=14.0.0' // Default to >=14.0.0 if not specified

    logMessage(`Required Node.js version: ${requiredNodeVersion}`)
    return requiredNodeVersion
}

/**
 * Check the current Node.js version against the required version.
 */
const checkNodeVersion = (requiredVersion) => {
    const currentVersion = process.versions.node

    logMessage(`Current Node.js version: ${currentVersion}`)

    // Check if the current Node.js version is compatible
    if (!semver.satisfies(currentVersion, requiredVersion)) {
        logMessage(`✖ Error: Your Node.js version ${currentVersion} is not compatible.`, 'error')
        logMessage(`Please install a version that satisfies: ${requiredVersion}`, 'warning')
        process.exit(1) // Exit the process with a failure code
    } else {
        logMessage('✔ Node.js version is compatible.\n', 'success')
    }
}

/**
 * Check if a package is installed.
 * @param {string} packageName - The name of the package to check.
 * @returns {Promise<boolean>} - Returns true if the package is installed, false otherwise.
 */
const isPackageInstalled = async (packageName) => {
    try {
        await exec(`npm list ${packageName} --depth=0`)
        return true // Package is installed
    } catch (error) {
        return false // Package is not installed
    }
}

/**
 * Install a package using npm.
 * @param {string} packageName - The name of the package to install.
 */
const installPackage = async (packageName) => {
    logMessage(`Installing package: ${packageName}...`)
    try {
        await exec(`npm install ${packageName}`)
        logMessage(`✔ Package installed: ${packageName}`, 'success')
    } catch (error) {
        logMessage(`✖ Error installing package ${packageName}: ${error.message || error}`, 'error')
        process.exit(1)
    }
}

/**
 * Dynamically import a module after ensuring it's installed.
 * @param {string} packageName - The name of the package to install and import.
 * @returns {Promise<any>} - Returns the imported module.
 */
const dynamicImport = async (packageName) => {
    const installed = await isPackageInstalled(packageName)
    if (!installed) {
        await installPackage(packageName) // Install the package if it's not already installed
    }
    return import(packageName) // Dynamic import
}

/**
 * Main function to execute setup tasks.
 */
const main = async () => {
    logMessage('\n✨ Welcome to the Base Server Setup CLI!')
    logMessage('-------------------------------------------------\n')

    const requiredNodeVersion = getRequiredNodeVersion() // Step 1: Get the required Node.js version from package.json
    checkNodeVersion(requiredNodeVersion) // Step 2: Check Node.js version compatibility

    // await installRequiredDependencies()

    // logMessage('All required dependencies are installed and ready to use!\n', 'success')

    // await installProjectPackages()
    await createEnvFiles()

    // Call the function to prompt for input
    await runNpmBuildAndCheckDist()
    await runTests()
    await promptForDatabaseUrl()
    await askRunMethod()

    // Example placeholder for further logic:
}

// Run the main function
main().catch((error) => {
    logMessage(`✖ Unexpected error: ${error.message}`, 'error')
    process.exit(1) // Exit with failure if an unexpected error occurs
})
