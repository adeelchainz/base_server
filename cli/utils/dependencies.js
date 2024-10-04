const { exec } = require('child_process')
const ora = require('ora')
const chalk = require('chalk')

const execAsync = (command) => {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(chalk.red(`Command failed: ${command}\nError: ${stderr}`))
                reject(error)
            } else {
                resolve(stdout)
            }
        })
    })
}

const installDependencies = async () => {
    const spinner = ora('📦 Installing project dependencies...').start()
    try {
        await execAsync('npm install')
        spinner.succeed('🎉 Dependencies installed successfully.')
    } catch (error) {
        spinner.fail('❌ Failed to install dependencies.')
        throw error
    }
}

module.exports = { installDependencies }
