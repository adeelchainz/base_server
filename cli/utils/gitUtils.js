const fs = require('fs')
const { execAsync } = require('./packageUtils')
const inquirer = require('inquirer')
const { log } = require('./logger')

// Function to initialize Git if .git folder exists
const initGit = async () => {
    if (fs.existsSync(path.join(__dirname, '.git'))) {
        const { initNewRepo } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'initNewRepo',
                message: '🔄 A .git folder already exists. Do you want to initialize a fresh Git repository?',
                default: false
            }
        ])
        if (initNewRepo) {
            await execAsync('rm -rf .git', 'initGit')
            await execAsync('git init', 'initGit')
            log(LOG_LEVELS.INFO, '🎉 Initialized a fresh Git repository.')
        }
    }
}

module.exports = { initGit }
