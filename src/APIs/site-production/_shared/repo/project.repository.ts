import projectModel from '../models/project.model'
import { IProject } from '../types/project.interface'

export default {
    // i will make
    /**
     * find project creator by email
     * find project creator by id
     * find by confirmationTokenAndCode
     * update project
     * delete project
     * create project
     */
    findProjectByEmail: (email: string, select: string = '') => {
        return projectModel.findOne({ creatorEmail: email }).select(select)
    },

    findProjectById: (id: string) => {
        return projectModel.findById(id)
    },

    findProjectByConfirmationTokenAndCode: (token: string, code: string) => {
        return projectModel.findOne({
            'accountConfimation.token': token,
            'accountConfimation.code': code
        })
    },

    updateProject: (id: string, payload: Partial<IProject>) => {
        return projectModel.findByIdAndUpdate(id, payload, { new: true })
    },

    deleteProject: (id: string) => {
        return projectModel.findByIdAndDelete(id)
    },

    createProject: (payload: IProject) => {
        return projectModel.create(payload)
    }
}
