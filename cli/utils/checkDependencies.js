const { exec } = require('child_process')
const ora = require('ora')
const inquirer = require('inquirer')
const chalk = require('chalk')

const requiredDependencies = ['inquirer', 'ora', 'cli-progress']

// Function to execute shell commands
const execAsync = (command, context) => {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(`❌ Command failed: ${command}\nError: ${stderr}`)
            } else {
                resolve(stdout)
            }
        })
    })
}

// Function to check and install required packages
const checkDependencies = async () => {
    const missingDeps = []
    for (const dep of requiredDependencies) {
        try {
            require.resolve(dep)
        } catch (e) {
            missingDeps.push(dep)
        }
    }

    if (missingDeps.length > 0) {
        const spinner = ora('🔍 Checking for required dependencies...').start()
        spinner.fail(`❌ Missing dependencies: ${missingDeps.join(', ')}`)
        const { installDeps } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'installDeps',
                message: 'Do you want to install the missing dependencies?',
                default: true
            }
        ])
        if (installDeps) {
            await execAsync(`npm install ${missingDeps.join(' ')}`, 'checkDependencies')
            spinner.succeed('🎉 Missing dependencies have been installed.')
        } else {
            console.log(chalk.red('Installation aborted. Please install the dependencies manually.'))
            process.exit(1)
        }
    } else {
        console.log(chalk.green('✅ All required dependencies are installed.'))
    }
}

module.exports = checkDependencies
