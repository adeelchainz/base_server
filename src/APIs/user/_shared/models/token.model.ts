import mongoose from 'mongoose'
import { IToken } from '../types/token.interface'

const tokenSchema = new mongoose.Schema<IToken>(
    {
        token: {
            type: String,
            required: true
        }
    },
    { timestamps: true }
)

export default mongoose.model<IToken>('Token', tokenSchema)
