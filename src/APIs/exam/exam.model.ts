import mongoose from 'mongoose'
import { IExamRecord, IExamQuestion } from './types/exam.interface'

const questionSchema = new mongoose.Schema<IExamQuestion>(
    {
        number: { type: Number, required: true },
        correctAnswer: { type: String, default: '' },
        studentAnswer: { type: String, default: '' },
        score: { type: String, enum: ['correct', 'partial', 'wrong'], required: true },
        feedback: { type: String, default: '' }
    },
    { _id: false }
)

const examSchema = new mongoose.Schema<IExamRecord>(
    {
        testId: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', required: true },
        studentName: { type: String, required: true, trim: true },
        mode: { type: String, enum: ['handwritten', 'printed'], required: true },
        gradingMode: { type: String, enum: ['answerKey', 'guidedBook'], default: 'answerKey' },
        answerKeyText: { type: String, required: false, default: '' },
        studentPaperText: { type: String, default: '' },
        totalScore: { type: Number, required: true },
        maxScore: { type: Number, required: true },
        percentage: { type: Number, required: true },
        questions: { type: [questionSchema], required: true }
    },
    { timestamps: true }
)

export default mongoose.model<IExamRecord>('ExamRecord', examSchema)
