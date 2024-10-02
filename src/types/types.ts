import { Request } from 'express'
import { IUser } from '../APIs/user/_shared/types/users.interface'
import { JwtPayload } from 'jsonwebtoken'

export type THttpResponse = {
    success: boolean
    statusCode: number
    request: {
        ip?: string | null
        method: string
        url: string
    }
    message: string
    data: unknown
}

export type THttpError = {
    success: boolean
    statusCode: number
    request: {
        ip?: string | null
        method: string
        url: string
    }
    message: string
    data: unknown
    trace?: object | null
}

export interface IAuthenticateRequest extends Request {
    authenticatedUser: IUser
}

export interface IDecryptedJwt extends JwtPayload {
    userId: string
}
