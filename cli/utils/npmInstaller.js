const fs = require('fs')
const path = require('path')
const { promisify } = require('util')
const exec = promisify(require('child_process').exec) // Using promisify to run commands

const packageJsonPath = path.resolve(__dirname, '../../package.json') // Path to package.json

// Function to log messages
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
 * @param {Object} ora - ora instance for the spinner
 * @returns {Promise<void>}
 */
const installPackage = async (packageName, ora) => {
    const spinner = ora(`Installing package: ${packageName}...`).start() // Start the spinner
    try {
        await exec(`npm install ${packageName}`) // Install the package
        spinner.succeed(`✔ Package installed: ${packageName}`)
    } catch (error) {
        spinner.fail(`✖ Error installing package ${packageName}: ${error.message || error}`)
        process.exit(1) // Exit if an error occurs
    }
}

/**
 * Install all project dependencies listed in package.json.
 */
const installProjectPackages = async () => {
    await logMessage('Checking project dependencies...')

    if (!fs.existsSync(packageJsonPath)) {
        await logMessage('✖ Error: package.json not found. Please ensure you are running this script in the project root.', 'error')
        process.exit(1)
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    const allDependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
    }

    // Dynamically import the progress and ora packages
    const { default: ProgressBar } = await import('progress')
    const ora = (await import('ora')).default // Dynamically import ora

    // Create a progress bar with the total number of packages
    const totalPackages = Object.keys(allDependencies).length
    const progressBar = new ProgressBar('[:bar] :current/:total :percent :etas', {
        total: totalPackages,
        width: 30,
        complete: '=',
        incomplete: ' ',
        renderThrottle: 100 // Throttle rendering to avoid too frequent updates
    })

    // Create an array of promises for installing packages
    const installPromises = Object.keys(allDependencies).map(async (dep) => {
        const installed = await isPackageInstalled(dep)
        if (!installed) {
            await installPackage(dep, ora) // Install if not installed
        }
        progressBar.tick() // Update the progress bar
    })

    // Run the promises concurrently
    await Promise.all(installPromises)

    await logMessage('✔ All project dependencies are installed!\n', 'success')
}

// Export the installProjectPackages function
module.exports = { installProjectPackages }
