import { NextFunction, Request, Response } from 'express'
import httpResponse from '../../../handlers/httpResponse'
import responseMessage from '../../../constant/responseMessage'
import httpError from '../../../handlers/errorHandler/httpError'
import { createProjectService, confirmProjectService, updateProjectService, deleteProjectService } from './functionality.service'
import { CustomError } from '../../../utils/errors'
import { ICreateProjectRequest, IDeleteProject, IExtendedRequest, IUpdateProject, IUpdateProjectRequest } from './types/functionality.interface'
import { validateSchema } from '../../../utils/joi-validate'
import { createProjectSchema, updateProjectSchema } from './validation/validation.schema'

export default {
    createProject: async (request: IExtendedRequest, response: Response, next: NextFunction) => {
        try {
            const { body } = request as { body: ICreateProjectRequest }

            // Payload validation
            const { error, payload } = validateSchema<ICreateProjectRequest>(createProjectSchema, body)
            if (error) {
                return httpError(next, error, request, 422)
            }
            const ownerId = request.user?._id

            const result = await createProjectService(payload, ownerId)
            httpResponse(response, request, 201, responseMessage.project.CREATED, result)
        } catch (error) {
            if (error instanceof CustomError) {
                httpError(next, error, request, error.statusCode)
            } else {
                httpError(next, error, request, 500)
            }
        }
    },

    confirmProject: async (request: Request, response: Response, next: NextFunction) => {
        try {
            const { params, query } = request
            const { token } = params
            const { code } = query

            const result = await confirmProjectService(token, code as string)
            httpResponse(response, request, 200, responseMessage.project.CONFIRMED, result)
        } catch (error) {
            if (error instanceof CustomError) {
                httpError(next, error, request, error.statusCode)
            } else {
                httpError(next, error, request, 500)
            }
        }
    },

    updateProject: async (request: Request, response: Response, next: NextFunction) => {
        try {
            const { body, params } = request as IUpdateProject

            // verify if project is confirmed
            // const isProjectConfirmed = await validateProjectConfirmationToken(token, code)

            const { error, payload } = validateSchema<IUpdateProjectRequest>(updateProjectSchema, body)
            if (error) {
                return httpError(next, error, request, 422)
            }

            const result = await updateProjectService(params.projectId, payload)
            httpResponse(response, request, 200, responseMessage.project.UPDATED, result)
        } catch (error) {
            if (error instanceof CustomError) {
                httpError(next, error, request, error.statusCode)
            } else {
                httpError(next, error, request, 500)
            }
        }
    },

    deleteProject: async (request: Request, response: Response, next: NextFunction) => {
        try {
            const { params } = request as IDeleteProject

            await deleteProjectService(params.projectId)
            httpResponse(response, request, 200, responseMessage.project.DELETED, null)
        } catch (error) {
            if (error instanceof CustomError) {
                httpError(next, error, request, error.statusCode)
            } else {
                httpError(next, error, request, 500)
            }
        }
    }
}
