import mongoose from 'mongoose'
import { ITest } from './types/exam.interface'

const guidePageSchema = new mongoose.Schema(
    {
        pageNumber: { type: Number, required: true },
        text: { type: String, default: '' },
        source: { type: String, required: true }
    },
    { _id: false }
)

const guideSourceSchema = new mongoose.Schema(
    {
        filename: { type: String, required: true },
        pageCount: { type: Number, required: true }
    },
    { _id: false }
)

const testSchema = new mongoose.Schema<ITest>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        name: { type: String, required: true, trim: true },
        answerKey: { type: Buffer, required: false },
        gradingMode: { type: String, enum: ['answerKey', 'guidedBook'], default: 'answerKey' },
        guidePages: { type: [guidePageSchema], default: [] },
        guideSources: { type: [guideSourceSchema], default: [] }
    },
    { timestamps: true }
)

export default mongoose.model<ITest>('Test', testSchema)
