import joi from 'joi'
import { ICreateProjectRequest, IUpdateProjectRequest } from '../types/functionality.interface'

// Schema for creating a new project
export const createProjectSchema = joi.object<ICreateProjectRequest, true>({
    title: joi.string().min(2).max(100).trim().required(),
    description: joi.string().min(5).max(500).trim().required(),
    creatorName: joi.string().min(2).max(72).trim().optional(),
    creatorEmail: joi.string().email().required(),
    owner: joi
        .string()
        .regex(/^[0-9a-fA-F]{24}$/)
        .optional(), // Validates MongoDB ObjectId
    status: joi
        .object({
            startDate: joi.date().optional(),
            endDate: joi.date().optional(),
            isActive: joi.boolean().optional().default(null),
            progressPercentage: joi.number().min(0).max(100).optional().default(null)
        })
        .optional(),
    inventory: joi
        .array()
        .items(
            joi.object({
                resourceType: joi.string().required(),
                quantity: joi.number().min(0).required(),
                description: joi.string().optional(),
                unit: joi.string().optional()
            })
        )
        .optional()
        .default([])
})

export const confirmProjectSchema = joi.object({
    params: joi.object({
        token: joi.string().required()
    }),
    query: joi.object({
        code: joi.string().required()
    })
})

// Schema for updating a project
export const updateProjectSchema = joi.object<IUpdateProjectRequest, true>({
    title: joi.string().min(2).max(100).trim().optional(),
    description: joi.string().min(5).max(500).trim().optional(),
    status: joi
        .object({
            startDate: joi.date().optional(),
            endDate: joi.date().optional(),
            isActive: joi.boolean().optional().default(null),
            progressPercentage: joi.number().min(0).max(100).optional().default(null)
        })
        .optional(),
    inventory: joi
        .array()
        .items(
            joi.object({
                resourceType: joi.string().required(),
                quantity: joi.number().min(0).required(),
                description: joi.string().required(),
                unit: joi.string().required()
            })
        )
        .required()
})
