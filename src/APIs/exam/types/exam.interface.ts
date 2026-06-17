import { OcrMode } from '../../../services/ocr'
import mongoose from 'mongoose'

export type GradingMode = 'answerKey' | 'guidedBook'
export type GuideJobStatus = 'queued' | 'extracting' | 'succeeded' | 'failed'

export interface IGuidePage {
    pageNumber: number
    text: string
    source: string
}

export interface IGuideSource {
    filename: string
    pageCount: number
}

export interface IGuideJob {
    jobId: string
    testId: string
    ownerId: string
    status: GuideJobStatus
    progress: { done: number; total: number }
    result?: { pageCount: number; sources: IGuideSource[] }
    error?: { message: string; filename?: string }
    createdAt: number
    updatedAt: number
}

export interface ITest {
    _id?: mongoose.Types.ObjectId
    userId: mongoose.Types.ObjectId | string
    name: string
    answerKey?: Buffer
    gradingMode?: GradingMode
    guidePages?: IGuidePage[]
    guideSources?: IGuideSource[]
    createdAt?: Date
}

export interface ITestWithCount extends Omit<ITest, 'answerKey' | 'guidePages'> {
    studentCount: number
    hasAnswerKey: boolean
    hasGuide: boolean
}

export interface ITestStats {
    avg: number
    high: number
    low: number
}

export interface ITestResults {
    test: ITest
    stats: ITestStats
    records: IExamRecord[]
}

export interface IExamQuestion {
    number: number
    correctAnswer: string
    studentAnswer: string
    score: 'correct' | 'partial' | 'wrong'
    feedback: string
}

export interface IGradingResult {
    totalScore: number
    maxScore: number
    questions: IExamQuestion[]
}

export interface IExamRecord extends IGradingResult {
    _id?: mongoose.Types.ObjectId
    testId: mongoose.Types.ObjectId | string
    studentName: string
    mode: OcrMode
    gradingMode?: GradingMode
    answerKeyText: string
    studentPaperText: string
    percentage: number
    createdAt?: Date
}
