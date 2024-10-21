import { Request } from 'express'
import { IResource } from '../../_shared/types/project.interface'
import { IUserWithId } from '../../../user/_shared/types/users.interface'

// Interface for creating a new project
export interface ICreateProjectRequest {
    title: string
    description: string
    creatorName: string
    creatorEmail: string
    owner: string
    status?: {
        startDate: Date | undefined
        endDate: Date | undefined
        isActive?: boolean
        progressPercentage?: number
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
    title: string
    description: string
    status: {
        startDate: Date
        endDate: Date
        isActive: number
        progressPercentage: number
    }
    inventory: IResource[]
}
export interface IDeleteProjectRequest {
    reason: string
    feedback: string
}

// Interface extending the Express Request for project update
export interface IUpdateProject extends Request {
    body: IUpdateProjectRequest
    params: {
        projectId: string
    }
}

export interface IDeleteProject extends Request {
    body: IDeleteProjectRequest
    params: {
        projectId: string
    }
}

export interface IExtendedRequest extends Request {
    user?: IUserWithId // Assuming the 'user' is of type IUser
}
