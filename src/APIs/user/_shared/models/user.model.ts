import mongoose from 'mongoose'
import { IUser } from '../types/users.interface'
import { EUserRoles } from '../../../../constant/users'

const userSchema = new mongoose.Schema<IUser>(
    {
        name: {
            type: String,
            minlength: 2,
            maxlength: 72,
            required: true
        },
        email: {
            type: String,
            unique: true,
            required: true
        },
        phoneNumber: {
            _id: false,
            isoCode: { type: String, default: '' },
            countryCode: { type: String, default: '' },
            internationalNumber: { type: String, default: '' }
        },
        timezone: { type: String, default: '' },
        password: {
            type: String,
            required: true,
            select: false
        },
        role: {
            type: String,
            default: EUserRoles.USER,
            enum: EUserRoles,
            required: true
        },
        accountConfirmation: {
            _id: false,
            status: {
                type: Boolean,
                default: false,
                required: true
            },
            token: {
                type: String,
                required: true
            },
            code: {
                type: String,
                required: true
            },
            timestamp: {
                type: Date,
                default: null
            }
        },
        passwordReset: {
            _id: false,
            token: {
                type: String,
                default: null
            },
            expiry: {
                type: Number,
                default: null
            },
            lastResetAt: {
                type: Date,
                default: null
            }
        },
        lastLoginAt: {
            type: Date,
            default: null
        },
        consent: {
            type: Boolean,
            required: true
        }
    },
    { timestamps: true }
)

export default mongoose.model<IUser>('User', userSchema)
