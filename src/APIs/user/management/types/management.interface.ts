import { IUser } from '../../_shared/types/users.interface'

export interface IMyUser extends Request {
    authenticatedUser: IUser
}
