# Node.js TypeScript Server Boilerplate

This is a boilerplate for a Node.js server built with TypeScript. It provides essential configurations and tools for building scalable applications, following a feature-based directory structure.

## Features

- **TypeScript**: Provides static typing for improved code quality.
- **Express**: Fast and minimalist web framework for building APIs.
- **ESLint**: Linter to enforce coding standards and catch potential errors.
- **Prettier**: Code formatter to ensure a consistent style.
- **Jest**: Testing framework for writing unit and integration tests.
- **dotenv-flow**: Manages environment variables for different environments seamlessly.
- **Nodemon**: Automatically restarts the server during development.
- **Mongoose**: ODM for MongoDB for easier database interactions.
- **Rate Limiter**: Protects APIs from brute-force attacks.
- **Winston**: Flexible logging library for better log management.

## Getting Started

### Prerequisites

Ensure you have the following installed:

- **Node.js** (v14 or higher)
- **npm** or **yarn**

### Installation

1. **Clone the repository**:

   ```bash
   git clone https://github.com/yourusername/base_server.git
   cd base_server
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

   or

   ```bash
   yarn install
   ```

3. **Create environment files**:

   You need to create separate environment files for development, production, and testing based on the provided examples.

   ```bash
   cp .env.example .env         # Development environment
   cp .env.production.example .env.production  # Production environment
   cp .env.test.example .env.test  # Testing environment
   ```

   Update these files with your specific configurations.

### Scripts

- **Start the server** in development mode:

  ```bash
  npm run start:dev
  ```

  or

  ```bash
  yarn start:dev
  ```

- **Serve the application** in production mode:

  ```bash
  npm run serve
  ```

  or

  ```bash
  yarn serve
  ```

- **Run tests**:

  ```bash
  npm run test
  ```

  or

  ```bash
  yarn test
  ```

- **Run tests in watch mode**:

  ```bash
  npm run watch
  ```

  or

  ```bash
  yarn watch
  ```

- **Run linting**:

  ```bash
  npm run lint
  ```

  or

  ```bash
  yarn lint
  ```

- **Fix linting issues**:

  ```bash
  npm run lint:fix
  ```

  or

  ```bash
  yarn lint:fix
  ```

- **Check code formatting**:

  ```bash
  npm run format:check
  ```

  or

  ```bash
  yarn format:check
  ```

- **Fix code formatting**:

  ```bash
  npm run format:fix
  ```

  or

  ```bash
  yarn format:fix
  ```

- **Build the project** for production:

  ```bash
  npm run build
  ```

  or

  ```bash
  yarn build
  ```

- **Migrate the database** in development mode:

  ```bash
  npm run migrate:dev
  ```

  or

  ```bash
  yarn migrate:dev
  ```

- **Migrate the database** in production mode:

  ```bash
  npm run migrate:prod
  ```

  or

  ```bash
  yarn migrate:prod
  ```

- **Dockerize the application** for development:

  ```bash
  npm run dockerize:dev
  ```

  or

  ```bash
  yarn dockerize:dev
  ```

### Environment Variables

You should configure your environment variables in the respective `.env` files:

- **`.env`**: Used for development.
- **`.env.production`**: Used for production.
- **`.env.test`**: Used for testing.

These files should not be committed to version control. Use the example files as templates.

### Contributing

Contributions are welcome! If you have suggestions for improvements or want to add features, please fork the repository and submit a pull request.

### License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
```

Feel free to adjust any sections or add more details specific to your project!
