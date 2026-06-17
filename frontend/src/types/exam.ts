// frontend/src/types/exam.ts
export type GradingMode = 'answerKey' | 'guidedBook'
export type GuideJobStatus = 'queued' | 'extracting' | 'succeeded' | 'failed'

export interface ExamQuestion {
    number: number
    correctAnswer: string
    studentAnswer: string
    score: 'correct' | 'partial' | 'wrong'
    feedback: string
}

export interface GradeResult {
    testId: string
    gradingMode?: GradingMode
    totalScore: number
    maxScore: number
    percentage: number
    questions: ExamQuestion[]
}

export interface GuideJobPoll {
    status: GuideJobStatus
    progress: { done: number; total: number }
    result?: { pageCount: number; sources: Array<{ filename: string; pageCount: number }> }
    error?: { message: string; filename?: string }
}

export interface TestItem {
    _id: string
    name: string
    studentCount: number
    hasAnswerKey: boolean
    hasGuide: boolean
    gradingMode?: GradingMode
    guideSources?: Array<{ filename: string; pageCount: number }>
    createdAt?: string
}

export interface ExamRecord {
    _id: string
    testId: string
    studentName: string
    gradingMode?: GradingMode
    totalScore: number
    maxScore: number
    percentage: number
    questions: ExamQuestion[]
    createdAt?: string
}

export interface TestStats {
    avg: number
    high: number
    low: number
}

export interface TestResults {
    test: { _id: string; name: string; gradingMode?: GradingMode }
    stats: TestStats
    records: ExamRecord[]
}
