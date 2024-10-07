---
runme:
  id: 01J99RK58N5XZY395QV3CH9S69
  version: v3
---

# API Development Process Document

## Table of Contents

1. [Overview](#overview)
2. [Directory Structure](#directory-structure)
3. [Components](#components)
   - [Index (Routes)](#index-routes)
   - [Controller](#controller)
   - [Service](#service)
   - [Repository](#repository)
   - [Model](#model)
   - [Validation](#validation)
   - [Interfaces, Types, and Enums](#interfaces-types-and-enums)
4. [Example API Development](#example-api-development)

## Overview

This document outlines the steps and best practices for developing a feature-based RESTful API in TypeScript. Each component plays a critical role in maintaining a modular and organized codebase.

## Directory Structure

```
/src
  ├── features
  │   ├── user
  │   │   ├── controllers
  │   │   │   └── userController.ts
  │   │   ├── services
  │   │   │   └── userService.ts
  │   │   ├── repositories
  │   │   │   └── userRepository.ts
  │   │   ├── models
  │   │   │   └── userModel.ts
  │   │   ├── validations
  │   │   │   └── userValidation.ts
  │   │   ├── types.ts
  │   │   └── index.ts
  └── index.ts
```

## Components

### Index (Routes)

The **Index (Routes)** file defines the API endpoints and connects them to their respective controllers.

#### Example (user/index.ts)

```typescript
import express from 'express';
import { createUser, getUser } from './controllers/userController';

const router = express.Router();

router.post('/', createUser);
router.get('/:id', getUser);

export default router;
```

### Controller

The **Controller** handles incoming requests and outgoing responses. It calls the service layer to perform business logic.

#### Example (user/controllers/userController.ts)

```typescript
import { Request, Response } from 'express';
import { createUserService, getUserService } from '../services/userService';
import { UserInput } from '../types';

export const createUser = async (req: Request<{}, {}, UserInput>, res: Response) => {
  try {
    const user = await createUserService(req.body);
    res.status(201).json(user);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const getUser = async (req: Request<{ id: string }>, res: Response) => {
  try {
    const user = await getUserService(req.params.id);
    if (user) {
      res.status(200).json(user);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
```

### Service

The **Service** layer contains the business logic. It interacts with the repository layer to fetch or modify data.

#### Example (user/services/userService.ts)

```typescript
import { User } from '../models/userModel';
import { createUserRepo, getUserRepo } from '../repositories/userRepository';
import { UserInput } from '../types';

export const createUserService = async (userData: UserInput) => {
  const user = new User(userData);
  return await createUserRepo(user);
};

export const getUserService = async (id: string) => {
  return await getUserRepo(id);
};
```

### Repository

The **Repository** layer interacts directly with the database. It performs CRUD operations and abstracts data access.

#### Example (user/repositories/userRepository.ts)

```typescript
import { User } from '../models/userModel';

export const createUserRepo = async (user: User) => {
  return await user.save(); // Assuming mongoose is used
};

export const getUserRepo = async (id: string) => {
  return await User.findById(id);
};
```

### Model

The **Model** represents the data structure and schema for your entities. It defines how data is stored in the database.

#### Example (user/models/userModel.ts)

```typescript
import mongoose, { Schema, Document } from 'mongoose';
import { UserRole } from '../types';

export interface User extends Document {
  username: string;
  email: string;
  password: string;
  role: UserRole; // Example for using enums
}

const userSchema: Schema = new Schema({
  username: { type: String, required: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String, enum: Object.values(UserRole), default: UserRole.USER },
});

export const User = mongoose.model<User>('User', userSchema);
```

### Validation

The **Validation** layer ensures that incoming data meets specific criteria before it is processed.

#### Example (user/validations/userValidation.ts)

```typescript
import Joi from 'joi';
import { UserInput } from '../types';

export const userValidationSchema = Joi.object<UserInput>({
  username: Joi.string().required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
});

// Usage in controller
// const { error } = userValidationSchema.validate(req.body);
```

### Interfaces, Types, and Enums

This section defines common types, interfaces, and enums to standardize the API.

#### Example (user/types.ts)

```typescript
export interface UserInput {
  username: string;
  email: string;
  password: string;
}

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
}
```

## Example API Development

### Step 1: Define Requirements

Identify the requirements for the API, such as endpoints, data structure, and business logic.

### Step 2: Create the Model

Define the data schema using the Model component.

### Step 3: Set Up the Repository

Implement data access methods in the Repository layer.

### Step 4: Implement Service Logic

Add business logic in the Service layer, calling repository methods as needed.

### Step 5: Build the Controller

Create routes in the Index (Routes) and link them to service methods.

### Step 6: Validate Input

Use the Validation layer to ensure incoming requests are valid.

### Step 7: Test the API

Run tests to ensure that the API behaves as expected.

---

By following this structured approach, you can create a well-organized and maintainable API that adheres to best practices and standards in TypeScript. This modular architecture allows for easier updates and scalability as your application grows.