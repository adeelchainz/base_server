#!/bin/bash

# Enable error handling
set -e

# Function to display messages in green color
function echo_message {
    printf "\n\033[1;32m%s\033[0m\n" "$1"
}

# Function to handle errors
function handle_error {
    echo -e "\n\033[1;31mError occurred in the script. Exiting.\033[0m"
    exit 1
}

# Trap unexpected errors
trap 'handle_error' ERR

# Check for existing .git folder
if [ -d ".git" ]; then
    read -p "A .git folder was found. Do you want to reinitialize Git? (y/n): " reinit_git
    if [[ "$reinit_git" =~ ^[Yy]$ ]]; then
        echo_message "Removing existing .git folder..."
        rm -rf .git
        echo_message "Reinitializing Git..."
        git init
    else
        echo_message "Keeping the existing .git folder."
    fi
fi

# Install dependencies
echo_message "Installing dependencies..."
npm install

# Create .env files from .env.example
if [ -f ".env.example" ]; then
    cp .env.example .env.development
    cp .env.example .env.production
    cp .env.example .env.test
else
    echo_message ".env.example file not found."
    exit 1
fi

# Prompt for MongoDB URL
read -p "Enter your MongoDB URL: " mongo_url

# Add DATABASE_URL to environment files
echo "DATABASE_URL=$mongo_url" >> .env.development
echo "DATABASE_URL=$mongo_url" >> .env.production
echo "DATABASE_URL=$mongo_url" >> .env.test

# Run tests
echo_message "Running tests..."
npm run test

# Build the project
echo_message "Building the project..."
npm run build

# Check if the dist folder exists
if [ ! -d "dist" ]; then
    echo_message "'dist' folder was not created."
    exit 1
fi

# Lint the code
echo_message "Linting the code..."
npm run lint

# Ask user for input
read -p "Do you want to run the project via Docker? (y/n): " run_via_docker

if [[ "$run_via_docker" =~ ^[Yy]$ ]]; then
    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        echo_message "Docker is not installed. Please install Docker to continue."
        exit 1
    fi

    # Build Docker image
    echo_message "Building Docker image..."
    npm run dockerize:dev

    # Run Docker container
    echo_message "Running Docker container..."
    docker run -d -p 3000:3000 --env-file .env.development base_server:dev
else
    # Run the development script directly
    echo_message "Starting the project directly using the development script..."
    npm run start:dev
fi

echo_message "Node.js project setup completed successfully."
