import jwt from 'jsonwebtoken'

export default {
    generateToken: (payload: object, secret: string, expiry: number) => {
        return jwt.sign(payload, secret, { expiresIn: expiry })
    }
}
