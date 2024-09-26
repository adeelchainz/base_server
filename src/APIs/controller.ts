import { NextFunction, Request, Response } from 'express'
import httpResponse from '../handlers/httpResponse'
import responseMessage from '../constant/responseMessage'
import httpError from '../handlers/errorHandler/httpError'
import health from '../utils/health'

export default {
    self: (request: Request, response: Response, next: NextFunction) => {
        try {
            // throw new Error('errors')
            httpResponse(response, request, 200, responseMessage.SUCCESS, null)
        } catch (error) {
            httpError(next, error, request, 500)
        }
    },
    health: (request: Request, response: Response, next: NextFunction) => {
        try {
            const healthData = {
                application: health.getApplicationHealth(),
                system: health.getSystemHealth(),
                timeStamp: Date.now()
            }
            httpResponse(response, request, 200, responseMessage.SUCCESS, healthData)
        } catch (error) {
            httpError(next, error, request, 500)
        }
    }
}
