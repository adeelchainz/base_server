const fs = require('fs')
const { exec } = require('child_process')
const inquirer = require('inquirer')
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

const initGit = async () => {
    if (fs.existsSync(path.join(__dirname, '..', '.git'))) {
        const { initNewRepo } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'initNewRepo',
                message: '🔄 A .git folder already exists. Do you want to initialize a fresh Git repository?',
                default: false
            }
        ])
        if (initNewRepo) {
            await execAsync('rm -rf .git')
            await execAsync('git init')
            console.log('🎉 Initialized a fresh Git repository.')
        }
    } else {
        await execAsync('git init')
        console.log('🎉 Initialized a new Git repository.')
    }
}

module.exports = { initGit }
