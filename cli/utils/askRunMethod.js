const { promisify } = require('util')
const { spawn } = require('child_process')
const path = require('path')

// Log messages with colors
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

// Function to check if Docker is installed
const checkDockerInstallation = async () => {
    try {
        await exec('docker --version') // Check if Docker is installed
        await logMessage('✔ Docker is installed.', 'success')
    } catch (error) {
        await logMessage('✖ Docker is not installed. Please install Docker to proceed.', 'error')
        process.exit(1) // Exit the process if Docker is not installed
    }
}

// ** Helper function to handle readline input as a Promise **
const promptUser = async (query) => {
    const readline = (await import('readline')).default // Dynamically import readline
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        })
        rl.question(query, (answer) => {
            rl.close() // Close readline after response
            resolve(answer)
        })
    })
}

// Function to ask the user whether they want to run via Docker or npm
const askRunMethod = async () => {
    console.log('\n') // Adding some space for better readability
    console.log('Would you like to run the application via Docker or npm?')
    console.log('Type "docker" to run with Docker or "npm" to run with npm.')

    // Prompt the user and wait for the response
    const response = await promptUser('Enter your choice (docker/npm): ')

    if (response.toLowerCase() === 'docker') {
        await runAppViaDocker()
    } else if (response.toLowerCase() === 'npm') {
        await runAppViaNpm()
    } else {
        await logMessage('✖ Invalid choice! Please choose either "docker" or "npm".', 'error')
        process.exit(1) // Exit if an invalid input is given
    }
}

// Function to build and run the app via Docker
const runAppViaDocker = async () => {
    try {
        // Check if Docker is installed
        await checkDockerInstallation()

        // Build Docker image
        await logMessage('Building Docker image for development...', 'info')
        await exec('npm run dockerize:dev') // Keep this as exec since it is a build step
        await logMessage('✔ Docker image built successfully!', 'success')

        // Run the Docker container
        await logMessage('Running the Docker container...', 'info')
        const dockerProcess = spawn('docker-compose', ['up', '-d'], { shell: true, stdio: 'inherit' })

        // No need to call process.exit(0) here, let the process run
        dockerProcess.on('close', (code) => {
            if (code === 0) {
                logMessage('✔ Application is running via Docker!', 'success')
            } else {
                logMessage(`✖ Error running Docker container with exit code ${code}`, 'error')
            }
        })
    } catch (error) {
        await logMessage(`✖ Error running the application via Docker: ${error.message || error}`, 'error')
        process.exit(1) // Exit if an error occurs
    }
}

// Function to run the app via npm
const runAppViaNpm = async () => {
    try {
        await logMessage('Running the application via npm (npm run start:dev)...', 'info')
        const npmProcess = spawn('npm', ['run', 'start:dev'], { shell: true, stdio: 'inherit' })

        // No need to call process.exit(0) here, let the process run
        npmProcess.on('close', (code) => {
            if (code === 0) {
                logMessage('✔ Application is running via npm!', 'success')
            } else {
                logMessage(`✖ Error running npm with exit code ${code}`, 'error')
            }
        })
    } catch (error) {
        await logMessage(`✖ Error running the application via npm: ${error.message || error}`, 'error')
        process.exit(1) // Exit if an error occurs
    }
}

// Start the process by asking the run method
module.exports = { askRunMethod }
