import { NextFunction, Request, Response } from 'express'
import httpResponse from '../../../handlers/httpResponse'
import responseMessage from '../../../constant/responseMessage'
import httpError from '../../../handlers/errorHandler/httpError'
import { IRegister, IRegisterRequest } from './types/authentication.interface'
import { validateSchema } from '../../../utils/joi-validate'
import { registerSchema } from './validation/validation.schema'
import { registrationService } from './authentication.service'
import { CustomError } from '../../../utils/errors'

export default {
    register: async (request: Request, response: Response, next: NextFunction) => {
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
    }
}
