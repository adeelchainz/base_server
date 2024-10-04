const fs = require('fs')
const { exec } = require('child_process')
const ora = require('ora')
const { SingleBar, Presets } = require('cli-progress')
const { log, logError } = require('./logger')

// Function to execute shell commands
const execAsync = (command, context) => {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                logError(error, context || command)
                reject(`❌ Command failed: ${command}\nError: ${stderr}`)
            } else {
                resolve(stdout)
            }
        })
    })
}

// Function to check and install required packages
const installRequiredPackages = async (requiredPackages) => {
    const spinner = ora('🔍 Checking for required packages...').start()
    const bar = new SingleBar({}, Presets.shades_classic)

    try {
        const totalPackages = requiredPackages.length
        bar.start(totalPackages, 0)

        for (const pkg of requiredPackages) {
            try {
                await execAsync(`npm list ${pkg}`, 'installRequiredPackages')
            } catch {
                await execAsync(`npm install ${pkg}`, 'installRequiredPackages')
                log(LOG_LEVELS.INFO, `Installed ${pkg}`)
            }
            bar.increment()
        }

        bar.stop()
        spinner.succeed('🎉 All required packages are installed.')
    } catch (error) {
        bar.stop()
        logError(error, 'installRequiredPackages')
        spinner.fail('❌ Failed to install required packages.')
        throw new Error(error)
    }
}

module.exports = { execAsync, installRequiredPackages }
