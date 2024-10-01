import { NextFunction, Request, Response } from 'express'
import httpResponse from '../../../handlers/httpResponse'
import responseMessage from '../../../constant/responseMessage'
import httpError from '../../../handlers/errorHandler/httpError'
import { IConfirmRegistration, IRegister, IRegisterRequest } from './types/authentication.interface'
import { validateSchema } from '../../../utils/joi-validate'
import { registerSchema } from './validation/validation.schema'
import { accountConfirmationService, registrationService } from './authentication.service'
import { CustomError } from '../../../utils/errors'
import asyncHandler from '../../../handlers/async'

export default {
    register: asyncHandler(async (request: Request, response: Response, next: NextFunction) => {
        try {
            const { body } = request as IRegister

            //Payload validation
            const { error, payload } = validateSchema<IRegisterRequest>(registerSchema, body)
            if (error) {
                return httpError(next, error, request, 422)
            }

            const registrationResult = await registrationService(payload)
            if (registrationResult.success === true) {
                httpResponse(response, request, 201, responseMessage.auth.USER_REGISTERED, registrationResult)
            }
        } catch (error) {
            if (error instanceof CustomError) {
                httpError(next, error, request, error.statusCode)
            } else {
                httpError(next, error, request, 500)
            }
        }
    }),
    confirmRegistration: asyncHandler(async (request: Request, response: Response, next: NextFunction) => {
        try {
            const { params, query } = request as IConfirmRegistration

            const { token } = params
            const { code } = query

            const user = await accountConfirmationService(token, code)

            httpResponse(response, request, 201, responseMessage.auth.USER_REGISTERED, user)
        } catch (error) {
            if (error instanceof CustomError) {
                httpError(next, error, request, error.statusCode)
            } else {
                httpError(next, error, request, 500)
            }
        }
    })
}
