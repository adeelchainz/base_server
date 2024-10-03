import bcrypt from 'bcrypt'

export default {
    hashPassword: (password: string) => {
        return bcrypt.hash(password, 10)
    },
    comparePassword: (attempt: string, existing: string) => {
        return bcrypt.compare(attempt, existing)
    }
}
