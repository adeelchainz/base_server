// import { NextFunction, Request, Response } from 'express'
// import { IAuthenticateRequest, IDecryptedJwt } from '../types/types'
// import jwt from '../utils/jwt'
// import config from '../config/config'
// import query from '../APIs/user/_shared/repo/user.repository'
// import httpError from '../handlers/errorHandler/httpError'
// import responseMessage from '../constant/responseMessage'
// import asyncHandler from '../handlers/async'

// export default asyncHandler(async (request: Request, _response: Response, next: NextFunction) => {
//     try {
//         const req = request as IAuthenticateRequest

//         const { cookies } = req

//         const { accessToken } = cookies as {
//             accessToken: string | undefined
//         }

//         if (accessToken) {
//             const { userId } = jwt.verifyToken(accessToken, config.TOKENS.ACCESS.SECRET) as IDecryptedJwt

//             const user = await query.findUserById(userId)
//             if (user) {
//                 req.authenticatedUser = user
//                 return next()
//             }
//         }
//         httpError(next, new Error(responseMessage.UNAUTHORIZED), request, 401)
//     } catch (error) {
//         httpError(next, error, request, 500)
//     }
// })

import { NextFunction, Request, Response } from 'express'
import { IAuthenticateRequest, IDecryptedJwt } from '../types/types'
import jwt from '../utils/jwt'
import config from '../config/config'
import query from '../APIs/user/_shared/repo/user.repository'
import httpError from '../handlers/errorHandler/httpError'
import responseMessage from '../constant/responseMessage'
import asyncHandler from '../handlers/async'

export default asyncHandler(async (request: Request, _response: Response, next: NextFunction) => {
    try {
        const req = request as IAuthenticateRequest

        const { cookies } = req

        const { accessToken } = cookies as {
            accessToken: string | undefined
        }

        if (accessToken) {
            const { userId } = jwt.verifyToken(accessToken, config.TOKENS.ACCESS.SECRET) as IDecryptedJwt

            const user = await query.findUserById(userId)
            if (user) {
                req.authenticatedUser = user
                req.ownerId = userId
                return next()
            }
        }
        httpError(next, new Error(responseMessage.UNAUTHORIZED), request, 401)
    } catch (error) {
        httpError(next, error, request, 500)
    }
})
