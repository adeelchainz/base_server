import responseMessage from '../../../constant/responseMessage'
import { ICreateProjectRequest, IUpdateProjectRequest } from './types/functionality.interface'
import { CustomError } from '../../../utils/errors'
import projectRepository from '../_shared/repo/project.repository'
import dayjs from 'dayjs'
import emailService from '../../../services/email'
import logger from '../../../handlers/logger'
import validation from './validation/validation'

// Service for creating a new project
export const createProjectService = async (payload: ICreateProjectRequest, ownerId: string | undefined) => {
    const { title, description, creatorName, creatorEmail, status, inventory } = payload

    // Validate if a project already exists with the same title or creator email
    await validation.projectAlreadyExistsByTitle(title)
    await validation.projectAlreadyExistsByEmail(creatorEmail)

    const projectObj = {
        title,
        description,
        creatorName,
        creatorEmail,
        owner: ownerId,
        status: {
            startDate: status?.startDate ?? undefined,
            endDate: status?.endDate ?? undefined,
            isActive: status?.isActive !== undefined && typeof status.isActive === 'boolean' ? status.isActive : true,
            progressPercentage: status?.progressPercentage ?? 0
        },
        inventory: inventory || [],
        createdAt: dayjs().utc().toDate(),
        updatedAt: dayjs().utc().toDate()
    }

    // Adding project to the database
    const newProject = await projectRepository.createProject(projectObj)

    // Sending confirmation email
    const confirmationURL = `FrontendHost/project-confirmation/${newProject._id}`
    const to = [creatorEmail]
    const subject = `Project Created Successfully`
    const text = `Hello ${creatorName}, your project titled "${title}" has been successfully created.\n\nConfirm the project by visiting: ${confirmationURL}`

    emailService.sendEmail(to, subject, text).catch((error) => {
        logger.error('Error sending email', {
            meta: error
        })
    })

    return {
        success: true,
        projectId: newProject._id
    }
}

// Service for confirming a project
export const confirmProjectService = async (token: string, code: string) => {
    const project = await validation.validateProjectConfirmationToken(token, code)

    // Check if project is already confirmed
    if (project.status.isActive) {
        throw new CustomError(responseMessage.project.ALREADY_CONFIRMED('Project'), 400)
    }

    // Confirm the project
    project.status.isActive = true
    project.status.startDate = dayjs().utc().toDate()

    await project.save()

    // Sending confirmation email
    const to = [project.creatorEmail]
    const subject = `Project Confirmation Successful`
    const text = `Your project titled "${project.title}" has been successfully confirmed.`

    emailService.sendEmail(to, subject, text).catch((error) => {
        logger.error('Error sending email', {
            meta: error
        })
    })

    return {
        success: true,
        projectId: project._id
    }
}

export const updateProjectService = async (projectId: string, payload: IUpdateProjectRequest) => {
    // Validate if project exists
    await validation.ensureProjectExists(projectId)

    // Ensure the status field is compatible with IProject
    const updatedStatus = payload.status
        ? {
              startDate: payload.status.startDate,
              endDate: payload.status.endDate,
              isActive: typeof payload.status.isActive === 'boolean' ? payload.status.isActive : undefined,
              progressPercentage: typeof payload.status.progressPercentage === 'number' ? payload.status.progressPercentage : undefined
          }
        : undefined

    // Update project details
    const updatedProject = await projectRepository.updateProject(projectId, {
        ...payload,
        status: updatedStatus, // Ensure status matches the expected type
        updatedAt: dayjs().utc().toDate()
    })

    return {
        success: true,
        project: updatedProject
    }
}

// Service for deleting a project
export const deleteProjectService = async (projectId: string) => {
    // Validate if project exists
    await validation.ensureProjectExists(projectId)

    // Delete the project
    await projectRepository.deleteProject(projectId)

    return {
        success: true,
        message: responseMessage.project.DELETED
    }
}
