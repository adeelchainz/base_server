import bcrypt from 'bcrypt'

export default {
    hashPassword: (password: string) => {
        return bcrypt.hash(password, 10)
    }
}
