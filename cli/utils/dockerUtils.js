const { execAsync } = require('./packageUtils')
const ora = require('ora')
const { log, logError } = require('./logger')

// Function to check for Docker and build/run the Docker image
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

module.exports = { dockerSetup }
