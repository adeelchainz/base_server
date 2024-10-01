import { Request } from 'express'

export interface IRegisterRequest {
    name: string
    email: string
    phoneNumber: string
    password: string
    consent: boolean
}

export interface IRegister extends Request {
    body: IRegisterRequest
}

export interface IConfirmRegistration extends Request {
    params: {
        token: string
    }
    query: {
        code: string
    }
}
