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

const runTests = async () => {
    await logMessage('Running tests...')

    try {
        const { stdout, stderr } = await exec('npm run test -- --forceExit')
        console.log(stdout) // Log the output of the test script
        if (stderr) {
            console.error(stderr) // Log any error output
        }

        await logMessage('✔ All tests passed successfully!\n', 'success')
    } catch (error) {
        await logMessage('✖ Tests failed! Please check the error above.\n', 'error')
        process.exit(1) // Exit the process if tests fail
    }
}

module.exports = { runTests }
