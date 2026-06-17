# Exam Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add named tests, per-student tracking, and a results dashboard with class statistics to the homework grader.

**Architecture:** A new `Test` Mongoose model groups `ExamRecord` documents. The grade endpoint resolves or creates a test by ID/name and stores `studentName`. Three new API endpoints expose test lists, per-test results with computed stats, and record editing. The frontend gains a test-selector on the grade page, a `/results` sidebar+panel dashboard, and a `/login` page.

**Tech Stack:** TypeScript, Express, Mongoose 8, Next.js 15, React, Tailwind CSS, Jest + ts-jest

---

## File Map

**Backend — create:**
- `src/APIs/exam/test.model.ts` — Test Mongoose model
- `src/APIs/exam/test.repository.ts` — DB queries: create, findById, listWithCounts, getResults
- `src/__tests__/exam/test-management.spec.ts` — tests for new service behavior

**Backend — modify:**
- `src/APIs/exam/types/exam.interface.ts` — add ITest, ITestWithCount, ITestResults, ITestStats; update IExamRecord
- `src/APIs/exam/exam.model.ts` — add `testId`, `studentName` fields
- `src/APIs/exam/exam.service.ts` — extend gradeExamFiles; add listTests, getTestResults, editExamRecord
- `src/APIs/exam/exam.controller.ts` — add tests, testResults, editRecord handlers
- `src/APIs/exam/index.ts` — add authenticate middleware + 3 new routes

**Frontend — create:**
- `frontend/src/app/login/page.tsx` — login form
- `frontend/src/app/results/page.tsx` — results dashboard (sidebar + panel)

**Frontend — modify:**
- `frontend/src/types/exam.ts` — add TestItem, ExamRecord, TestStats, TestResults
- `frontend/src/app/layout.tsx` — add Grade / Results nav links
- `frontend/src/app/exam/page.tsx` — test selector dropdown + student name input

---

## Task 1: Extend types + create Test model + update ExamRecord model

**Files:**
- Modify: `src/APIs/exam/types/exam.interface.ts`
- Create: `src/APIs/exam/test.model.ts`
- Modify: `src/APIs/exam/exam.model.ts`

- [ ] **Step 1: Replace `src/APIs/exam/types/exam.interface.ts` with the extended version**

```typescript
import { OcrMode } from '../../../services/ocr'
import mongoose from 'mongoose'

export interface ITest {
    _id?: mongoose.Types.ObjectId
    name: string
    createdAt?: Date
}

export interface ITestWithCount extends ITest {
    studentCount: number
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
    answerKeyText: string
    studentPaperText: string
    percentage: number
    createdAt?: Date
}
```

- [ ] **Step 2: Create `src/APIs/exam/test.model.ts`**

```typescript
import mongoose from 'mongoose'
import { ITest } from './types/exam.interface'

const testSchema = new mongoose.Schema<ITest>(
    { name: { type: String, required: true, trim: true } },
    { timestamps: true }
)

export default mongoose.model<ITest>('Test', testSchema)
```

- [ ] **Step 3: Replace `src/APIs/exam/exam.model.ts` to add `testId` and `studentName`**

```typescript
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
        answerKeyText: { type: String, required: true },
        studentPaperText: { type: String, required: true },
        totalScore: { type: Number, required: true },
        maxScore: { type: Number, required: true },
        percentage: { type: Number, required: true },
        questions: { type: [questionSchema], required: true }
    },
    { timestamps: true }
)

export default mongoose.model<IExamRecord>('ExamRecord', examSchema)
```

- [ ] **Step 4: Commit**

```bash
git add src/APIs/exam/types/exam.interface.ts src/APIs/exam/test.model.ts src/APIs/exam/exam.model.ts
git commit -m "feat: add Test model and extend ExamRecord with testId + studentName"
```

---

## Task 2: Create test repository

**Files:**
- Create: `src/APIs/exam/test.repository.ts`

- [ ] **Step 1: Create `src/APIs/exam/test.repository.ts`**

```typescript
import TestModel from './test.model'
import ExamRecord from './exam.model'
import { ITest, ITestWithCount, ITestResults, ITestStats } from './types/exam.interface'

const testRepository = {
    create: async (name: string): Promise<ITest> => {
        const doc = await TestModel.create({ name })
        return doc.toObject() as ITest
    },

    findById: async (id: string): Promise<ITest | null> => {
        return TestModel.findById(id).lean() as Promise<ITest | null>
    },

    listWithCounts: async (): Promise<ITestWithCount[]> => {
        const tests = await TestModel.find().sort({ createdAt: -1 }).lean()
        const counts = await ExamRecord.aggregate<{ _id: string; count: number }>([
            { $group: { _id: '$testId', count: { $sum: 1 } } }
        ])
        const countMap = new Map(counts.map(c => [c._id.toString(), c.count]))
        return tests.map(t => ({
            ...(t as ITest),
            studentCount: countMap.get(t._id!.toString()) ?? 0
        }))
    },

    getResults: async (testId: string): Promise<ITestResults | null> => {
        const test = await TestModel.findById(testId).lean()
        if (!test) return null
        const records = await ExamRecord.find({ testId }).sort({ studentName: 1 }).lean()
        const percentages = records.map(r => r.percentage)
        const stats: ITestStats = percentages.length === 0
            ? { avg: 0, high: 0, low: 0 }
            : {
                avg: Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length),
                high: Math.max(...percentages),
                low: Math.min(...percentages)
            }
        return {
            test: test as ITest,
            stats,
            records: records as unknown as IExamRecord[]
        }
    }
}

export default testRepository
```

- [ ] **Step 2: Commit**

```bash
git add src/APIs/exam/test.repository.ts
git commit -m "feat: add test repository with CRUD and aggregation queries"
```

---

## Task 3: Write failing tests

**Files:**
- Create: `src/__tests__/exam/test-management.spec.ts`

- [ ] **Step 1: Create `src/__tests__/exam/test-management.spec.ts`**

```typescript
import { gradeExamFiles, listTests, getTestResults, editExamRecord } from '../../APIs/exam/exam.service'

jest.mock('../../services/ocr', () => ({
    extractText: jest.fn().mockResolvedValue({ text: 'sample text', confidence: 0.95 })
}))

jest.mock('../../services/grading', () => ({
    gradeExam: jest.fn().mockResolvedValue({
        totalScore: 2,
        maxScore: 3,
        questions: [
            { number: 1, correctAnswer: 'A', studentAnswer: 'A', score: 'correct', feedback: '' },
            { number: 2, correctAnswer: 'B', studentAnswer: 'B', score: 'correct', feedback: '' },
            { number: 3, correctAnswer: 'C', studentAnswer: 'D', score: 'wrong', feedback: 'Wrong' }
        ]
    })
}))

jest.mock('../../handlers/logger', () => ({
    default: { info: jest.fn(), error: jest.fn() }
}))

const mockTestCreate = jest.fn()
const mockTestFindById = jest.fn()
const mockListWithCounts = jest.fn()
const mockGetResults = jest.fn()

jest.mock('../../APIs/exam/test.repository', () => ({
    default: {
        create: (...args: unknown[]) => mockTestCreate(...args),
        findById: (...args: unknown[]) => mockTestFindById(...args),
        listWithCounts: (...args: unknown[]) => mockListWithCounts(...args),
        getResults: (...args: unknown[]) => mockGetResults(...args)
    }
}))

const mockRecordCreate = jest.fn()
const mockRecordFindByIdAndUpdate = jest.fn()

jest.mock('../../APIs/exam/exam.model', () => ({
    default: {
        create: (...args: unknown[]) => mockRecordCreate(...args),
        findByIdAndUpdate: (...args: unknown[]) => mockRecordFindByIdAndUpdate(...args)
    }
}))

const buf = Buffer.from('test')

beforeEach(() => {
    jest.clearAllMocks()
    mockRecordCreate.mockResolvedValue({
        toObject: () => ({
            _id: 'rec-1',
            testId: 'test-id',
            studentName: 'Alice',
            totalScore: 2,
            maxScore: 3,
            percentage: 67,
            questions: []
        })
    })
})

describe('gradeExamFiles with test tracking', () => {
    it('creates a new test when testName is provided', async () => {
        mockTestCreate.mockResolvedValue({ _id: 'new-test-id', name: 'Chapter 5' })

        await gradeExamFiles(buf, buf, 'printed', 'Alice', undefined, 'Chapter 5')

        expect(mockTestCreate).toHaveBeenCalledWith('Chapter 5')
        expect(mockRecordCreate).toHaveBeenCalledWith(
            expect.objectContaining({ studentName: 'Alice', testId: 'new-test-id' })
        )
    })

    it('uses existing testId when provided', async () => {
        mockTestFindById.mockResolvedValue({ _id: 'existing-id', name: 'Midterm' })

        await gradeExamFiles(buf, buf, 'printed', 'Bob', 'existing-id')

        expect(mockTestCreate).not.toHaveBeenCalled()
        expect(mockRecordCreate).toHaveBeenCalledWith(
            expect.objectContaining({ testId: 'existing-id', studentName: 'Bob' })
        )
    })

    it('throws 422 when neither testId nor testName is provided', async () => {
        await expect(gradeExamFiles(buf, buf, 'printed', 'Alice'))
            .rejects.toMatchObject({ statusCode: 422 })
    })

    it('throws 422 when studentName is empty', async () => {
        await expect(gradeExamFiles(buf, buf, 'printed', ''))
            .rejects.toMatchObject({ statusCode: 422 })
    })

    it('throws 404 when testId does not exist', async () => {
        mockTestFindById.mockResolvedValue(null)

        await expect(gradeExamFiles(buf, buf, 'printed', 'Alice', 'bad-id'))
            .rejects.toMatchObject({ statusCode: 404 })
    })
})

describe('listTests', () => {
    it('delegates to testRepository.listWithCounts', async () => {
        const tests = [{ _id: '1', name: 'Quiz', studentCount: 3 }]
        mockListWithCounts.mockResolvedValue(tests)

        const result = await listTests()

        expect(result).toEqual(tests)
    })
})

describe('getTestResults', () => {
    it('returns results when test exists', async () => {
        const payload = {
            test: { _id: '1', name: 'Quiz' },
            stats: { avg: 75, high: 95, low: 55 },
            records: []
        }
        mockGetResults.mockResolvedValue(payload)

        const result = await getTestResults('1')
        expect(result).toEqual(payload)
    })

    it('throws 404 when test not found', async () => {
        mockGetResults.mockResolvedValue(null)

        await expect(getTestResults('bad-id')).rejects.toMatchObject({ statusCode: 404 })
    })
})

describe('editExamRecord', () => {
    const questions = [
        { number: 1, correctAnswer: 'A', studentAnswer: 'A', score: 'correct' as const, feedback: '' },
        { number: 2, correctAnswer: 'B', studentAnswer: 'B', score: 'correct' as const, feedback: '' },
        { number: 3, correctAnswer: 'C', studentAnswer: 'D', score: 'wrong' as const, feedback: 'Wrong' }
    ]

    it('recomputes totalScore/maxScore/percentage and saves', async () => {
        const updated = { _id: 'rec-1', questions, totalScore: 2, maxScore: 3, percentage: 67 }
        mockRecordFindByIdAndUpdate.mockReturnValue({ lean: () => Promise.resolve(updated) })

        const result = await editExamRecord('rec-1', questions)

        expect(mockRecordFindByIdAndUpdate).toHaveBeenCalledWith(
            'rec-1',
            { $set: { questions, totalScore: 2, maxScore: 3, percentage: 67 } },
            { new: true, runValidators: true }
        )
        expect(result).toEqual(updated)
    })

    it('throws 404 when record not found', async () => {
        mockRecordFindByIdAndUpdate.mockReturnValue({ lean: () => Promise.resolve(null) })

        await expect(editExamRecord('rec-1', questions)).rejects.toMatchObject({ statusCode: 404 })
    })
})
```

- [ ] **Step 2: Run tests — verify they FAIL**

```bash
npm test -- --testPathPattern="test-management" --verbose
```

Expected: FAIL — functions `listTests`, `getTestResults`, `editExamRecord` not exported; `gradeExamFiles` missing parameters.

---

## Task 4: Update exam service

**Files:**
- Modify: `src/APIs/exam/exam.service.ts`

- [ ] **Step 1: Replace `src/APIs/exam/exam.service.ts` with the extended version**

```typescript
import { CustomError } from '../../utils/errors'
import { extractText, OcrMode } from '../../services/ocr'
import { gradeExam } from '../../services/grading'
import ExamRecord from './exam.model'
import testRepository from './test.repository'
import { IExamRecord, IExamQuestion, ITestWithCount, ITestResults } from './types/exam.interface'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logger = (require('../../handlers/logger') as { default: typeof import('../../handlers/logger').default }).default

const resolveTestId = async (testId?: string, testName?: string): Promise<string> => {
    if (testId) {
        const test = await testRepository.findById(testId)
        if (!test) throw new CustomError('Test not found', 404)
        return testId
    }
    if (testName?.trim()) {
        const test = await testRepository.create(testName.trim())
        return String(test._id)
    }
    throw new CustomError('Either testId or testName is required', 422)
}

export const gradeExamFiles = async (
    answerKeyBuffer: Buffer,
    studentPaperBuffer: Buffer,
    mode: OcrMode,
    studentName: string,
    testId?: string,
    testName?: string
): Promise<IExamRecord> => {
    if (!studentName?.trim()) throw new CustomError('Student name is required', 422)

    const resolvedTestId = await resolveTestId(testId, testName)

    let answerKeyText: string
    let studentPaperText: string

    try {
        const keyResult = await extractText(answerKeyBuffer, mode)
        answerKeyText = keyResult.text
    } catch (err) {
        logger.error('OCR extraction failed for answer key', { meta: { err } })
        throw new CustomError('Could not extract text from answer key.', 422)
    }

    try {
        const paperResult = await extractText(studentPaperBuffer, mode)
        studentPaperText = paperResult.text
    } catch (err) {
        logger.error('OCR extraction failed for student paper', { meta: { err } })
        throw new CustomError('Could not extract text from student paper.', 422)
    }

    const grading = await gradeExam(answerKeyText, studentPaperText)
    const percentage = grading.maxScore > 0 ? Math.round((grading.totalScore / grading.maxScore) * 100) : 0

    let record
    try {
        record = await ExamRecord.create({
            testId: resolvedTestId,
            studentName: studentName.trim(),
            mode,
            answerKeyText,
            studentPaperText,
            totalScore: grading.totalScore,
            maxScore: grading.maxScore,
            percentage,
            questions: grading.questions
        })
    } catch (err) {
        logger.error('Failed to save exam record', { meta: { err } })
        throw new CustomError('Grading failed — could not save result.', 500)
    }

    return record.toObject() as IExamRecord
}

export const listTests = async (): Promise<ITestWithCount[]> => {
    return testRepository.listWithCounts()
}

export const getTestResults = async (testId: string): Promise<ITestResults> => {
    const results = await testRepository.getResults(testId)
    if (!results) throw new CustomError('Test not found', 404)
    return results
}

const recomputeScores = (questions: IExamQuestion[]) => {
    const maxScore = questions.length
    const totalScore = questions.reduce((sum, q) => {
        if (q.score === 'correct') return sum + 1
        if (q.score === 'partial') return sum + 0.5
        return sum
    }, 0)
    const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0
    return { totalScore, maxScore, percentage }
}

export const editExamRecord = async (recordId: string, questions: IExamQuestion[]): Promise<IExamRecord> => {
    const { totalScore, maxScore, percentage } = recomputeScores(questions)
    const record = await ExamRecord.findByIdAndUpdate(
        recordId,
        { $set: { questions, totalScore, maxScore, percentage } },
        { new: true, runValidators: true }
    ).lean()
    if (!record) throw new CustomError('Record not found', 404)
    return record as unknown as IExamRecord
}
```

- [ ] **Step 2: Run new tests — verify they PASS**

```bash
npm test -- --testPathPattern="test-management" --verbose
```

Expected: 9 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/APIs/exam/exam.service.ts src/__tests__/exam/test-management.spec.ts
git commit -m "feat: extend exam service with test management and record editing"
```

---

## Task 5: Add controller methods + update routes

**Files:**
- Modify: `src/APIs/exam/exam.controller.ts`
- Modify: `src/APIs/exam/index.ts`

- [ ] **Step 1: Replace `src/APIs/exam/exam.controller.ts`**

```typescript
import { NextFunction, Request, Response } from 'express'
import httpResponse from '../../handlers/httpResponse'
import httpError from '../../handlers/errorHandler/httpError'
import asyncHandler from '../../handlers/async'
import { CustomError } from '../../utils/errors'
import { OcrMode } from '../../services/ocr'
import { gradeExamFiles, listTests, getTestResults, editExamRecord } from './exam.service'
import { IExamQuestion } from './types/exam.interface'

export default {
    grade: asyncHandler(async (request: Request, response: Response, next: NextFunction) => {
        try {
            const files = request.files as Record<string, Express.Multer.File[]> | undefined
            const answerKey = files?.['answerKey']?.[0]
            const studentPaper = files?.['studentPaper']?.[0]

            if (!answerKey || !studentPaper) {
                throw new CustomError('Both answer key and student paper files are required.', 422)
            }

            const body = request.body as { mode?: OcrMode; studentName?: string; testId?: string; testName?: string }
            const mode: OcrMode = body.mode ?? 'printed'

            const result = await gradeExamFiles(
                answerKey.buffer,
                studentPaper.buffer,
                mode,
                body.studentName ?? '',
                body.testId,
                body.testName
            )

            httpResponse(response, request, 200, 'Exam graded successfully', result)
        } catch (error) {
            if (error instanceof CustomError) {
                httpError(next, error, request, error.statusCode)
            } else {
                httpError(next, error, request, 500)
            }
        }
    }),

    tests: asyncHandler(async (request: Request, response: Response, next: NextFunction) => {
        try {
            const tests = await listTests()
            httpResponse(response, request, 200, 'Tests retrieved', tests)
        } catch (error) {
            httpError(next, error, request, 500)
        }
    }),

    testResults: asyncHandler(async (request: Request, response: Response, next: NextFunction) => {
        try {
            const { testId } = request.params as { testId: string }
            const results = await getTestResults(testId)
            httpResponse(response, request, 200, 'Test results retrieved', results)
        } catch (error) {
            if (error instanceof CustomError) {
                httpError(next, error, request, error.statusCode)
            } else {
                httpError(next, error, request, 500)
            }
        }
    }),

    editRecord: asyncHandler(async (request: Request, response: Response, next: NextFunction) => {
        try {
            const { recordId } = request.params as { recordId: string }
            const { questions } = request.body as { questions?: IExamQuestion[] }

            if (!Array.isArray(questions) || questions.length === 0) {
                throw new CustomError('questions array is required', 422)
            }

            const updated = await editExamRecord(recordId, questions)
            httpResponse(response, request, 200, 'Record updated', updated)
        } catch (error) {
            if (error instanceof CustomError) {
                httpError(next, error, request, error.statusCode)
            } else {
                httpError(next, error, request, 500)
            }
        }
    })
}
```

- [ ] **Step 2: Replace `src/APIs/exam/index.ts`**

```typescript
import { Router } from 'express'
import examController from './exam.controller'
import upload from '../../middlewares/upload'
import rateLimiter from '../../middlewares/rateLimiter'
import authenticate from '../../middlewares/authenticate'

const router = Router()

router.route('/exam/grade').post(
    authenticate,
    rateLimiter,
    upload.fields([
        { name: 'answerKey', maxCount: 1 },
        { name: 'studentPaper', maxCount: 1 }
    ]),
    examController.grade
)

router.route('/exam/tests').get(authenticate, examController.tests)
router.route('/exam/tests/:testId/results').get(authenticate, examController.testResults)
router.route('/exam/records/:recordId').patch(authenticate, examController.editRecord)

export default router
```

- [ ] **Step 3: Run all tests**

```bash
npm test -- --verbose
```

Expected: 20 existing tests + 9 new tests = 29 tests, all pass.

- [ ] **Step 4: Commit**

```bash
git add src/APIs/exam/exam.controller.ts src/APIs/exam/index.ts
git commit -m "feat: add test list, results, and record edit endpoints"
```

---

## Task 6: Frontend — extend types + update layout nav

**Files:**
- Modify: `frontend/src/types/exam.ts`
- Modify: `frontend/src/app/layout.tsx`

- [ ] **Step 1: Replace `frontend/src/types/exam.ts`**

```typescript
export interface ExamQuestion {
    number: number
    correctAnswer: string
    studentAnswer: string
    score: 'correct' | 'partial' | 'wrong'
    feedback: string
}

export interface GradeResult {
    totalScore: number
    maxScore: number
    percentage: number
    questions: ExamQuestion[]
}

export interface TestItem {
    _id: string
    name: string
    studentCount: number
    createdAt: string
}

export interface ExamRecord {
    _id: string
    studentName: string
    totalScore: number
    maxScore: number
    percentage: number
    questions: ExamQuestion[]
    createdAt: string
}

export interface TestStats {
    avg: number
    high: number
    low: number
}

export interface TestResults {
    test: { _id: string; name: string }
    stats: TestStats
    records: ExamRecord[]
}
```

- [ ] **Step 2: Replace `frontend/src/app/layout.tsx`**

```typescript
import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
    title: 'Homework Grader',
    description: 'Grade student exams with OCR'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body className="bg-[#1a1a2e] text-[#e0e0e0] min-h-screen font-mono">
                <nav className="border-b border-[#16213e] px-4 h-14 flex items-center gap-6">
                    <span className="text-[#4cc9f0] font-bold mr-2">✦ Homework Grader</span>
                    <Link href="/exam" className="text-sm text-[#aaa] hover:text-[#4cc9f0] transition-colors">Grade</Link>
                    <Link href="/results" className="text-sm text-[#aaa] hover:text-[#4cc9f0] transition-colors">Results</Link>
                </nav>
                {children}
            </body>
        </html>
    )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/exam.ts frontend/src/app/layout.tsx
git commit -m "feat: extend frontend exam types and add nav links"
```

---

## Task 7: Frontend — login page

**Files:**
- Create: `frontend/src/app/login/page.tsx`

- [ ] **Step 1: Create `frontend/src/app/login/page.tsx`**

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'

export default function LoginPage() {
    const router = useRouter()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        setLoading(true)
        try {
            await apiFetch('/v1/login', {
                method: 'POST',
                body: JSON.stringify({ email, password })
            })
            router.push('/exam')
        } catch (err) {
            const status = (err as Error & { status?: number }).status
            setError(status === 401 ? 'Invalid email or password' : 'Login failed — try again')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="max-w-sm mx-auto px-4 py-16">
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
                <h1 className="text-lg font-bold text-[#4cc9f0] mb-2">Sign in</h1>
                <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    className="bg-[#16213e] border border-[#4cc9f0]/30 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#4cc9f0]"
                />
                <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    className="bg-[#16213e] border border-[#4cc9f0]/30 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#4cc9f0]"
                />
                {error && <p className="text-[#e94560] text-sm">{error}</p>}
                <button
                    type="submit"
                    disabled={loading}
                    className="bg-[#4cc9f0] text-[#0f0e17] font-semibold py-2 rounded disabled:opacity-40"
                >
                    {loading ? 'Signing in…' : 'Sign in'}
                </button>
            </form>
        </div>
    )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/login/page.tsx
git commit -m "feat: add login page"
```

---

## Task 8: Frontend — update exam page

**Files:**
- Modify: `frontend/src/app/exam/page.tsx`

- [ ] **Step 1: Replace `frontend/src/app/exam/page.tsx`**

```typescript
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { apiUpload, apiFetch } from '@/lib/api'
import ExamResult from '@/components/ExamResult'
import { GradeResult, TestItem } from '@/types/exam'

type OcrMode = 'handwritten' | 'printed'

const ERROR_MESSAGES: Record<number, string> = {
    413: 'File too large — max 10 MB',
    422: 'Could not process files — ensure both are clear and readable',
    503: 'Grading service unavailable — make sure the Python OCR service is running',
    500: 'Grading failed'
}

export default function ExamPage() {
    const router = useRouter()
    const [tests, setTests] = useState<TestItem[]>([])
    const [selectedTestId, setSelectedTestId] = useState<string>('')
    const [newTestName, setNewTestName] = useState<string>('')
    const [studentName, setStudentName] = useState<string>('')
    const [answerKey, setAnswerKey] = useState<File | null>(null)
    const [studentPaper, setStudentPaper] = useState<File | null>(null)
    const [mode, setMode] = useState<OcrMode>('printed')
    const [result, setResult] = useState<GradeResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    const fetchTests = () =>
        apiFetch<TestItem[]>('/v1/exam/tests')
            .then(res => setTests(res.data))
            .catch(err => {
                if ((err as Error & { status?: number }).status === 401) router.push('/login')
            })

    useEffect(() => { fetchTests() }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const isNewTest = selectedTestId === '__new__'
    const canGrade = Boolean(
        (isNewTest ? newTestName.trim() : selectedTestId) &&
        studentName.trim() &&
        answerKey &&
        studentPaper
    )

    async function handleGrade() {
        if (!canGrade || !answerKey || !studentPaper) return
        setError(null)
        setResult(null)
        setLoading(true)

        try {
            const form = new FormData()
            form.append('answerKey', answerKey)
            form.append('studentPaper', studentPaper)
            form.append('mode', mode)
            form.append('studentName', studentName.trim())
            if (isNewTest) {
                form.append('testName', newTestName.trim())
            } else {
                form.append('testId', selectedTestId)
            }

            const res = await apiUpload<GradeResult>('/v1/exam/grade', form)
            setResult(res.data)

            const refreshed = await apiFetch<TestItem[]>('/v1/exam/tests')
            setTests(refreshed.data)

            if (isNewTest) {
                const created = refreshed.data.find(t => t.name === newTestName.trim())
                if (created) { setSelectedTestId(created._id); setNewTestName('') }
            }
        } catch (err) {
            const e = err as Error & { status?: number }
            if (e.status === 401) { router.push('/login'); return }
            const status = e.status ?? 500
            setError(e.message && e.message !== 'Internal Server Error'
                ? e.message
                : (ERROR_MESSAGES[status] ?? ERROR_MESSAGES[500]))
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="max-w-2xl mx-auto px-4 py-8">
            <div className="flex flex-col gap-4">
                {/* Test selector */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs text-[#aaa] uppercase tracking-wide">Test</label>
                    <select
                        value={selectedTestId}
                        onChange={e => setSelectedTestId(e.target.value)}
                        disabled={loading}
                        className="bg-[#16213e] border border-[#4cc9f0]/30 rounded px-3 py-2 text-sm text-[#e0e0e0] focus:outline-none focus:border-[#4cc9f0]"
                    >
                        <option value="">Select a test…</option>
                        {tests.map(t => (
                            <option key={t._id} value={t._id}>{t.name} ({t.studentCount} student{t.studentCount !== 1 ? 's' : ''})</option>
                        ))}
                        <option value="__new__">+ New test…</option>
                    </select>
                    {isNewTest && (
                        <input
                            type="text"
                            placeholder="Test name"
                            value={newTestName}
                            onChange={e => setNewTestName(e.target.value)}
                            disabled={loading}
                            className="bg-[#16213e] border border-[#4cc9f0]/30 rounded px-3 py-2 text-sm text-[#e0e0e0] focus:outline-none focus:border-[#4cc9f0]"
                        />
                    )}
                </div>

                {/* Student name */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs text-[#aaa] uppercase tracking-wide">Student Name</label>
                    <input
                        type="text"
                        placeholder="Student name"
                        value={studentName}
                        onChange={e => setStudentName(e.target.value)}
                        disabled={loading}
                        className="bg-[#16213e] border border-[#4cc9f0]/30 rounded px-3 py-2 text-sm text-[#e0e0e0] focus:outline-none focus:border-[#4cc9f0]"
                    />
                </div>

                {/* Mode selector */}
                <div className="flex gap-2">
                    {(['printed', 'handwritten'] as OcrMode[]).map(m => (
                        <button
                            key={m}
                            onClick={() => setMode(m)}
                            disabled={loading}
                            className={[
                                'px-4 py-1.5 rounded text-sm font-medium transition-colors',
                                mode === m
                                    ? 'bg-[#4cc9f0] text-[#0f0e17]'
                                    : 'bg-[#16213e] text-[#aaa] hover:text-[#4cc9f0]'
                            ].join(' ')}
                        >
                            {m.charAt(0).toUpperCase() + m.slice(1)}
                        </button>
                    ))}
                </div>

                {/* File uploads */}
                <div className="grid grid-cols-2 gap-4">
                    {[
                        { label: 'Answer Key', file: answerKey, set: setAnswerKey },
                        { label: 'Student Paper', file: studentPaper, set: setStudentPaper }
                    ].map(({ label, file, set }) => (
                        <label
                            key={label}
                            className={[
                                'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
                                file ? 'border-[#4cc9f0] bg-[#0f3460]/20' : 'border-[#4cc9f0]/40 hover:border-[#4cc9f0]'
                            ].join(' ')}
                        >
                            <div className="text-2xl mb-2">📄</div>
                            <p className="text-sm text-[#4cc9f0] font-medium mb-1">{label}</p>
                            <p className="text-xs text-[#555] truncate">{file ? file.name : 'Click to upload'}</p>
                            <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/tiff,application/pdf"
                                className="hidden"
                                disabled={loading}
                                onChange={e => set(e.target.files?.[0] ?? null)}
                            />
                        </label>
                    ))}
                </div>

                <button
                    onClick={handleGrade}
                    disabled={!canGrade || loading}
                    className="bg-[#4cc9f0] text-[#0f0e17] font-semibold py-2 px-6 rounded transition-opacity disabled:opacity-40"
                >
                    {loading ? 'Grading…' : 'Grade'}
                </button>

                {error && <p className="text-center text-sm text-[#e94560]">{error}</p>}
                {result && <ExamResult {...result} />}
            </div>
        </div>
    )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/exam/page.tsx
git commit -m "feat: add test selector and student name to exam grader"
```

---

## Task 9: Frontend — results page

**Files:**
- Create: `frontend/src/app/results/page.tsx`

- [ ] **Step 1: Create `frontend/src/app/results/page.tsx`**

```typescript
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { TestItem, TestResults, ExamRecord, ExamQuestion } from '@/types/exam'

const SCORE_CHIP: Record<ExamQuestion['score'], string> = {
    correct: 'bg-[#1a3a2a] text-[#68d391]',
    partial: 'bg-[#3a2e1a] text-[#f6ad55]',
    wrong: 'bg-[#3a1a1a] text-[#fc8181]'
}

const pctColor = (p: number) => p >= 70 ? 'text-[#68d391]' : p >= 50 ? 'text-[#f6ad55]' : 'text-[#fc8181]'

export default function ResultsPage() {
    const router = useRouter()
    const [tests, setTests] = useState<TestItem[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [results, setResults] = useState<TestResults | null>(null)
    const [loadingPanel, setLoadingPanel] = useState(false)
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editQuestions, setEditQuestions] = useState<ExamQuestion[]>([])
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        apiFetch<TestItem[]>('/v1/exam/tests')
            .then(res => {
                setTests(res.data)
                if (res.data.length > 0) setSelectedId(res.data[0]._id)
            })
            .catch(err => {
                if ((err as Error & { status?: number }).status === 401) router.push('/login')
            })
    }, [router])

    useEffect(() => {
        if (!selectedId) return
        setLoadingPanel(true)
        setResults(null)
        apiFetch<TestResults>(`/v1/exam/tests/${selectedId}/results`)
            .then(res => setResults(res.data))
            .finally(() => setLoadingPanel(false))
    }, [selectedId])

    const loadResults = () => {
        if (!selectedId) return
        apiFetch<TestResults>(`/v1/exam/tests/${selectedId}/results`)
            .then(res => setResults(res.data))
    }

    function startEdit(record: ExamRecord) {
        setEditingId(record._id)
        setEditQuestions(record.questions.map(q => ({ ...q })))
        setExpandedId(record._id)
    }

    function cancelEdit() {
        setEditingId(null)
        setEditQuestions([])
    }

    async function saveEdit(recordId: string) {
        setSaving(true)
        try {
            await apiFetch(`/v1/exam/records/${recordId}`, {
                method: 'PATCH',
                body: JSON.stringify({ questions: editQuestions })
            })
            setEditingId(null)
            setEditQuestions([])
            loadResults()
        } finally {
            setSaving(false)
        }
    }

    function updateQ(idx: number, field: keyof ExamQuestion, value: string) {
        setEditQuestions(qs => qs.map((q, i) => i === idx ? { ...q, [field]: value } : q))
    }

    return (
        <div className="flex" style={{ height: 'calc(100vh - 56px)' }}>
            {/* Sidebar */}
            <div className="w-56 flex-shrink-0 border-r border-[#16213e] overflow-y-auto py-2">
                {tests.length === 0 && <p className="text-xs text-[#555] px-4 py-3">No tests yet</p>}
                {tests.map(t => (
                    <button
                        key={t._id}
                        onClick={() => setSelectedId(t._id)}
                        className={[
                            'w-full text-left px-4 py-3 transition-colors border-r-2',
                            selectedId === t._id
                                ? 'bg-[#16213e] border-[#4cc9f0]'
                                : 'border-transparent hover:bg-[#16213e]/40'
                        ].join(' ')}
                    >
                        <p className="text-sm text-[#e0e0e0] truncate">{t.name}</p>
                        <p className="text-xs text-[#555]">{t.studentCount} student{t.studentCount !== 1 ? 's' : ''}</p>
                    </button>
                ))}
            </div>

            {/* Panel */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
                {loadingPanel && <p className="text-sm text-[#aaa]">Loading…</p>}
                {!loadingPanel && !results && !selectedId && (
                    <p className="text-sm text-[#555]">Select a test from the sidebar</p>
                )}

                {results && (
                    <>
                        <h2 className="text-base font-bold text-[#e0e0e0] mb-4">{results.test.name}</h2>

                        {/* Stats bar */}
                        <div className="flex gap-3 mb-6">
                            {[
                                { label: 'Average', value: `${results.stats.avg}%`, color: 'text-[#68d391]' },
                                { label: 'Highest', value: `${results.stats.high}%`, color: 'text-[#4cc9f0]' },
                                { label: 'Lowest', value: `${results.stats.low}%`, color: 'text-[#fc8181]' }
                            ].map(s => (
                                <div key={s.label} className="bg-[#16213e] rounded-lg px-4 py-3 flex-1 text-center">
                                    <p className="text-xs text-[#aaa] mb-1">{s.label}</p>
                                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                                </div>
                            ))}
                        </div>

                        {results.records.length === 0 && (
                            <p className="text-sm text-[#555]">No students graded yet for this test</p>
                        )}

                        {results.records.map((record: ExamRecord) => {
                            const isExpanded = expandedId === record._id
                            const isEditing = editingId === record._id
                            const displayQuestions = isEditing ? editQuestions : record.questions

                            return (
                                <div key={record._id} className="bg-[#16213e] rounded-lg mb-3 overflow-hidden">
                                    {/* Summary row */}
                                    <button
                                        onClick={() => setExpandedId(isExpanded ? null : record._id)}
                                        className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-[#1a2a4a] transition-colors"
                                    >
                                        <span className="text-sm font-medium">{record.studentName}</span>
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm text-[#aaa]">{record.totalScore}/{record.maxScore}</span>
                                            <span className={`text-sm font-bold ${pctColor(record.percentage)}`}>{record.percentage}%</span>
                                            <span className="text-xs text-[#444]">{isExpanded ? '▲' : '▼'}</span>
                                        </div>
                                    </button>

                                    {/* Expanded detail */}
                                    {isExpanded && (
                                        <div className="border-t border-[#0f0e17] px-4 py-3">
                                            {displayQuestions.map((q, idx) => (
                                                <div key={q.number} className="mb-3 last:mb-0">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="text-xs text-[#666]">Q{q.number}</span>
                                                        {isEditing ? (
                                                            <select
                                                                value={editQuestions[idx].score}
                                                                onChange={e => updateQ(idx, 'score', e.target.value)}
                                                                className="bg-[#0f0e17] text-xs rounded px-2 py-0.5 text-[#e0e0e0] border border-[#333]"
                                                            >
                                                                <option value="correct">correct</option>
                                                                <option value="partial">partial</option>
                                                                <option value="wrong">wrong</option>
                                                            </select>
                                                        ) : (
                                                            <span className={`text-xs px-2 py-0.5 rounded ${SCORE_CHIP[q.score]}`}>{q.score}</span>
                                                        )}
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2 text-xs mb-1">
                                                        <div>
                                                            <span className="text-[#4cc9f0]">Correct: </span>
                                                            <span className="text-[#ccc]">{q.correctAnswer || '—'}</span>
                                                        </div>
                                                        <div>
                                                            <span className="text-[#4cc9f0]">Student: </span>
                                                            <span className="text-[#ccc]">{q.studentAnswer || '—'}</span>
                                                        </div>
                                                    </div>
                                                    {isEditing ? (
                                                        <input
                                                            type="text"
                                                            value={editQuestions[idx].feedback}
                                                            onChange={e => updateQ(idx, 'feedback', e.target.value)}
                                                            placeholder="Feedback (optional)"
                                                            className="w-full bg-[#0f0e17] text-xs rounded px-2 py-1 text-[#e0e0e0] border border-[#333] focus:outline-none focus:border-[#4cc9f0]"
                                                        />
                                                    ) : (
                                                        q.feedback && <p className="text-xs text-[#f6ad55]">{q.feedback}</p>
                                                    )}
                                                </div>
                                            ))}

                                            <div className="mt-3 flex gap-2">
                                                {isEditing ? (
                                                    <>
                                                        <button
                                                            onClick={() => saveEdit(record._id)}
                                                            disabled={saving}
                                                            className="px-3 py-1 text-xs bg-[#4cc9f0] text-[#0f0e17] rounded font-medium disabled:opacity-40"
                                                        >
                                                            {saving ? 'Saving…' : 'Save'}
                                                        </button>
                                                        <button
                                                            onClick={cancelEdit}
                                                            disabled={saving}
                                                            className="px-3 py-1 text-xs bg-[#0f0e17] text-[#aaa] rounded"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        onClick={() => startEdit(record)}
                                                        className="px-3 py-1 text-xs text-[#4cc9f0] rounded border border-[#4cc9f0]/30 hover:border-[#4cc9f0] transition-colors"
                                                    >
                                                        Edit
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </>
                )}
            </div>
        </div>
    )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/results/page.tsx
git commit -m "feat: add results dashboard with sidebar, stats, and edit mode"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run all backend tests**

```bash
npm test -- --verbose
```

Expected: 29 tests, all pass (20 existing + 9 new).

- [ ] **Step 2: Verify frontend compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual smoke test**

1. Open `http://localhost:3001` — should redirect to `/ocr`
2. Navigate to `http://localhost:3001/exam` — should redirect to `/login` (not authenticated)
3. Log in at `http://localhost:3001/login`
4. Verify redirect to `/exam`
5. Grade a paper: select "+ New test…", type a test name, enter student name, upload files, click Grade
6. Grade a second paper: dropdown should now show the test created in step 5
7. Navigate to `http://localhost:3001/results` — sidebar shows the test, panel shows both students + stats
8. Expand a student row, click Edit, change a score, click Save — stats update

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete exam dashboard with tests, results, and edit"
```
