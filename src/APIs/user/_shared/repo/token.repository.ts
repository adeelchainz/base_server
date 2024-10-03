import tokenModel from '../models/token.model'
import { IToken } from '../types/token.interface'

export default {
    createToken: (payload: IToken) => {
        return tokenModel.create(payload)
    },
    deleteToken: (token: string) => {
        return tokenModel.deleteOne({ token: token })
    }
}
