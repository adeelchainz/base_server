import responseMessage from '../../../../constant/responseMessage'
import { CustomError } from '../../../../utils/errors'
import query from '../../_shared/repo/project.repository'
export default {
    // Check if a project already exists by title
    projectAlreadyExistsByTitle: async (title: string) => {
        const project = await query.findProjectByEmail(title)
        if (project) {
            throw new CustomError(responseMessage.project.ALREADY_EXISTS('Project with title', title), 422)
        }
        return
    },

    // Check if a project already exists by creator email
    projectAlreadyExistsByEmail: async (email: string) => {
        const project = await query.findProjectByEmail(email)
        if (project) {
            throw new CustomError(responseMessage.project.ALREADY_EXISTS('Project with creator', email), 422)
        }
        return
    },

    // Check if the project exists by the given ID
    ensureProjectExists: async (projectId: string) => {
        const project = await query.findProjectById(projectId)
        if (!project) {
            throw new CustomError(responseMessage.project.NOT_FOUND('project'), 404)
        }
        return project
    },

    // Check if project confirmation token and code are valid
    validateProjectConfirmationToken: async (token: string, code: string) => {
        const project = await query.findProjectByConfirmationTokenAndCode(token, code)
        if (!project) {
            throw new CustomError(responseMessage.project.INVALID_CONFIRMATION_DETAILS, 400)
        }
        return project
    }
}
