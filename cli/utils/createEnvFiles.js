// createEnvFiles.js

const fs = require('fs')
const path = require('path')

// Define paths for .env and .env.example files
const envExamplePath = path.resolve(__dirname, '../../.env.example')
const envDevPath = path.resolve(__dirname, '../../.env.development')
const envTestPath = path.resolve(__dirname, '../../.env.test')
const envProdPath = path.resolve(__dirname, '../../.env.production')

/**
 * Create environment files from the .env.example file.
 */
const createEnvFiles = async () => {
    try {
        // Check if the .env.example file exists
        if (!fs.existsSync(envExamplePath)) {
            console.error('✖ Error: .env.example file not found. Please ensure it exists in the project root.')
            process.exit(1)
        }

        // Read the content of .env.example
        const envExampleContent = fs.readFileSync(envExamplePath, 'utf-8')

        // Create .env.development file if it doesn't exist
        if (!fs.existsSync(envDevPath)) {
            fs.writeFileSync(envDevPath, envExampleContent)
            console.log('✔ Created .env.development file from .env.example')
        } else {
            console.log('⚠️  Skipped creation of .env.development file: already exists')
        }

        // Create .env.test file if it doesn't exist
        if (!fs.existsSync(envTestPath)) {
            fs.writeFileSync(envTestPath, envExampleContent)
            console.log('✔ Created .env.test file from .env.example')
        } else {
            console.log('⚠️  Skipped creation of .env.test file: already exists')
        }

        // Create .env.production file if it doesn't exist
        if (!fs.existsSync(envProdPath)) {
            fs.writeFileSync(envProdPath, envExampleContent)
            console.log('✔ Created .env.production file from .env.example')
        } else {
            console.log('⚠️  Skipped creation of .env.production file: already exists')
        }

        console.log() // Add a new line for better readability
    } catch (error) {
        console.error(`✖ Error: ${error.message}`)
        process.exit(1)
    }
}

// Export the createEnvFiles function
module.exports = { createEnvFiles }
