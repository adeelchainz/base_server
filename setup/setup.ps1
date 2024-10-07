# Enable error handling
$ErrorActionPreference = "Stop"

# Function to display messages in green
function Write-Message {
    param (
        [string]$Message
    )
    Write-Host "`n" -ForegroundColor Green
    Write-Host $Message -ForegroundColor Green
}

# Function to handle errors
function Handle-Error {
    Write-Host "`nError occurred in the script. Exiting." -ForegroundColor Red
    exit 1
}

# Trap unexpected errors
trap {
    Handle-Error
}

# Check for existing .git folder
if (Test-Path ".git") {
    $reinitGit = Read-Host "A .git folder was found. Do you want to reinitialize Git? (y/n)"
    if ($reinitGit -eq 'y' -or $reinitGit -eq 'Y') {
        Write-Message "Removing existing .git folder..."
        Remove-Item -Recurse -Force .git
        Write-Message "Reinitializing Git..."
        git init
    } else {
        Write-Message "Keeping the existing .git folder."
    }
}

# Install dependencies
Write-Message "Installing dependencies..."
npm install

# Create .env files from .env.example
if (Test-Path ".env.example") {
    Copy-Item ".env.example" ".env.development"
    Copy-Item ".env.example" ".env.production"
    Copy-Item ".env.example" ".env.test"
} else {
    Write-Message ".env.example file not found."
    exit 1
}

# Prompt for MongoDB URL
$mongoUrl = Read-Host "Enter your MongoDB URL"

# Add DATABASE_URL to environment files
Add-Content ".env.development" "DATABASE_URL=$mongoUrl"
Add-Content ".env.production" "DATABASE_URL=$mongoUrl"
Add-Content ".env.test" "DATABASE_URL=$mongoUrl"

# Run tests
Write-Message "Running tests..."
npm run test

# Build the project
Write-Message "Building the project..."
npm run build

# Check if the dist folder exists
if (-Not (Test-Path "dist")) {
    Write-Message "'dist' folder was not created."
    exit 1
}

# Lint the code
Write-Message "Linting the code..."
npm run lint

# Ask user for input on how to run the project
$runViaDocker = Read-Host "Do you want to run the project via Docker? (y/n)"

if ($runViaDocker -eq 'y' -or $runViaDocker -eq 'Y') {
    # Check if Docker is installed
    if (-Not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Message "Docker is not installed. Please install Docker to continue."
        exit 1
    }

    # Build Docker image
    Write-Message "Building Docker image..."
    npm run dockerize:dev

    # Run Docker container
    Write-Message "Running Docker container..."
    docker run -d -p 3000:3000 --env-file .env.development base_server:dev
} else {
    # Run the development script directly
    Write-Message "Starting the project directly using the development script..."
    npm run start:dev
}

Write-Message "Node.js project setup completed successfully."
