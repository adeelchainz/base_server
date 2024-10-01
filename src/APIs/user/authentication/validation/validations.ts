import responseMessage from '../../../../constant/responseMessage'
import { CustomError } from '../../../../utils/errors'
import query from '../../_shared/repo/user.repository'

export default {
    userAlreadyExistsViaEmail: async (email: string) => {
        const user = await query.findUserByEmail(email)
        if (user) {
            throw new CustomError(responseMessage.auth.ALREADY_EXISTS('user', email), 422)
        }
        return
    }
}
