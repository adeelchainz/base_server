import { IUserWithId } from '../../../user/_shared/types/users.interface'

export interface IResource {
    resourceType: string
    quantity: number
    description?: string
    unit?: string // e.g., kg, liters, pieces, etc.
}

export interface IProject {
    title: string
    description: string
    owner?: IUserWithId['_id']
    creatorName?: string
    creatorEmail: string
    createdBy?: IUserWithId['_id']
    status: {
        startDate?: Date 
        endDate?: Date 
        isActive?: boolean 
        progressPercentage?: number 
    }
    inventory: IResource[]
    createdAt: Date
    updatedAt: Date
}

export interface IProjectWithId extends IProject {
    _id: string
}
