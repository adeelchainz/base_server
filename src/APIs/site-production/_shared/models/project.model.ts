import mongoose, { Schema } from 'mongoose'
import { IProject, IResource } from '../types/project.interface'

const resourceSchema = new Schema<IResource>(
    {
        resourceType: {
            type: String,
            required: true
        },
        quantity: {
            type: Number,
            required: true,
            min: 0
        },
        description: {
            type: String,
            default: null
        },
        unit: {
            type: String,
            default: null
        }
    },
    { _id: false }
)

const projectSchema = new Schema<IProject>(
    {
        title: {
            type: String,
            required: true,
            minlength: 2,
            maxlength: 100
        },
        description: {
            type: String,
            required: true,
            minlength: 5,
            maxlength: 500
        },
        owner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        creatorName: {
            type: String,
            minlength: 2,
            maxlength: 72,
            default: null
        },
        creatorEmail: {
            type: String,
            required: true
        },

        status: {
            _id: false,
            startDate: {
                type: Date,
                default: null
            },
            endDate: {
                type: Date,
                default: null
            },
            isActive: {
                type: Boolean,
                default: true
            },
            progressPercentage: {
                type: Number,
                required: true,
                min: 0,
                max: 100
            }
        },
        createdAt: {
            type: Date,
            default: Date.now,
            immutable: true
        },
        updatedAt: {
            type: Date,
            default: Date.now
        },
        inventory: { type: [resourceSchema], default: [] }
    },
    {
        timestamps: true
    }
)

export default mongoose.model<IProject>('Project', projectSchema)
