import userModel from '../models/user.model'
import { IUser } from '../types/users.interface'

export default {
    findUserByEmail: (email: string) => {
        return userModel.findOne({ email })
    },
    createUser: (payload: IUser) => {
        return userModel.create(payload)
    }
}
