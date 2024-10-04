#!/usr/bin/env node

const fs = require('fs')
const { exec } = require('child_process')
const path = require('path')
const semver = require('semver')
const ora = require('ora')
const inquirer = require('inquirer')
const { SingleBar, Presets } = require('cli-progress')
const chalk = require('chalk') // For colorful output

// Logging levels
const LOG_LEVELS = {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info'
}

// Current log level (adjust this to control the verbosity)
const currentLogLevel = LOG_LEVELS.INFO

// Centralized logging function
const log = (level, message) => {
    const levels = Object.values(LOG_LEVELS)
    if (levels.indexOf(level) <= levels.indexOf(currentLogLevel)) {
        const prefix = level === LOG_LEVELS.ERROR ? chalk.red('❌') : level === LOG_LEVELS.WARN ? chalk.yellow('⚠️') : chalk.blue('ℹ️')
        console.log(`${prefix} ${message}`)
    }
}

// Centralized error logging function
const logError = (error, context = '') => {
    log(LOG_LEVELS.ERROR, `Error occurred${context ? ' in ' + context : ''}:`)
    log(LOG_LEVELS.ERROR, `   Message: ${error.message}`)
    log(LOG_LEVELS.ERROR, `   Stack: ${error.stack}`)
}

// Check the required Node.js version from package.json
const checkNodeVersion = () => {
    const packageJsonPath = path.join(__dirname, 'package.json')
    if (!fs.existsSync(packageJsonPath)) {
        throw new Error('⚠️ package.json not found. Please ensure you are in the project directory.')
    }

    const { engines } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    if (engines && engines.node) {
        const requiredVersion = engines.node
        const currentVersion = process.versions.node

        if (!semver.satisfies(currentVersion, requiredVersion)) {
            throw new Error(`❌ Node.js version ${currentVersion} does not satisfy required version ${requiredVersion}. Please update your Node.js.`)
        }
    }
}

// Array of required packages
const requiredPackages = ['inquirer', 'ora', 'cli-progress']

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
const installRequiredPackages = async () => {
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
                log(LOG_LEVELS.INFO, `Installed ${chalk.cyan(pkg)}`)
            }
            bar.increment() // Increment the progress bar
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

// Function to create env files from .env.example
const createEnvFiles = async () => {
    const envExamplePath = path.join(__dirname, '.env.example')
    const envFiles = ['.env.development', '.env.production', '.env.test']

    const spinner = ora('📝 Creating environment files...').start()
    try {
        for (const envFile of envFiles) {
            await execAsync(`cp ${envExamplePath} ${path.join(__dirname, envFile)}`, 'createEnvFiles')
            log(LOG_LEVELS.INFO, `Created ${chalk.green(envFile)}`)
        }
        spinner.succeed('🎉 Environment files created.')
    } catch (error) {
        spinner.fail('❌ Failed to create environment files.')
        logError(error, 'createEnvFiles')
        throw new Error(error)
    }
}

// Function to install dependencies
const installDependencies = async () => {
    const spinner = ora('📦 Installing dependencies...').start()
    try {
        await execAsync('npm install', 'installDependencies')
        spinner.succeed('🎉 Dependencies installed.')
    } catch (error) {
        spinner.fail('❌ Failed to install dependencies.')
        logError(error, 'installDependencies')
        throw new Error(error)
    }
}

// Function to prompt for MongoDB URL and update env files
const promptMongoDBURL = async () => {
    const { mongoURL } = await inquirer.prompt([
        {
            type: 'input',
            name: 'mongoURL',
            message: '🌐 Enter your MongoDB URL:',
            validate: (input) => {
                const isValid = /^mongodb(?:\+srv)?:\/\/.*$/.test(input)
                return isValid || '⚠️ Please enter a valid MongoDB URL.'
            }
        }
    ])
    const envFiles = ['.env.development', '.env.production', '.env.test']

    for (const file of envFiles) {
        const filePath = path.join(__dirname, file)
        const data = fs.readFileSync(filePath, 'utf-8')
        fs.writeFileSync(filePath, data.replace(/DATABASE_URL=.*/, `DATABASE_URL=${mongoURL}`))
        log(LOG_LEVELS.INFO, `Updated ${chalk.blue(file)} with MongoDB URL.`)
    }
}

// Function to run npm scripts
const runScripts = async (scripts) => {
    const bar = new SingleBar({}, Presets.shades_classic)
    bar.start(scripts.length, 0)

    for (const script of scripts) {
        const spinner = ora(`▶️ Running ${chalk.yellow(script)}...`).start()
        try {
            await execAsync(`npm run ${script}`, `runScripts: ${script}`)
            spinner.succeed(`✅ ${script} completed successfully.`)
        } catch (error) {
            spinner.fail(`❌ Failed to run ${script}.`)
            logError(error, `runScripts: ${script}`)
            bar.stop()
            return false // Indicate failure
        }
        bar.increment() // Increment the progress bar
    }

    bar.stop()
    return true // Indicate success
}

// Function to run build script and check for dist folder
const runBuildAndCheckDist = async () => {
    const spinner = ora('🔨 Running build script...').start()
    try {
        await execAsync('npm run build', 'runBuildAndCheckDist') // Run the build script
        spinner.succeed('🎉 Build completed successfully.')

        // Check if the dist folder exists
        const distPath = path.join(__dirname, 'dist')
        if (fs.existsSync(distPath)) {
            log(LOG_LEVELS.INFO, '📁 The dist folder has been created successfully.')
        } else {
            throw new Error('❌ The dist folder was not created.')
        }
    } catch (error) {
        spinner.fail(`❌ Failed to run build script or check dist folder: ${error.message}`)
        logError(error, 'runBuildAndCheckDist')
        throw new Error(error)
    }
}

// Function to check for Docker and build/run image
const dockerSetup = async () => {
    const spinner = ora('🐳 Checking for Docker...').start()
    try {
        await execAsync('docker --version', 'dockerSetup')
        spinner.succeed('✅ Docker is installed.')

        const buildSpinner = ora('🛠️ Building Docker image...').start()
        await execAsync('docker build -t base-server:dev -f docker/development/Dockerfile .', 'dockerSetup')
        buildSpinner.succeed('🎉 Docker image built successfully.')

        const runSpinner = ora('🚀 Running Docker container...').start()
        await execAsync('docker run -d -p 3000:3000 base-server:dev', 'dockerSetup')
        runSpinner.succeed('🎉 Docker container is running.')
    } catch (error) {
        spinner.fail('❌ Docker is not installed or failed during setup.')
        logError(error, 'dockerSetup')
        throw new Error(error)
    }
}

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

// Main function to run the setup
const runSetup = async () => {
    try {
        checkNodeVersion() // Check Node.js version

        // Prompt user for options
        const { installPackages, createEnv, installDeps, updateMongoDB, runBuild, runDocker } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'installPackages',
                message: '📦 Do you want to install required packages?',
                default: true
            },
            {
                type: 'confirm',
                name: 'createEnv',
                message: '📝 Do you want to create environment files?',
                default: true
            },
            {
                type: 'confirm',
                name: 'installDeps',
                message: '📦 Do you want to install dependencies?',
                default: true
            },
            {
                type: 'confirm',
                name: 'updateMongoDB',
                message: '🌐 Do you want to update MongoDB URL in env files?',
                default: true
            },
            {
                type: 'confirm',
                name: 'runBuild',
                message: '🔨 Do you want to run the build script?',
                default: true
            },
            {
                type: 'confirm',
                name: 'runDocker',
                message: '🐳 Do you want to set up and run Docker?',
                default: true
            }
        ])

        if (installPackages) {
            await installRequiredPackages()
        }

        await initGit()

        if (installDeps) {
            await installDependencies()
        }

        if (createEnv) {
            await createEnvFiles()
        }

        if (updateMongoDB) {
            await promptMongoDBURL()
        }

        const scripts = ['lint', 'test', 'build']
        const scriptsSuccess = await runScripts(scripts)
        if (!scriptsSuccess) {
            log(LOG_LEVELS.ERROR, 'Exiting setup due to failed scripts.')
            process.exit(1)
        }

        if (runBuild) {
            await runBuildAndCheckDist()
        }

        if (runDocker) {
            await dockerSetup()
        } else {
            log(LOG_LEVELS.INFO, '🔄 Running application using npm run dev...')
            await execAsync('npm run dev', 'runSetup') // Run the dev script
        }

        log(LOG_LEVELS.INFO, '🎉 Setup completed successfully.')
    } catch (error) {
        logError(error, 'runSetup')
        log(LOG_LEVELS.ERROR, `❌ Setup failed: ${error.message}`)
        process.exit(1)
    }
}

runSetup()
