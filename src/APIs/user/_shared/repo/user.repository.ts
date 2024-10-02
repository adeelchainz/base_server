import userModel from '../models/user.model'
import { IUser } from '../types/users.interface'

export default {
    findUserByEmail: (email: string, select: string = '') => {
        return userModel.findOne({ email }).select(select)
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
