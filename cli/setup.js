#!/usr/bin/env node

const { checkNodeVersion } = require('./utils/checks')
const { installDependencies } = require('./utils/dependencies')
const { createEnvFiles } = require('./utils/env')
const { initGit } = require('./utils/git')
const inquirer = require('inquirer')
const chalk = require('chalk')

const checkDependencies = require('./utils/checkDependencies')

// Main setup function
const runSetup = async () => {
    checkNodeVersion()
    await checkDependencies() // Check for required dependencies
    await installDependencies()

    const { createEnv } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'createEnv',
            message: '📝 Do you want to create environment files?',
            default: true
        }
    ])

    if (createEnv) {
        await createEnvFiles()
    }

    await initGit()

    console.log(chalk.green('🎉 Setup completed successfully.'))
}

runSetup().catch((error) => {
    console.error(chalk.red(`❌ Setup failed: ${error.message}`))
    process.exit(1)
})
