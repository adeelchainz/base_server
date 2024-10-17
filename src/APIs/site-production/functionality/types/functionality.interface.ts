import { Request } from 'express'
import { IResource } from '../../_shared/types/project.interface'

// Interface for creating a new project
export interface ICreateProjectRequest {
    title: string
    description: string
    creatorName: string
    creatorEmail: string
    owner: string // The ID of the user who owns the project
    status?: {
        startDate: Date
        endDate: Date
        isActive?: { type: boolean; default: null }
        progressPercentage?: { type: number; default: null }
    }
    inventory: IResource[]
}

// Interface extending the Express Request for project creation
export interface ICreateProject extends Request {
    body: ICreateProjectRequest
}

// project confirmation
export interface IConfirmProject extends Request {
    params: {
        token: string
    }
    query: {
        code: string
    }
}

// Interface for updating a project
export interface IUpdateProjectRequest {
    title?: string
    description?: string
    status?: {
        startDate?: Date
        endDate?: Date
        isActive?: { type: boolean; default: null }
        progressPercentage?: { type: number; default: null }
    }
}

// Interface extending the Express Request for project update
export interface IUpdateProject extends Request {
    body: IUpdateProjectRequest
    params: {
        projectId: string
    }
}









