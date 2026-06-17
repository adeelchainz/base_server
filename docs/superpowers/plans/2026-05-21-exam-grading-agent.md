# Exam Grading AI Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `POST /v1/exam/grade` endpoint that OCRs an answer key and student paper, sends both texts to Gemini for grading, saves the result to MongoDB, and displays it on a new `/exam` Next.js page.

**Architecture:** The grading agent lives entirely in the Node.js/Express backend. The existing Python OCR service extracts text from both uploaded files. The Node.js `grading.ts` service calls Gemini's text API (`@google/genai`) with a structured prompt. Results are stored in MongoDB via Mongoose and returned to the React frontend.

**Tech Stack:** Node.js, Express, TypeScript, Mongoose/MongoDB, `@google/genai` (Node SDK), Next.js 15, React 19, Tailwind CSS

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/APIs/exam/types/exam.interface.ts` | Create | Shared TypeScript types |
| `src/APIs/exam/exam.model.ts` | Create | Mongoose schema + model |
| `src/services/grading.ts` | Create | Gemini text API call + JSON parsing |
| `src/__tests__/exam/grading.spec.ts` | Create | Unit tests for grading service |
| `src/APIs/exam/exam.service.ts` | Create | Orchestrates OCR → grade → save |
| `src/APIs/exam/exam.controller.ts` | Create | Request handling |
| `src/APIs/exam/index.ts` | Create | Route registration |
| `src/APIs/index.ts` | Modify | Register exam routes |
| `frontend/src/components/ExamResult.tsx` | Create | Score badge + per-question cards |
| `frontend/src/app/exam/page.tsx` | Create | Exam upload + results page |

---

### Task 1: Install Node SDK and define TypeScript types

**Files:**
- Create: `src/APIs/exam/types/exam.interface.ts`

- [ ] **Step 1: Install `@google/genai` Node.js SDK**

```bash
cd C:\Users\ASSIG\OneDrive\Documents\GitHub\base_server
npm install @google/genai
```

Expected: `added 1 package` (or similar), no errors.

- [ ] **Step 2: Create the types file**

Create `src/APIs/exam/types/exam.interface.ts`:

```typescript
import { OcrMode } from '../../../services/ocr'

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
    mode: OcrMode
    answerKeyText: string
    studentPaperText: string
    percentage: number
}
```

- [ ] **Step 3: Verify TypeScript is happy**

```bash
npx tsc --noEmit
```

Expected: no output (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/APIs/exam/types/exam.interface.ts package.json package-lock.json
git commit -m "feat: add exam types and install @google/genai"
```

---

### Task 2: MongoDB model

**Files:**
- Create: `src/APIs/exam/exam.model.ts`

- [ ] **Step 1: Create the model**

Create `src/APIs/exam/exam.model.ts`:

```typescript
import mongoose from 'mongoose'
import { IExamRecord, IExamQuestion } from './types/exam.interface'

const questionSchema = new mongoose.Schema<IExamQuestion>(
    {
        number: { type: Number, required: true },
        correctAnswer: { type: String, required: true },
        studentAnswer: { type: String, required: true },
        score: { type: String, enum: ['correct', 'partial', 'wrong'], required: true },
        feedback: { type: String, default: '' }
    },
    { _id: false }
)

const examSchema = new mongoose.Schema<IExamRecord>(
    {
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

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/APIs/exam/exam.model.ts
git commit -m "feat: add ExamRecord mongoose model"
```

---

### Task 3: Grading service (TDD)

**Files:**
- Create: `src/services/grading.ts`
- Create: `src/__tests__/exam/grading.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/exam/grading.spec.ts`:

```typescript
// src/__tests__/exam/grading.spec.ts
import { gradeExam } from '../../services/grading'
import { IGradingResult } from '../../APIs/exam/types/exam.interface'

const mockGenerateContent = jest.fn()

jest.mock('@google/genai', () => ({
    GoogleGenAI: jest.fn(() => ({
        models: { generateContent: mockGenerateContent }
    }))
}))

jest.mock('../../handlers/logger', () => ({
    default: { info: jest.fn(), error: jest.fn() }
}))

const validGeminiResponse = {
    totalScore: 3,
    maxScore: 4,
    questions: [
        { number: 1, correctAnswer: 'Paris', studentAnswer: 'Paris', score: 'correct', feedback: '' },
        { number: 2, correctAnswer: 'H2O', studentAnswer: 'H20', score: 'wrong', feedback: 'The formula for water is H2O, not H20.' },
        { number: 3, correctAnswer: 'Newton', studentAnswer: 'Newton', score: 'correct', feedback: '' },
        { number: 4, correctAnswer: '4', studentAnswer: '2', score: 'wrong', feedback: 'Incorrect calculation.' }
    ]
}

describe('gradeExam', () => {
    afterEach(() => jest.clearAllMocks())

    it('returns parsed grading result on valid Gemini response', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            text: JSON.stringify(validGeminiResponse)
        })

        const result: IGradingResult = await gradeExam('answer key text', 'student paper text')

        expect(result.totalScore).toBe(3)
        expect(result.maxScore).toBe(4)
        expect(result.questions).toHaveLength(4)
        expect(result.questions[1].score).toBe('wrong')
        expect(result.questions[1].feedback).toBe('The formula for water is H2O, not H20.')
    })

    it('strips markdown code fences from Gemini response', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            text: '```json\n' + JSON.stringify(validGeminiResponse) + '\n```'
        })

        const result: IGradingResult = await gradeExam('answer key text', 'student paper text')
        expect(result.totalScore).toBe(3)
    })

    it('throws 422 when Gemini returns malformed JSON', async () => {
        mockGenerateContent.mockResolvedValueOnce({ text: 'Not JSON at all' })

        await expect(gradeExam('key', 'paper')).rejects.toMatchObject({
            message: 'Could not identify question structure — ensure the exam is clearly formatted.',
            statusCode: 422
        })
    })

    it('throws 422 when answer key text is empty', async () => {
        await expect(gradeExam('', 'student paper text')).rejects.toMatchObject({
            statusCode: 422
        })
    })

    it('throws 503 when Gemini API call fails', async () => {
        mockGenerateContent.mockRejectedValueOnce(new Error('network error'))

        await expect(gradeExam('key', 'paper')).rejects.toMatchObject({
            statusCode: 503
        })
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="grading" --no-coverage
```

Expected: 5 failures with "Cannot find module '../../services/grading'".

- [ ] **Step 3: Create the grading service**

Create `src/services/grading.ts`:

```typescript
// src/services/grading.ts
import { CustomError } from '../utils/errors'
import { IGradingResult } from '../APIs/exam/types/exam.interface'

// require() bypasses ts-jest's __importDefault wrapping for both logger and genai
// eslint-disable-next-line @typescript-eslint/no-require-imports
const logger = (require('../handlers/logger') as { default: typeof import('../handlers/logger').default }).default
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GoogleGenAI } = require('@google/genai') as typeof import('@google/genai')

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'models/gemini-flash-lite-latest'
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' })

const buildPrompt = (answerKeyText: string, studentPaperText: string): string => `
You are an exam grader. You will be given an answer key and a student's exam paper.

ANSWER KEY:
${answerKeyText}

STUDENT PAPER:
${studentPaperText}

Instructions:
- Match each question in the student paper to the corresponding answer in the key.
- For each question assign a score: "correct", "partial", or "wrong".
- Write a one-sentence feedback explaining any mistake (leave empty string if correct).
- Count totalScore (correct=1, partial=0.5, wrong=0) and maxScore (total questions).

Respond with ONLY valid JSON in this exact shape:
{
  "totalScore": number,
  "maxScore": number,
  "questions": [
    {
      "number": number,
      "correctAnswer": string,
      "studentAnswer": string,
      "score": "correct" | "partial" | "wrong",
      "feedback": string
    }
  ]
}
`.trim()

export const gradeExam = async (answerKeyText: string, studentPaperText: string): Promise<IGradingResult> => {
    if (!answerKeyText.trim()) {
        throw new CustomError('Answer key text is empty — OCR may have failed.', 422)
    }

    let raw: string
    try {
        const response = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: buildPrompt(answerKeyText, studentPaperText)
        })
        raw = response.text ?? ''
    } catch {
        throw new CustomError('Grading service unavailable.', 503)
    }

    // Strip markdown code fences Gemini sometimes adds
    const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

    let parsed: IGradingResult
    try {
        parsed = JSON.parse(cleaned) as IGradingResult
    } catch {
        logger.error('Gemini returned unparseable grading response', { meta: { raw } })
        throw new CustomError(
            'Could not identify question structure — ensure the exam is clearly formatted.',
            422
        )
    }

    logger.info('Exam graded', {
        meta: { totalScore: parsed.totalScore, maxScore: parsed.maxScore, questions: parsed.questions.length }
    })

    return parsed
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="grading" --no-coverage
```

Expected: 5 tests pass.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/services/grading.ts src/__tests__/exam/grading.spec.ts
git commit -m "feat: add grading service with Gemini text API"
```

---

### Task 4: Exam service

**Files:**
- Create: `src/APIs/exam/exam.service.ts`

- [ ] **Step 1: Create the service**

Create `src/APIs/exam/exam.service.ts`:

```typescript
import { CustomError } from '../../utils/errors'
import { extractText, OcrMode } from '../../services/ocr'
import { gradeExam } from '../../services/grading'
import ExamRecord from './exam.model'
import { IExamRecord } from './types/exam.interface'

export const gradeExamFiles = async (
    answerKeyBuffer: Buffer,
    studentPaperBuffer: Buffer,
    mode: OcrMode
): Promise<IExamRecord> => {
    let answerKeyText: string
    let studentPaperText: string

    try {
        const keyResult = await extractText(answerKeyBuffer, mode)
        answerKeyText = keyResult.text
    } catch {
        throw new CustomError('Could not extract text from answer key.', 422)
    }

    try {
        const paperResult = await extractText(studentPaperBuffer, mode)
        studentPaperText = paperResult.text
    } catch {
        throw new CustomError('Could not extract text from student paper.', 422)
    }

    const grading = await gradeExam(answerKeyText, studentPaperText)
    const percentage = grading.maxScore > 0
        ? Math.round((grading.totalScore / grading.maxScore) * 100)
        : 0

    const record = await ExamRecord.create({
        mode,
        answerKeyText,
        studentPaperText,
        totalScore: grading.totalScore,
        maxScore: grading.maxScore,
        percentage,
        questions: grading.questions
    })

    return record.toObject() as IExamRecord
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/APIs/exam/exam.service.ts
git commit -m "feat: add exam service orchestrating OCR and grading"
```

---

### Task 5: Controller and route

**Files:**
- Create: `src/APIs/exam/exam.controller.ts`
- Create: `src/APIs/exam/index.ts`

- [ ] **Step 1: Create the controller**

Create `src/APIs/exam/exam.controller.ts`:

```typescript
import { NextFunction, Request, Response } from 'express'
import httpResponse from '../../handlers/httpResponse'
import httpError from '../../handlers/errorHandler/httpError'
import asyncHandler from '../../handlers/async'
import { CustomError } from '../../utils/errors'
import { OcrMode } from '../../services/ocr'
import { gradeExamFiles } from './exam.service'

export default {
    grade: asyncHandler(async (request: Request, response: Response, next: NextFunction) => {
        try {
            const files = request.files as Record<string, Express.Multer.File[]> | undefined
            const answerKey = files?.['answerKey']?.[0]
            const studentPaper = files?.['studentPaper']?.[0]

            if (!answerKey || !studentPaper) {
                throw new CustomError('Both answer key and student paper files are required.', 422)
            }

            const mode: OcrMode = (request.body as { mode?: OcrMode } | undefined)?.mode ?? 'printed'
            const result = await gradeExamFiles(answerKey.buffer, studentPaper.buffer, mode)

            httpResponse(response, request, 200, 'Exam graded successfully', result)
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

- [ ] **Step 2: Create the route file**

Create `src/APIs/exam/index.ts`:

```typescript
import { Router } from 'express'
import examController from './exam.controller'
import upload from '../../middlewares/upload'
import rateLimiter from '../../middlewares/rateLimiter'

const router = Router()

router.route('/exam/grade').post(
    rateLimiter,
    upload.fields([
        { name: 'answerKey', maxCount: 1 },
        { name: 'studentPaper', maxCount: 1 }
    ]),
    examController.grade
)

export default router
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/APIs/exam/exam.controller.ts src/APIs/exam/index.ts
git commit -m "feat: add exam controller and route"
```

---

### Task 6: Register route in APIs/index.ts

**Files:**
- Modify: `src/APIs/index.ts`

- [ ] **Step 1: Register the exam route**

The current `src/APIs/index.ts` is:

```typescript
import { Application } from 'express'
import { API_ROOT } from '../constant/application'

import General from './router'
import authRoutes from './user/authentication'
import userManagementRoutes from './user/management'
import ocrRoutes from './ocr'

const App = (app: Application) => {
    app.use(`${API_ROOT}`, General)
    app.use(`${API_ROOT}`, authRoutes)
    app.use(`${API_ROOT}/user`, userManagementRoutes)
    app.use(`${API_ROOT}`, ocrRoutes)
}

export default App
```

Update it to:

```typescript
import { Application } from 'express'
import { API_ROOT } from '../constant/application'

import General from './router'
import authRoutes from './user/authentication'
import userManagementRoutes from './user/management'
import ocrRoutes from './ocr'
import examRoutes from './exam'

const App = (app: Application) => {
    app.use(`${API_ROOT}`, General)
    app.use(`${API_ROOT}`, authRoutes)
    app.use(`${API_ROOT}/user`, userManagementRoutes)
    app.use(`${API_ROOT}`, ocrRoutes)
    app.use(`${API_ROOT}`, examRoutes)
}

export default App
```

- [ ] **Step 2: Run full test suite**

```bash
npm test -- --no-coverage
```

Expected: all tests pass (OCR suite + grading suite).

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/APIs/index.ts
git commit -m "feat: register exam route in API router"
```

---

### Task 7: ExamResult frontend component

**Files:**
- Create: `frontend/src/components/ExamResult.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/ExamResult.tsx`:

```typescript
interface Question {
    number: number
    correctAnswer: string
    studentAnswer: string
    score: 'correct' | 'partial' | 'wrong'
    feedback: string
}

interface Props {
    totalScore: number
    maxScore: number
    percentage: number
    questions: Question[]
}

const SCORE_STYLES: Record<Question['score'], string> = {
    correct: 'bg-[#1a3a2a] text-[#68d391]',
    partial: 'bg-[#3a2e1a] text-[#f6ad55]',
    wrong: 'bg-[#3a1a1a] text-[#fc8181]'
}

export default function ExamResult({ totalScore, maxScore, percentage, questions }: Props) {
    return (
        <div className="flex flex-col gap-4">
            <div className="bg-[#16213e] rounded-lg p-4 flex items-center justify-between">
                <span className="text-[#4cc9f0] font-bold text-lg">
                    {totalScore} / {maxScore}
                </span>
                <span className={[
                    'text-sm font-medium px-3 py-1 rounded',
                    percentage >= 70 ? 'bg-[#1a3a2a] text-[#68d391]'
                    : percentage >= 50 ? 'bg-[#3a2e1a] text-[#f6ad55]'
                    : 'bg-[#3a1a1a] text-[#fc8181]'
                ].join(' ')}>
                    {percentage}%
                </span>
            </div>

            {questions.map(q => (
                <div key={q.number} className="bg-[#16213e] rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[#888] text-xs">Question {q.number}</span>
                        <span className={`text-xs rounded px-2 py-0.5 ${SCORE_STYLES[q.score]}`}>
                            {q.score}
                        </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                        <div>
                            <p className="text-[#4cc9f0] text-xs mb-1">Correct answer</p>
                            <p className="text-[#ccc]">{q.correctAnswer}</p>
                        </div>
                        <div>
                            <p className="text-[#4cc9f0] text-xs mb-1">Student answer</p>
                            <p className="text-[#ccc]">{q.studentAnswer || '—'}</p>
                        </div>
                    </div>
                    {q.feedback && (
                        <p className="text-[#f6ad55] text-xs mt-2">{q.feedback}</p>
                    )}
                </div>
            ))}
        </div>
    )
}
```

- [ ] **Step 2: Typecheck frontend**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd ..
git add frontend/src/components/ExamResult.tsx
git commit -m "feat: add ExamResult component"
```

---

### Task 8: Exam page

**Files:**
- Create: `frontend/src/app/exam/page.tsx`

- [ ] **Step 1: Create the page**

Create `frontend/src/app/exam/page.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { apiUpload } from '@/lib/api'
import ExamResult from '@/components/ExamResult'

type OcrMode = 'handwritten' | 'printed'

interface Question {
    number: number
    correctAnswer: string
    studentAnswer: string
    score: 'correct' | 'partial' | 'wrong'
    feedback: string
}

interface GradeResult {
    totalScore: number
    maxScore: number
    percentage: number
    questions: Question[]
}

const ERROR_MESSAGES: Record<number, string> = {
    413: 'File too large — max 10 MB',
    422: 'Could not process files — ensure both are clear and readable',
    503: 'Grading service unavailable — make sure the Python OCR service is running',
    500: 'Grading failed'
}

export default function ExamPage() {
    const [answerKey, setAnswerKey] = useState<File | null>(null)
    const [studentPaper, setStudentPaper] = useState<File | null>(null)
    const [mode, setMode] = useState<OcrMode>('printed')
    const [result, setResult] = useState<GradeResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    async function handleGrade() {
        if (!answerKey || !studentPaper) return
        setError(null)
        setResult(null)
        setLoading(true)

        try {
            const form = new FormData()
            form.append('answerKey', answerKey)
            form.append('studentPaper', studentPaper)
            form.append('mode', mode)
            const res = await apiUpload<GradeResult>('/v1/exam/grade', form)
            setResult(res.data)
        } catch (err) {
            const status = (err as Error & { status?: number }).status ?? 500
            setError(ERROR_MESSAGES[status] ?? ERROR_MESSAGES[500])
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="max-w-2xl mx-auto px-4 py-8">
            <div className="bg-[#16213e] rounded-lg px-4 py-3 mb-6">
                <span className="text-[#4cc9f0] font-bold">✦ Exam Grader</span>
            </div>

            <div className="flex flex-col gap-4">
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
                            <p className="text-xs text-[#555] truncate">
                                {file ? file.name : 'Click to upload'}
                            </p>
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
                    disabled={!answerKey || !studentPaper || loading}
                    className="bg-[#4cc9f0] text-[#0f0e17] font-semibold py-2 px-6 rounded transition-opacity disabled:opacity-40"
                >
                    {loading ? 'Grading...' : 'Grade'}
                </button>

                {error && <p className="text-center text-sm text-[#e94560]">{error}</p>}
                {result && <ExamResult {...result} />}
            </div>
        </div>
    )
}
```

- [ ] **Step 2: Typecheck frontend**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd ..
git add frontend/src/app/exam/page.tsx
git commit -m "feat: add exam grading page"
```

---

### Task 9: End-to-end smoke test

- [ ] **Step 1: Ensure all services are running**

- Python OCR service: `python trocr/trocr_service.py` (port 5001)
- Backend: `npm run dev` (port 3000)
- Frontend: `cd frontend && npm run dev` (port 3001)

- [ ] **Step 2: Run full test suite**

```bash
npm test -- --no-coverage
```

Expected: all tests pass.

- [ ] **Step 3: Hit the endpoint directly with curl**

```powershell
# Create two test images first (or use any PNG/JPG you have)
# Then:
$boundary = "----TestBoundary"
# Use Invoke-WebRequest or Postman to POST to http://localhost:3000/v1/exam/grade
# with fields: answerKey (file), studentPaper (file), mode=printed
```

Expected: `200` response with `{ success: true, data: { totalScore, maxScore, percentage, questions: [...] } }`

- [ ] **Step 4: Open the frontend**

Navigate to `http://localhost:3001/exam`. Upload an answer key and a student paper. Click Grade. Verify the score badge and per-question breakdown appear.

- [ ] **Step 5: Final commit and push**

```bash
git push
```
