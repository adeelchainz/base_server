import userModel from '../models/user.model'
import { IUser } from '../types/users.interface'

export default {
    findUserByEmail: (email: string) => {
        return userModel.findOne({ email })
    },
    findUserByConfirmationTokenAndCode: (token: string, code: string) => {
        return userModel.findOne({
            'accountConfimation.token': token,
            'accountConfimation.code': code
        })
    },
    createUser: (payload: IUser) => {
        return userModel.create(payload)
    }
}
