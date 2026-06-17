# Book-Guided Grading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow teachers to upload PDF reference books as the answer source for a test; the grading agent extracts text, retrieves relevant pages per question by keyword scoring, and grades student papers against that reference material.

**Architecture:** New `gradingMode` field on Test selects between existing answer-key flow and a new guided-book flow. Guide PDFs are extracted by TrOCR (PyMuPDF + Tesseract, no Gemini) and stored as flat `guidePages` arrays on the Test document. Grading branches in the service layer: guided mode runs local keyword extraction → IDF-weighted page retrieval → single batched Gemini grading call. A background job store (in-memory Map) makes guide upload non-blocking.

**Tech Stack:** Node/TypeScript (Express, Mongoose, ts-jest), Python/Flask (PyMuPDF/fitz, Tesseract/pytesseract), Google Gemini API (`@google/genai`), Next.js 14 App Router, Multer.

**Spec:** `docs/superpowers/specs/book-guided-grading-design-v3.1.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/services/grading.ts` | Modify | Export `hardenGradingJson`, `parseKeywordMap`, `getAI`; add Node backoff |
| `src/APIs/exam/types/exam.interface.ts` | Modify | Add `IGuidePage`, `IGuideSource`, `GradingMode`, `IGuideJob`, `GuideJobStatus`; extend `ITest`, `ITestWithCount`, `IExamRecord` |
| `src/APIs/exam/test.model.ts` | Modify | Add `gradingMode`, `guidePages`, `guideSources` fields |
| `src/APIs/exam/exam.model.ts` | Modify | Change `answerKeyText` to `required: false, default: ''`; add `gradingMode` |
| `src/APIs/exam/test.repository.ts` | Modify | Add `hasGuide` to `listWithCounts`; add `saveGuidePages`, `getGuidePages` |
| `src/services/guideJobs.ts` | **Create** | In-memory job store with TTL sweep and one-active-per-test guard |
| `src/services/guidedGrading.ts` | **Create** | Steps 2–4: local keyword extraction, IDF page scoring, context trim, Gemini grading call |
| `src/services/ocr.ts` | Modify | Add `AbortController` timeout to `extractText`; add `extractGuidePages` |
| `src/middlewares/guideUpload.ts` | **Create** | Route-scoped multer: 50 MB/file, PDF-only, max 10 files |
| `src/APIs/exam/exam.service.ts` | Modify | Branch `gradeExamFiles` on `gradingMode`; add `startGuideUpload`, `getGuideJobStatus` |
| `src/APIs/exam/exam.controller.ts` | Modify | Add `uploadGuide`, `pollGuideJob` handlers |
| `src/APIs/exam/index.ts` | Modify | Wire two new routes |
| `trocr/trocr_service.py` | Modify | Env-driven `TESSERACT_CMD`; new `/extract-guide` route |
| `trocr/requirements.txt` | Modify | Remove `pandas>=3.0` |
| `frontend/src/types/exam.ts` | Modify | Add `GradingMode`, `GuideJobStatus`, `GuideJobPoll`; extend `TestItem`, `GradeResult` |
| `frontend/src/lib/api.ts` | Modify | Add `uploadGuides`, `pollGuideJob` |
| `frontend/src/app/exam/page.tsx` | Modify | Mode toggle, guide uploader, job polling, 3-state Grade button |
| `frontend/src/components/ExamResult.tsx` | Modify | Grading-source badge |
| `src/__tests__/services/grading.test.ts` | **Create** | `hardenGradingJson` unit tests; existing `gradeExam` smoke test |
| `src/__tests__/services/guidedGrading.test.ts` | **Create** | Keyword extraction, page scoring, context trim, `gradeExamGuided` integration test |
| `src/__tests__/services/guideJobs.test.ts` | **Create** | Job store: create, update, one-active-per-test |

---

## Task 0: Extract grading helpers + add Node backoff

**Files:**
- Modify: `src/services/grading.ts`
- Create: `src/__tests__/services/grading.test.ts`

- [ ] **Step 1: Write failing tests for `hardenGradingJson`**

Create `src/__tests__/services/grading.test.ts`:

```ts
// src/__tests__/services/grading.test.ts
jest.mock('@google/genai', () => ({ GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: jest.fn() } })) }))
jest.mock('../../handlers/logger', () => ({ default: { info: jest.fn(), error: jest.fn() } }))

import { hardenGradingJson, parseKeywordMap } from '../../services/grading'
import { CustomError } from '../../utils/errors'

describe('hardenGradingJson', () => {
    it('parses valid grading JSON', () => {
        const raw = JSON.stringify({
            totalScore: 2, maxScore: 3,
            questions: [
                { number: 1, correctAnswer: 'A', studentAnswer: 'A', score: 'correct', feedback: '' },
                { number: 2, correctAnswer: 'B', studentAnswer: 'C', score: 'wrong', feedback: 'Wrong choice' },
                { number: 3, correctAnswer: 'D', studentAnswer: 'D', score: 'partial', feedback: '' }
            ]
        })
        const result = hardenGradingJson(raw)
        expect(result.totalScore).toBe(1.5)
        expect(result.maxScore).toBe(3)
        expect(result.questions).toHaveLength(3)
    })

    it('strips markdown code fences', () => {
        const raw = '```json\n{"totalScore":1,"maxScore":1,"questions":[{"number":1,"correctAnswer":"X","studentAnswer":"X","score":"correct","feedback":""}]}\n```'
        expect(() => hardenGradingJson(raw)).not.toThrow()
    })

    it('throws 422 on invalid JSON', () => {
        expect(() => hardenGradingJson('not json')).toThrow(CustomError)
    })

    it('throws 422 on empty questions array', () => {
        expect(() => hardenGradingJson('{"totalScore":0,"maxScore":0,"questions":[]}')).toThrow(CustomError)
    })

    it('normalises unknown score to "wrong"', () => {
        const raw = JSON.stringify({
            totalScore: 0, maxScore: 1,
            questions: [{ number: 1, correctAnswer: 'A', studentAnswer: 'B', score: 'invalid', feedback: '' }]
        })
        const result = hardenGradingJson(raw)
        expect(result.questions[0].score).toBe('wrong')
    })
})

describe('parseKeywordMap', () => {
    it('parses valid keyword map', () => {
        const raw = '{"1":["mitochondria","ATP"],"2":["photosynthesis"]}'
        expect(parseKeywordMap(raw)).toEqual({ '1': ['mitochondria', 'ATP'], '2': ['photosynthesis'] })
    })

    it('returns empty object on bad JSON', () => {
        expect(parseKeywordMap('not json')).toEqual({})
    })

    it('strips code fences', () => {
        const raw = '```json\n{"1":["cell"]}\n```'
        expect(parseKeywordMap(raw)).toEqual({ '1': ['cell'] })
    })
})
```

- [ ] **Step 2: Run tests — expect failures**

```
npx jest src/__tests__/services/grading.test.ts --no-coverage
```

Expected: FAIL — `hardenGradingJson` and `parseKeywordMap` are not exported yet.

- [ ] **Step 3: Refactor `grading.ts` — extract helpers, export `getAI`, add backoff**

Replace the entire file content:

```ts
// src/services/grading.ts
import { CustomError } from '../utils/errors'
import { IExamQuestion, IGradingResult } from '../APIs/exam/types/exam.interface'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logger = (require('../handlers/logger') as { default: typeof import('../handlers/logger').default }).default
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GoogleGenAI } = require('@google/genai') as typeof import('@google/genai')

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'models/gemini-flash-lite-latest'
const TRANSIENT_SIGNALS = ['RESOURCE_EXHAUSTED', 'UNAVAILABLE', '429', '503']

let _ai: InstanceType<typeof GoogleGenAI> | null = null
export const getAI = (): InstanceType<typeof GoogleGenAI> => {
    if (!_ai) _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' })
    return _ai
}

// ── Shared helpers ────────────────────────────────────────────────────────────

export const hardenGradingJson = (raw: string): IGradingResult => {
    const cleaned = raw
        .replace(/^```(?:json)?\n?/i, '')
        .replace(/\n?```$/i, '')
        .trim()

    let parsed: IGradingResult
    try {
        parsed = JSON.parse(cleaned) as IGradingResult
    } catch {
        logger.error('Gemini returned unparseable grading response', { meta: { raw } })
        throw new CustomError('Could not identify question structure — ensure the exam is clearly formatted.', 422)
    }

    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
        logger.error('Gemini returned structurally invalid grading response', { meta: { raw } })
        throw new CustomError('Could not identify question structure — ensure the exam is clearly formatted.', 422)
    }

    const VALID_SCORES = new Set<IExamQuestion['score']>(['correct', 'partial', 'wrong'])
    const questions: IExamQuestion[] = parsed.questions.map((q, i) => {
        const r = q as unknown as Record<string, unknown>
        const rawScore = String(r.score ?? '')
        return {
            number: typeof r.number === 'number' ? r.number : i + 1,
            correctAnswer: String(r.correctAnswer ?? r.correct_answer ?? ''),
            studentAnswer: String(r.studentAnswer ?? r.student_answer ?? ''),
            score: (VALID_SCORES.has(rawScore as IExamQuestion['score']) ? rawScore : 'wrong') as IExamQuestion['score'],
            feedback: String(r.feedback ?? '')
        }
    })

    const scoreMap: Record<string, number> = { correct: 1, partial: 0.5, wrong: 0 }
    const totalScore = questions.reduce((sum, q) => sum + (scoreMap[q.score] ?? 0), 0)
    const maxScore = questions.length
    return { ...parsed, totalScore, maxScore, questions }
}

export const parseKeywordMap = (raw: string): Record<string, string[]> => {
    const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
    try {
        const parsed = JSON.parse(cleaned) as Record<string, string[]>
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
        return parsed
    } catch {
        return {}
    }
}

export const callGeminiWithBackoff = async (prompt: string): Promise<string> => {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await getAI().models.generateContent({ model: GEMINI_MODEL, contents: prompt })
            return response.text ?? ''
        } catch (e) {
            const msg = String(e)
            if (TRANSIENT_SIGNALS.some(s => msg.includes(s)) && attempt < 2) {
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
                continue
            }
            throw new CustomError('Grading service unavailable.', 503)
        }
    }
    throw new CustomError('Grading service unavailable.', 503)
}

// ── Answer-key grading (unchanged signature) ──────────────────────────────────

const buildPrompt = (answerKeyText: string, studentPaperText: string, mode: 'printed' | 'handwritten'): string =>
    `
You are an exam grader. You will be given an answer key and a student's exam paper.

ANSWER KEY:
${answerKeyText}

STUDENT PAPER:
${studentPaperText}

Instructions:
- Include EVERY question from the answer key — do not skip any.
- For each question, copy the student's answer verbatim. If the student left a question blank, wrote nothing, or the paper was blank, use an empty string "" for studentAnswer and mark it "wrong".
- Do NOT infer, guess, or fabricate answers. Only use text actually written or marked by the student.${mode === 'printed' ? '\n- IMPORTANT: The student paper text was extracted by OCR from a printed exam sheet, so it includes pre-printed question text and answer choices. Only treat text as a student answer if it is a clearly marked choice (circled letter, filled bubble) or a written response — not just pre-printed options. If you cannot identify any student-marked answers, mark every question wrong with empty studentAnswer.' : ''}
- Assign a score: "correct", "partial", or "wrong".
- Write a one-sentence feedback explaining any mistake (use empty string "" if correct).
- totalScore: correct=1, partial=0.5, wrong=0. maxScore = total number of questions.

Respond with ONLY valid JSON — no markdown, no explanation:
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

export const gradeExam = async (
    answerKeyText: string,
    studentPaperText: string,
    mode: 'printed' | 'handwritten' = 'printed'
): Promise<IGradingResult> => {
    if (!answerKeyText.trim()) {
        throw new CustomError('Answer key text is empty — OCR may have failed.', 422)
    }

    const resolvedStudentText = studentPaperText.trim()
        ? studentPaperText
        : '[BLANK PAPER — student submitted no handwritten answers. Mark every question wrong with empty studentAnswer.]'

    const raw = await callGeminiWithBackoff(buildPrompt(answerKeyText, resolvedStudentText, mode))

    if (!raw.trim()) {
        throw new CustomError('Grading service returned an empty response.', 503)
    }

    const result = hardenGradingJson(raw)
    logger.info('Exam graded', { meta: { totalScore: result.totalScore, maxScore: result.maxScore, questions: result.maxScore } })
    return result
}
```

- [ ] **Step 4: Run tests — expect pass**

```
npx jest src/__tests__/services/grading.test.ts --no-coverage
```

Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```
git add src/services/grading.ts src/__tests__/services/grading.test.ts
git commit -m "refactor: extract hardenGradingJson/parseKeywordMap, add Node-side Gemini backoff"
```

---

## Task 1: Types and interfaces

**Files:**
- Modify: `src/APIs/exam/types/exam.interface.ts`

- [ ] **Step 1: Replace file with extended interfaces**

```ts
// src/APIs/exam/types/exam.interface.ts
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: no new errors (existing errors, if any, stay the same — this step only adds fields).

- [ ] **Step 3: Commit**

```
git add src/APIs/exam/types/exam.interface.ts
git commit -m "feat: add guided grading types (GradingMode, IGuidePage, IGuideJob, IGuideSource)"
```

---

## Task 2: Test model schema

**Files:**
- Modify: `src/APIs/exam/test.model.ts`

- [ ] **Step 1: Add `gradingMode`, `guidePages`, `guideSources` to schema**

```ts
// src/APIs/exam/test.model.ts
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
```

- [ ] **Step 2: Verify compile**

```
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```
git add src/APIs/exam/test.model.ts
git commit -m "feat: add gradingMode, guidePages, guideSources to Test schema"
```

---

## Task 3: ExamRecord schema fix + `gradingMode` field

**Files:**
- Modify: `src/APIs/exam/exam.model.ts`

- [ ] **Step 1: Change `answerKeyText` to optional; add `gradingMode`**

```ts
// src/APIs/exam/exam.model.ts
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
```

- [ ] **Step 2: Compile**

```
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```
git add src/APIs/exam/exam.model.ts
git commit -m "fix: answerKeyText optional in ExamRecord, add gradingMode field"
```

---

## Task 4: Repository — `hasGuide` + atomic guide helpers

**Files:**
- Modify: `src/APIs/exam/test.repository.ts`

- [ ] **Step 1: Replace file with extended repository**

```ts
// src/APIs/exam/test.repository.ts
import mongoose from 'mongoose'
import TestModel from './test.model'
import ExamRecord from './exam.model'
import { ITest, ITestWithCount, ITestResults, ITestStats, IExamRecord, IGuidePage, IGuideSource } from './types/exam.interface'

const testRepository = {
    create: async (name: string, userId: string): Promise<ITest> => {
        const doc = await TestModel.create({ name, userId })
        return doc.toObject() as ITest
    },

    findById: async (id: string, userId: string): Promise<ITest | null> => {
        return TestModel.findOne({ _id: id, userId }).lean() as Promise<ITest | null>
    },

    listWithCounts: async (userId: string): Promise<ITestWithCount[]> => {
        const tests = await TestModel.find({ userId }).select('-answerKey -guidePages').sort({ createdAt: -1 }).lean()
        const testIds = tests.map((t) => t._id)

        const counts = await ExamRecord.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
            { $match: { testId: { $in: testIds } } },
            { $group: { _id: '$testId', count: { $sum: 1 } } }
        ])
        const countMap = new Map(counts.map((c) => [c._id.toString(), c.count]))

        const withKeys = await TestModel.find({ userId, answerKey: { $exists: true } }).select('_id').lean()
        const keySet = new Set(withKeys.map((t) => t._id?.toString() ?? ''))

        const withGuides = await TestModel.find({ userId, 'guidePages.0': { $exists: true } }).select('_id').lean()
        const guideSet = new Set(withGuides.map((t) => t._id?.toString() ?? ''))

        return tests.map((t) => ({
            ...t,
            studentCount: countMap.get(t._id?.toString() ?? '') ?? 0,
            hasAnswerKey: keySet.has(t._id?.toString() ?? ''),
            hasGuide: guideSet.has(t._id?.toString() ?? '')
        }))
    },

    saveAnswerKey: async (id: string, userId: string, buffer: Buffer): Promise<void> => {
        await TestModel.updateOne({ _id: id, userId }, { $set: { answerKey: buffer } })
    },

    getAnswerKey: async (id: string, userId: string): Promise<Buffer | null> => {
        const doc = await TestModel.findOne({ _id: id, userId }).select('answerKey').lean()
        return doc?.answerKey ?? null
    },

    // Atomic swap: set guidedBook mode + pages in one write, clear answerKey
    saveGuidePages: async (id: string, userId: string, pages: IGuidePage[], sources: IGuideSource[]): Promise<void> => {
        await TestModel.updateOne(
            { _id: id, userId },
            { $set: { gradingMode: 'guidedBook', guidePages: pages, guideSources: sources }, $unset: { answerKey: '' } }
        )
    },

    getGuidePages: async (id: string, userId: string): Promise<{ pages: IGuidePage[]; gradingMode: string } | null> => {
        const doc = await TestModel.findOne({ _id: id, userId }).select('guidePages gradingMode').lean()
        if (!doc) return null
        return { pages: (doc.guidePages ?? []) as IGuidePage[], gradingMode: doc.gradingMode ?? 'answerKey' }
    },

    getResults: async (testId: string, userId: string): Promise<ITestResults | null> => {
        const test = await TestModel.findOne({ _id: testId, userId }).lean()
        if (!test) return null
        const records = await ExamRecord.find({ testId }).sort({ studentName: 1 }).lean()
        const percentages = records.map((r) => r.percentage)
        const stats: ITestStats =
            percentages.length === 0
                ? { avg: 0, high: 0, low: 0 }
                : {
                      avg: Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length),
                      high: Math.max(...percentages),
                      low: Math.min(...percentages)
                  }
        return { test: test as ITest, stats, records: records as IExamRecord[] }
    }
}

export default testRepository
```

- [ ] **Step 2: Compile**

```
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```
git add src/APIs/exam/test.repository.ts
git commit -m "feat: add hasGuide to listWithCounts, saveGuidePages, getGuidePages to repository"
```

---

## Task 5: TrOCR `/extract-guide` route + ops fixes

**Files:**
- Modify: `trocr/trocr_service.py`
- Modify: `trocr/requirements.txt`

- [ ] **Step 1: Remove `pandas` from requirements**

Edit `trocr/requirements.txt` — remove the `pandas>=3.0` line:

```
flask
pytesseract
pymupdf
google-genai
python-dotenv
Pillow
numpy
# PyTorch GPU (only needed if you re-add EasyOCR):
# pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
```

- [ ] **Step 2: Make `tesseract_cmd` env-driven**

Find line 23 in `trocr/trocr_service.py`:
```python
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
```

Replace with:
```python
TESSERACT_CMD = os.environ.get('TESSERACT_CMD', r'C:\Program Files\Tesseract-OCR\tesseract.exe')
pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD
```

- [ ] **Step 3: Add `/extract-guide` route at the end of `trocr_service.py` (before `if __name__ == '__main__'`)**

```python
@app.route('/extract-guide', methods=['POST'])
def extract_guide():
    start = time.time()
    file = request.files.get('pdf')
    if not file:
        return jsonify({'error': 'No PDF provided'}), 422

    raw = file.read()
    filename = file.filename or 'guide.pdf'

    try:
        doc = fitz.open(stream=raw, filetype='pdf')
    except Exception as e:
        return jsonify({'error': f'Could not open PDF "{filename}": {e}'}), 422

    pages = []
    for page_num, page in enumerate(doc, start=1):
        text = page.get_text().strip()
        if len(text) < 50:
            # Scanned page fallback: render and run Tesseract
            try:
                pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
                pil_img = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
                text = pytesseract.image_to_string(preprocess(pil_img), config='--psm 3').strip()
            except Exception:
                text = ''
        pages.append({'pageNumber': page_num, 'text': text, 'source': filename})
    doc.close()

    readable_count = sum(1 for p in pages if p['text'])
    if readable_count == 0:
        return jsonify({'error': f'No readable text found in "{filename}"'}), 422

    return jsonify({
        'pages': pages,
        'pageCount': len(pages),
        'readableCount': readable_count,
        'processingTimeMs': int((time.time() - start) * 1000)
    })
```

- [ ] **Step 4: Manual smoke test — restart the TrOCR service and verify**

With TrOCR running (`py trocr/trocr_service.py`), test with any small PDF:

```
curl -X POST http://localhost:5001/extract-guide -F "pdf=@path/to/any.pdf" | python -m json.tool
```

Expected: `{ "pages": [...], "pageCount": N, "readableCount": M, "processingTimeMs": ... }`

- [ ] **Step 5: Commit**

```
git add trocr/trocr_service.py trocr/requirements.txt
git commit -m "feat: add /extract-guide route to TrOCR; env-driven TESSERACT_CMD; remove pandas"
```

---

## Task 6: OCR service — timeout + guide client

**Files:**
- Modify: `src/services/ocr.ts`

- [ ] **Step 1: Replace `ocr.ts` with timeout + `extractGuidePages`**

```ts
// src/services/ocr.ts
import { CustomError } from '../utils/errors'
import { IGuidePage } from '../APIs/exam/types/exam.interface'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logger = (require('../handlers/logger') as { default: typeof import('../handlers/logger').default }).default

const TROCR_URL = process.env.TROCR_URL ?? 'http://localhost:5001'
const EXTRACT_TIMEOUT_MS = 120_000   // 2 min for student paper / answer key
const GUIDE_TIMEOUT_MS   = 300_000   // 5 min for guide PDF (may have scanned pages)

export type OcrMode = 'handwritten' | 'printed'

export interface IOcrResult {
    text: string
    confidence: number
    processingTimeMs: number
    pipeline: string
}

export interface IOcrBatchItem extends IOcrResult {
    originalname: string
    index: number
}

export type DocumentType = 'answer_key' | 'student_paper'

export const extractText = async (
    imageBuffer: Buffer,
    mode: OcrMode = 'handwritten',
    documentType: DocumentType = 'student_paper'
): Promise<IOcrResult> => {
    const form = new FormData()
    form.append('image', new Blob([imageBuffer]), 'image.bin')
    form.append('mode', mode)
    form.append('documentType', documentType)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS)

    let response: Response
    try {
        response = await fetch(`${TROCR_URL}/extract`, { method: 'POST', body: form, signal: controller.signal })
    } catch {
        throw new CustomError('OCR service unavailable', 503)
    } finally {
        clearTimeout(timer)
    }

    if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new CustomError(body.error ?? `OCR service error (${response.status})`, response.status === 422 ? 422 : 500)
    }

    const data = (await response.json()) as {
        text: string; confidence: number; processingTimeMs: number; pipeline: string
    }

    logger.info('OCR extraction complete', {
        meta: { confidence: data.confidence, pipeline: data.pipeline, processingTimeMs: data.processingTimeMs, mode }
    })

    return { text: data.text, confidence: data.confidence, processingTimeMs: data.processingTimeMs, pipeline: data.pipeline }
}

export const extractGuidePages = async (pdfBuffer: Buffer, filename: string): Promise<IGuidePage[]> => {
    const form = new FormData()
    form.append('pdf', new Blob([pdfBuffer]), filename)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), GUIDE_TIMEOUT_MS)

    let response: Response
    try {
        response = await fetch(`${TROCR_URL}/extract-guide`, { method: 'POST', body: form, signal: controller.signal })
    } catch {
        throw new CustomError('OCR service unavailable', 503)
    } finally {
        clearTimeout(timer)
    }

    if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new CustomError(body.error ?? `Guide extraction error (${response.status})`, response.status === 422 ? 422 : 500)
    }

    const data = (await response.json()) as { pages: IGuidePage[] }
    return data.pages
}

export const extractBatch = async (
    files: Array<{ buffer: Buffer; originalname: string }>,
    mode: OcrMode = 'handwritten'
): Promise<IOcrBatchItem[]> => {
    const results = await Promise.all(
        files.map(async ({ buffer, originalname }, index) => {
            const result = await extractText(buffer, mode)
            return { ...result, originalname, index }
        })
    )
    return results.sort((a, b) => a.index - b.index)
}
```

- [ ] **Step 2: Compile**

```
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```
git add src/services/ocr.ts
git commit -m "feat: AbortController timeout on extractText; add extractGuidePages client"
```

---

## Task 7: Guide job store

**Files:**
- Create: `src/services/guideJobs.ts`
- Create: `src/__tests__/services/guideJobs.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/services/guideJobs.test.ts`:

```ts
// src/__tests__/services/guideJobs.test.ts
import { createJob, getJob, updateJob, getActiveJobForTest } from '../../services/guideJobs'

describe('guideJobs', () => {
    it('creates a job in queued state', () => {
        const job = createJob('test1', 'user1', 3)
        expect(job.status).toBe('queued')
        expect(job.progress).toEqual({ done: 0, total: 3 })
        expect(job.testId).toBe('test1')
        expect(job.ownerId).toBe('user1')
        expect(job.jobId).toBeTruthy()
    })

    it('retrieves a job by id', () => {
        const job = createJob('test2', 'user2', 1)
        expect(getJob(job.jobId)).toBeDefined()
        expect(getJob('nonexistent')).toBeUndefined()
    })

    it('updates job fields', () => {
        const job = createJob('test3', 'user3', 2)
        updateJob(job.jobId, { status: 'extracting', progress: { done: 1, total: 2 } })
        const updated = getJob(job.jobId)!
        expect(updated.status).toBe('extracting')
        expect(updated.progress.done).toBe(1)
    })

    it('getActiveJobForTest returns active job', () => {
        const job = createJob('testActive', 'userA', 1)
        expect(getActiveJobForTest('testActive')).toBeDefined()
        updateJob(job.jobId, { status: 'succeeded' })
        expect(getActiveJobForTest('testActive')).toBeUndefined()
    })

    it('getActiveJobForTest ignores failed jobs', () => {
        const job = createJob('testFailed', 'userB', 1)
        updateJob(job.jobId, { status: 'failed' })
        expect(getActiveJobForTest('testFailed')).toBeUndefined()
    })
})
```

- [ ] **Step 2: Run — expect failures**

```
npx jest src/__tests__/services/guideJobs.test.ts --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/services/guideJobs.ts`**

```ts
// src/services/guideJobs.ts
import { randomUUID } from 'crypto'
import { IGuideJob, GuideJobStatus } from '../APIs/exam/types/exam.interface'

// In-memory store. A process restart loses in-flight jobs — acceptable because
// extraction is re-runnable and the transactional-replace rule means no guide
// is destroyed by a lost job. If multi-instance deployment is added, move this
// to Mongo or Redis.
const store = new Map<string, IGuideJob>()

const TTL_SUCCEEDED_MS = 60 * 60 * 1000       // 1 h
const TTL_FAILED_MS    = 24 * 60 * 60 * 1000  // 24 h (keep errors actionable)
const TTL_OTHER_MS     = 48 * 60 * 60 * 1000  // 48 h fallback

setInterval(() => {
    const now = Date.now()
    for (const [id, job] of store) {
        const ttl =
            job.status === 'succeeded' ? TTL_SUCCEEDED_MS :
            job.status === 'failed'    ? TTL_FAILED_MS    : TTL_OTHER_MS
        if (now - job.updatedAt > ttl) store.delete(id)
    }
}, 10 * 60 * 1000)

export function createJob(testId: string, ownerId: string, totalFiles: number): IGuideJob {
    const job: IGuideJob = {
        jobId: randomUUID(),
        testId,
        ownerId,
        status: 'queued',
        progress: { done: 0, total: totalFiles },
        createdAt: Date.now(),
        updatedAt: Date.now()
    }
    store.set(job.jobId, job)
    return job
}

export function getJob(jobId: string): IGuideJob | undefined {
    return store.get(jobId)
}

export function updateJob(jobId: string, updates: Partial<Omit<IGuideJob, 'jobId' | 'testId' | 'ownerId' | 'createdAt'>>): void {
    const job = store.get(jobId)
    if (!job) return
    Object.assign(job, updates, { updatedAt: Date.now() })
}

export function getActiveJobForTest(testId: string): IGuideJob | undefined {
    for (const job of store.values()) {
        if (job.testId === testId && (job.status === 'queued' || job.status === 'extracting')) {
            return job
        }
    }
    return undefined
}
```

- [ ] **Step 4: Run tests — expect pass**

```
npx jest src/__tests__/services/guideJobs.test.ts --no-coverage
```

Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```
git add src/services/guideJobs.ts src/__tests__/services/guideJobs.test.ts
git commit -m "feat: in-memory guide job store with TTL sweep and one-active-per-test guard"
```

---

## Task 8: Guided grading service

**Files:**
- Create: `src/services/guidedGrading.ts`
- Create: `src/__tests__/services/guidedGrading.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/services/guidedGrading.test.ts`:

```ts
// src/__tests__/services/guidedGrading.test.ts
jest.mock('@google/genai', () => ({ GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: jest.fn() } })) }))
jest.mock('../../handlers/logger', () => ({ default: { info: jest.fn(), error: jest.fn() } }))

import {
    extractLocalKeywords,
    scorePages,
    computeIdf,
    trimToContextBudget
} from '../../services/guidedGrading'
import { IGuidePage } from '../../APIs/exam/types/exam.interface'

const makePage = (pageNumber: number, text: string, source = 'guide.pdf'): IGuidePage =>
    ({ pageNumber, text, source })

describe('extractLocalKeywords', () => {
    it('strips stop words', () => {
        const kw = extractLocalKeywords('What is the process of photosynthesis')
        expect(kw).toContain('photosynthesi')  // stemmed
        expect(kw).not.toContain('what')
        expect(kw).not.toContain('the')
        expect(kw).not.toContain('process')    // domain generic
    })

    it('deduplicates', () => {
        const kw = extractLocalKeywords('mitochondria mitochondria ATP')
        expect(kw.filter(k => k.includes('mitochondri')).length).toBe(1)
    })
})

describe('scorePages', () => {
    const pages = [
        makePage(1, 'Mitochondria produce ATP through cellular respiration.'),
        makePage(2, 'Photosynthesis converts sunlight into glucose using chlorophyll.'),
        makePage(3, 'The cell membrane controls what enters and exits the cell.')
    ]
    const idf = computeIdf(pages)

    it('scores highest for most relevant page', () => {
        const keywords = ['mitochondria', 'atp', 'respir']
        const scored = scorePages(keywords, pages, idf)
        const sorted = scored.sort((a, b) => b.score - a.score)
        expect(sorted[0].page.pageNumber).toBe(1)
    })

    it('returns rawHits of 0 for unrelated page', () => {
        const keywords = ['mitochondria', 'atp']
        const scored = scorePages(keywords, pages, idf)
        const p3 = scored.find(s => s.page.pageNumber === 3)!
        expect(p3.rawHits).toBe(0)
    })
})

describe('trimToContextBudget', () => {
    it('removes pages from the question with the most pages first', () => {
        const bigText = 'x'.repeat(200_000)
        const qPages = [
            { qNum: 1, pages: [makePage(1, bigText), makePage(2, bigText), makePage(3, bigText), makePage(4, bigText)], scores: [4, 3, 2, 1] },
            { qNum: 2, pages: [makePage(5, bigText)], scores: [5] }
        ]
        const result = trimToContextBudget(qPages, 600_000)
        // Q1 had 4 pages × 200K = 800K, Q2 had 1 × 200K = 200K, total 1M > 600K budget
        // Should trim Q1 (most pages) first
        expect(result[0].pages.length).toBeLessThan(4)
        expect(result[1].pages.length).toBe(1) // Q2 untouched
    })

    it('never trims a question below 1 page if it had content', () => {
        const bigText = 'x'.repeat(500_000)
        const qPages = [
            { qNum: 1, pages: [makePage(1, bigText)], scores: [1] },
            { qNum: 2, pages: [makePage(2, bigText)], scores: [1] }
        ]
        const result = trimToContextBudget(qPages, 400_000)
        // Both questions each keep their 1 page even though total > budget
        expect(result[0].pages.length).toBe(1)
        expect(result[1].pages.length).toBe(1)
    })
})
```

- [ ] **Step 2: Run — expect failures**

```
npx jest src/__tests__/services/guidedGrading.test.ts --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/services/guidedGrading.ts`**

```ts
// src/services/guidedGrading.ts
import { CustomError } from '../utils/errors'
import { IGuidePage, IGradingResult } from '../APIs/exam/types/exam.interface'
import { hardenGradingJson, parseKeywordMap, callGeminiWithBackoff, getAI } from './grading'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logger = (require('../handlers/logger') as { default: typeof import('../handlers/logger').default }).default

const CONTEXT_BUDGET_CHARS = 800_000
const MAX_PAGES_PER_Q = 6
const MIN_RAW_HITS = 2
const MIN_KEYWORDS = 2

// ── Stop-word lists ───────────────────────────────────────────────────────────
const STOP = new Set([
    'the','a','an','is','are','was','were','be','been','being','have','has','had',
    'do','does','did','will','would','could','should','may','might','shall','can',
    'to','of','in','on','at','by','for','with','about','into','through','from',
    'this','that','these','those','i','we','you','he','she','it','they',
    'what','which','who','how','when','where','why','all','each','both',
    'and','or','but','if','because','as','until','while','not','no',
    'so','than','too','very','just','now','own','same','only','more','most','s','t'
])
const DOMAIN_GENERIC = new Set([
    'define','describe','explain','list','name','state','give','write',
    'process','system','example','type','use','main','part','role',
    'function','discuss','compare','contrast','identify','outline',
    'following','show','find','make','note','true','false','answer','question'
])

// ── Stemmer (simple suffix strip) ────────────────────────────────────────────
function stem(word: string): string {
    return word
        .replace(/ations?$/, 'at')
        .replace(/ments?$/, '')
        .replace(/nesses?$/, '')
        .replace(/ings?$/, '')
        .replace(/ous$/, '')
        .replace(/ive$/, '')
        .replace(/ful$/, '')
        .replace(/less$/, '')
        .replace(/ies$/, 'y')
        .replace(/es$/, 'e')
        .replace(/s$/, '')
}

function tokenize(text: string): string[] {
    return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2)
}

export function extractLocalKeywords(text: string): string[] {
    const words = tokenize(text)
    const keywords = words
        .filter(w => !STOP.has(w) && !DOMAIN_GENERIC.has(w))
        .map(stem)
        .filter(w => w.length > 2)
    return [...new Set(keywords)]
}

// ── IDF ───────────────────────────────────────────────────────────────────────
export function computeIdf(pages: IGuidePage[]): Map<string, number> {
    const N = pages.length
    const df = new Map<string, number>()
    for (const page of pages) {
        const words = new Set(tokenize(page.text).map(stem))
        for (const w of words) df.set(w, (df.get(w) ?? 0) + 1)
    }
    const idf = new Map<string, number>()
    for (const [word, count] of df) {
        idf.set(word, Math.log((N + 1) / (count + 1)) + 1)
    }
    return idf
}

// ── Page scoring ──────────────────────────────────────────────────────────────
export interface ScoredPage { page: IGuidePage; rawHits: number; score: number }

export function scorePages(keywords: string[], pages: IGuidePage[], idf: Map<string, number>): ScoredPage[] {
    return pages.map(page => {
        const stemmedWords = tokenize(page.text).map(stem)
        const freq = new Map<string, number>()
        for (const w of stemmedWords) freq.set(w, (freq.get(w) ?? 0) + 1)

        let rawHits = 0, weightedScore = 0
        for (const kw of keywords) {
            const f = freq.get(kw) ?? 0
            if (f > 0) { rawHits += f; weightedScore += f * (idf.get(kw) ?? 1) }
        }
        const normalizedScore = page.text.length > 0 ? (weightedScore / page.text.length) * 1000 : 0
        return { page, rawHits, score: normalizedScore }
    })
}

function selectPages(scored: ScoredPage[], minHits = MIN_RAW_HITS, cap = MAX_PAGES_PER_Q): { pages: IGuidePage[]; belowThreshold: boolean } {
    const qualifying = scored.filter(s => s.rawHits >= minHits).sort((a, b) => b.score - a.score).slice(0, cap)
    if (qualifying.length >= 2) return { pages: qualifying.map(s => s.page), belowThreshold: false }
    const top2 = [...scored].sort((a, b) => b.score - a.score).slice(0, 2)
    return { pages: top2.map(s => s.page), belowThreshold: true }
}

// ── Question segment parsing ──────────────────────────────────────────────────
function parseQuestionSegments(text: string): Array<{ qNum: number; text: string }> {
    const lines = text.split('\n')
    const starts: Array<{ qNum: number; line: number }> = []
    const Q_LINE = /^\s*(\d+)\s*[.:\)]/
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(Q_LINE)
        if (m) starts.push({ qNum: parseInt(m[1], 10), line: i })
    }
    return starts.map((s, idx) => {
        const end = idx + 1 < starts.length ? starts[idx + 1].line : lines.length
        return { qNum: s.qNum, text: lines.slice(s.line, end).join('\n').trim() }
    })
}

// ── Context trimming ──────────────────────────────────────────────────────────
export interface QPages { qNum: number; pages: IGuidePage[]; scores: number[] }

export function trimToContextBudget(qPages: QPages[], budget = CONTEXT_BUDGET_CHARS): QPages[] {
    let total = qPages.reduce((sum, q) => sum + q.pages.reduce((s, p) => s + p.text.length, 0), 0)
    while (total > budget) {
        let maxIdx = -1, maxLen = 1
        for (let i = 0; i < qPages.length; i++) {
            if (qPages[i].pages.length > maxLen) { maxLen = qPages[i].pages.length; maxIdx = i }
        }
        if (maxIdx === -1) break
        const removed = qPages[maxIdx].pages.pop()!
        qPages[maxIdx].scores.pop()
        total -= removed.text.length
    }
    return qPages
}

// ── Gemini keyword fallback ───────────────────────────────────────────────────
async function geminiKeywordFallback(segments: Array<{ qNum: number; text: string }>): Promise<Record<string, string[]>> {
    const prompt = `Extract important keywords for finding relevant textbook pages for each question.
Return ONLY valid JSON: {"1":["keyword1","keyword2"],"2":["keyword3"]}

${segments.map(s => `Question ${s.qNum}: ${s.text}`).join('\n')}`.trim()
    try {
        const raw = await callGeminiWithBackoff(prompt)
        return parseKeywordMap(raw)
    } catch {
        return {}
    }
}

// ── Grading prompt ────────────────────────────────────────────────────────────
function buildGuidedPrompt(studentPaperText: string, refByQ: Map<number, IGuidePage[]>, mode: 'printed' | 'handwritten'): string {
    const refBlocks = [...refByQ.entries()]
        .map(([qNum, pages]) => {
            const pagesText = pages.length > 0
                ? pages.map(p => `[Page ${p.pageNumber} from ${p.source}]\n${p.text}`).join('\n\n')
                : '[No reference — grade on general knowledge; add "answer unverified against guide" in feedback]'
            return `REFERENCE PAGES FOR Q${qNum}:\n${pagesText}`
        })
        .join('\n\n---\n\n')

    return `You are an exam grader. Use the reference pages to grade each student answer.

STUDENT PAPER:
${studentPaperText}

${refBlocks}

Instructions:
- Cover EVERY numbered question in the student paper — do not skip any.
- For each question, use the REFERENCE PAGES with the matching question number to establish the correct answer.
- Copy the student's answer verbatim. If blank or missing, use "" and mark wrong.
- Do NOT fabricate answers. If no reference pages for a question, grade on general knowledge and add "answer unverified against guide" in feedback.
- Assign score: "correct", "partial", or "wrong". correct=1, partial=0.5, wrong=0.
- One-sentence feedback for mistakes; "" if correct.${mode === 'printed' ? '\n- IMPORTANT: Student paper was OCR-extracted from a printed sheet — only treat clearly marked or written text as student answers.' : ''}

Respond with ONLY valid JSON — no markdown, no explanation:
{"totalScore":number,"maxScore":number,"questions":[{"number":number,"correctAnswer":string,"studentAnswer":string,"score":"correct"|"partial"|"wrong","feedback":string}]}`
}

// ── Main export ───────────────────────────────────────────────────────────────
export const gradeExamGuided = async (
    guidePages: IGuidePage[],
    studentPaperText: string,
    mode: 'printed' | 'handwritten' = 'printed'
): Promise<IGradingResult> => {
    if (guidePages.length === 0) throw new CustomError('No guide pages available for this test.', 422)

    const resolvedText = studentPaperText.trim()
        ? studentPaperText
        : '[BLANK PAPER — mark every question wrong with empty studentAnswer.]'

    const segments = parseQuestionSegments(resolvedText)
    const idf = computeIdf(guidePages)
    const qPages: QPages[] = []
    const fallbackNeeded: typeof segments = []

    for (const seg of segments) {
        const keywords = extractLocalKeywords(seg.text)
        if (keywords.length < MIN_KEYWORDS) {
            fallbackNeeded.push(seg)
            qPages.push({ qNum: seg.qNum, pages: [], scores: [] })
            continue
        }
        const scored = scorePages(keywords, guidePages, idf)
        const { pages, belowThreshold } = selectPages(scored)
        if (belowThreshold) fallbackNeeded.push(seg)
        qPages.push({ qNum: seg.qNum, pages, scores: pages.map(p => scored.find(s => s.page === p)?.score ?? 0) })
    }

    if (fallbackNeeded.length > 0) {
        const kwMap = await geminiKeywordFallback(fallbackNeeded)
        for (const seg of fallbackNeeded) {
            const extras = kwMap[String(seg.qNum)] ?? []
            if (extras.length === 0) continue
            const scored = scorePages(extras.map(stem), guidePages, idf)
            const { pages } = selectPages(scored)
            const idx = qPages.findIndex(q => q.qNum === seg.qNum)
            if (idx >= 0) { qPages[idx].pages = pages; qPages[idx].scores = pages.map(p => scored.find(s => s.page === p)?.score ?? 0) }
        }
    }

    trimToContextBudget(qPages)

    const refByQ = new Map(qPages.map(q => [q.qNum, q.pages]))
    const prompt = buildGuidedPrompt(resolvedText, refByQ, mode)

    const raw = await callGeminiWithBackoff(prompt)
    if (!raw.trim()) throw new CustomError('Grading service returned an empty response.', 503)

    const result = hardenGradingJson(raw)
    logger.info('Guided exam graded', { meta: { totalScore: result.totalScore, maxScore: result.maxScore, pages: guidePages.length } })
    return result
}
```

- [ ] **Step 4: Run tests — expect pass**

```
npx jest src/__tests__/services/guidedGrading.test.ts --no-coverage
```

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```
git add src/services/guidedGrading.ts src/__tests__/services/guidedGrading.test.ts
git commit -m "feat: guided grading service — local keyword extraction, IDF page scoring, batched Gemini call"
```

---

## Task 9: Guide upload middleware

**Files:**
- Create: `src/middlewares/guideUpload.ts`

- [ ] **Step 1: Create the file**

```ts
// src/middlewares/guideUpload.ts
import multer, { FileFilterCallback } from 'multer'
import { Request } from 'express'

const MAX_FILE_SIZE = 50 * 1024 * 1024  // 50 MB per file — covers real textbooks

const guideFileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (file.mimetype === 'application/pdf') {
        cb(null, true)
    } else {
        cb(new Error(`Guide files must be PDF (received ${file.mimetype})`))
    }
}

export default multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE, files: 10 },
    fileFilter: guideFileFilter
})
```

- [ ] **Step 2: Compile**

```
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```
git add src/middlewares/guideUpload.ts
git commit -m "feat: route-scoped multer for guide PDF upload (50 MB/file, PDF-only)"
```

---

## Task 10: Exam service — guided grade branch + upload orchestration

**Files:**
- Modify: `src/APIs/exam/exam.service.ts`

- [ ] **Step 1: Replace `exam.service.ts` with guided-grading branch + upload functions**

```ts
// src/APIs/exam/exam.service.ts
import { CustomError } from '../../utils/errors'
import { extractText, extractGuidePages, OcrMode } from '../../services/ocr'
import { gradeExam } from '../../services/grading'
import { gradeExamGuided } from '../../services/guidedGrading'
import * as jobStore from '../../services/guideJobs'
import ExamRecord from './exam.model'
import testRepository from './test.repository'
import { IExamRecord, IExamQuestion, ITestWithCount, ITestResults, IGuidePage, IGuideSource, IGuideJob } from './types/exam.interface'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logger = (require('../../handlers/logger') as { default: typeof import('../../handlers/logger').default }).default

const resolveTestId = async (testId: string | undefined, testName: string | undefined, userId: string): Promise<string> => {
    if (testId) {
        const test = await testRepository.findById(testId, userId)
        if (!test) throw new CustomError('Test not found', 404)
        return testId
    }
    if (testName?.trim()) {
        const test = await testRepository.create(testName.trim(), userId)
        return test._id!.toString()
    }
    throw new CustomError('Either testId or testName is required', 422)
}

export const gradeExamFiles = async (
    answerKeyBuffer: Buffer | null,
    studentPaperBuffer: Buffer,
    mode: OcrMode,
    studentName: string,
    userId: string,
    testId?: string,
    testName?: string
): Promise<IExamRecord & { testId: string }> => {
    if (!studentName?.trim()) throw new CustomError('Student name is required', 422)

    const resolvedTestId = await resolveTestId(testId, testName, userId)
    const test = await testRepository.findById(resolvedTestId, userId)

    // ── Guided-book grading branch ────────────────────────────────────────────
    if (test?.gradingMode === 'guidedBook') {
        const activeJob = jobStore.getActiveJobForTest(resolvedTestId)
        if (activeJob) throw new CustomError('Guide is still being processed — try again shortly.', 409)

        const guideInfo = await testRepository.getGuidePages(resolvedTestId, userId)
        if (!guideInfo || guideInfo.pages.length === 0) {
            throw new CustomError('No guide pages available for this test — upload a guide PDF first.', 422)
        }

        let studentPaperText: string
        try {
            const paperResult = await extractText(studentPaperBuffer, mode, 'student_paper')
            studentPaperText = paperResult.text
        } catch (err) {
            const msg = err instanceof CustomError ? err.message : 'Could not extract text from student paper.'
            throw new CustomError(`Student paper: ${msg}`, 422)
        }

        const grading = await gradeExamGuided(guideInfo.pages, studentPaperText, mode)
        const percentage = grading.maxScore > 0 ? Math.round((grading.totalScore / grading.maxScore) * 100) : 0

        let record
        try {
            record = await ExamRecord.create({
                testId: resolvedTestId,
                studentName: studentName.trim(),
                mode,
                gradingMode: 'guidedBook',
                answerKeyText: '',
                studentPaperText,
                totalScore: grading.totalScore,
                maxScore: grading.maxScore,
                percentage,
                questions: grading.questions
            })
        } catch (err) {
            logger.error('Failed to save guided exam record', { meta: { err } })
            throw new CustomError('Grading failed — could not save result.', 500)
        }

        return { ...(record.toObject() as IExamRecord), testId: resolvedTestId }
    }

    // ── Answer-key grading branch (existing flow) ─────────────────────────────
    let effectiveKeyBuffer: Buffer
    if (answerKeyBuffer) {
        effectiveKeyBuffer = answerKeyBuffer
        await testRepository.saveAnswerKey(resolvedTestId, userId, answerKeyBuffer)
    } else {
        const stored = await testRepository.getAnswerKey(resolvedTestId, userId)
        if (!stored) throw new CustomError('No answer key uploaded for this test — please upload one.', 422)
        effectiveKeyBuffer = stored
    }

    let answerKeyText: string
    let studentPaperText: string

    try {
        answerKeyText = (await extractText(effectiveKeyBuffer, mode, 'answer_key')).text
    } catch (err) {
        const msg = err instanceof CustomError ? err.message : 'Could not extract text from answer key.'
        throw new CustomError(`Answer key: ${msg}`, 422)
    }

    try {
        studentPaperText = (await extractText(studentPaperBuffer, mode, 'student_paper')).text
    } catch (err) {
        const msg = err instanceof CustomError ? err.message : 'Could not extract text from student paper.'
        throw new CustomError(`Student paper: ${msg}`, 422)
    }

    const grading = await gradeExam(answerKeyText, studentPaperText, mode)
    const percentage = grading.maxScore > 0 ? Math.round((grading.totalScore / grading.maxScore) * 100) : 0

    let record
    try {
        record = await ExamRecord.create({
            testId: resolvedTestId,
            studentName: studentName.trim(),
            mode,
            gradingMode: 'answerKey',
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

    return { ...(record.toObject() as IExamRecord), testId: resolvedTestId }
}

// ── Guide upload ──────────────────────────────────────────────────────────────

export const startGuideUpload = async (
    testId: string,
    userId: string,
    files: Array<{ buffer: Buffer; originalname: string }>
): Promise<{ jobId: string }> => {
    const test = await testRepository.findById(testId, userId)
    if (!test) throw new CustomError('Test not found', 404)

    const existing = jobStore.getActiveJobForTest(testId)
    if (existing) throw new CustomError('A guide upload is already processing for this test — wait for it to finish.', 409)

    const job = jobStore.createJob(testId, userId, files.length)
    void runGuideExtraction(job.jobId, testId, userId, files)
    return { jobId: job.jobId }
}

async function runGuideExtraction(
    jobId: string,
    testId: string,
    userId: string,
    files: Array<{ buffer: Buffer; originalname: string }>
): Promise<void> {
    jobStore.updateJob(jobId, { status: 'extracting' })
    const allPages: IGuidePage[] = []
    const sources: IGuideSource[] = []
    let pageOffset = 0

    try {
        for (let i = 0; i < files.length; i++) {
            const file = files[i]
            let pages: IGuidePage[]
            try {
                pages = await extractGuidePages(file.buffer, file.originalname)
            } catch (err) {
                const msg = err instanceof CustomError ? err.message : `Failed to extract ${file.originalname}`
                jobStore.updateJob(jobId, { status: 'failed', error: { message: msg, filename: file.originalname } })
                return
            }
            const renumbered = pages.map(p => ({ ...p, pageNumber: p.pageNumber + pageOffset }))
            pageOffset += pages.length
            allPages.push(...renumbered)
            sources.push({ filename: file.originalname, pageCount: pages.length })
            jobStore.updateJob(jobId, { progress: { done: i + 1, total: files.length } })
        }

        if (allPages.length === 0) {
            jobStore.updateJob(jobId, { status: 'failed', error: { message: 'No readable text found in guide PDFs.' } })
            return
        }

        if (allPages.length > 1200) {
            jobStore.updateJob(jobId, { status: 'failed', error: { message: `Guide too large: ${allPages.length} pages, max 1200.` } })
            return
        }

        await testRepository.saveGuidePages(testId, userId, allPages, sources)
        jobStore.updateJob(jobId, { status: 'succeeded', result: { pageCount: allPages.length, sources } })
        logger.info('Guide extraction complete', { meta: { testId, pages: allPages.length } })
    } catch {
        jobStore.updateJob(jobId, { status: 'failed', error: { message: 'Extraction failed unexpectedly.' } })
    }
}

export const getGuideJobStatus = async (testId: string, jobId: string, userId: string): Promise<IGuideJob | null> => {
    const job = jobStore.getJob(jobId)
    if (!job || job.testId !== testId || job.ownerId !== userId) return null
    return job
}

// ── Existing exports (unchanged) ──────────────────────────────────────────────

export const listTests = async (userId: string): Promise<ITestWithCount[]> =>
    testRepository.listWithCounts(userId)

export const getTestResults = async (testId: string, userId: string): Promise<ITestResults> => {
    const results = await testRepository.getResults(testId, userId)
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

export const editExamRecord = async (recordId: string, questions: IExamQuestion[], userId: string): Promise<IExamRecord> => {
    const existing = await ExamRecord.findById(recordId).lean()
    if (!existing) throw new CustomError('Record not found', 404)
    const test = await testRepository.findById(existing.testId.toString(), userId)
    if (!test) throw new CustomError('Record not found', 404)
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

- [ ] **Step 2: Compile**

```
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```
git add src/APIs/exam/exam.service.ts
git commit -m "feat: branch gradeExamFiles on gradingMode; add startGuideUpload, getGuideJobStatus"
```

---

## Task 11: Controller + router

**Files:**
- Modify: `src/APIs/exam/exam.controller.ts`
- Modify: `src/APIs/exam/index.ts`

- [ ] **Step 1: Add `uploadGuide` and `pollGuideJob` to controller**

Add two new handlers to the exported object in `exam.controller.ts`. Replace the entire file:

```ts
// src/APIs/exam/exam.controller.ts
import { NextFunction, Request, Response } from 'express'
import httpResponse from '../../handlers/httpResponse'
import httpError from '../../handlers/errorHandler/httpError'
import asyncHandler from '../../handlers/async'
import { CustomError } from '../../utils/errors'
import { OcrMode } from '../../services/ocr'
import { IAuthenticateRequest } from '../../types/types'
import { gradeExamFiles, listTests, getTestResults, editExamRecord, startGuideUpload, getGuideJobStatus } from './exam.service'

export default {
    grade: asyncHandler(async (request: Request, response: Response, next: NextFunction) => {
        try {
            const files = request.files as Record<string, Express.Multer.File[]> | undefined
            const answerKey = files?.['answerKey']?.[0]
            const studentPaper = files?.['studentPaper']?.[0]

            if (!studentPaper) throw new CustomError('Student paper file is required.', 422)

            const userId = (request as IAuthenticateRequest).authenticatedUser._id.toString()
            const body = request.body as { mode?: OcrMode; studentName?: string; testId?: string; testName?: string }
            const mode: OcrMode = body.mode ?? 'printed'
            const result = await gradeExamFiles(
                answerKey?.buffer ?? null,
                studentPaper.buffer,
                mode,
                body.studentName ?? '',
                userId,
                body.testId,
                body.testName
            )
            httpResponse(response, request, 200, 'Exam graded successfully', result)
        } catch (error) {
            if (error instanceof CustomError) httpError(next, error, request, error.statusCode)
            else httpError(next, error, request, 500)
        }
    }),

    tests: asyncHandler(async (request: Request, response: Response, next: NextFunction) => {
        try {
            const userId = (request as IAuthenticateRequest).authenticatedUser._id.toString()
            const tests = await listTests(userId)
            httpResponse(response, request, 200, 'Tests retrieved successfully', tests)
        } catch (error) {
            if (error instanceof CustomError) httpError(next, error, request, error.statusCode)
            else httpError(next, error, request, 500)
        }
    }),

    testResults: asyncHandler(async (request: Request, response: Response, next: NextFunction) => {
        try {
            const userId = (request as IAuthenticateRequest).authenticatedUser._id.toString()
            const { testId } = request.params
            const results = await getTestResults(testId, userId)
            httpResponse(response, request, 200, 'Test results retrieved successfully', results)
        } catch (error) {
            if (error instanceof CustomError) httpError(next, error, request, error.statusCode)
            else httpError(next, error, request, 500)
        }
    }),

    editRecord: asyncHandler(async (request: Request, response: Response, next: NextFunction) => {
        try {
            const userId = (request as IAuthenticateRequest).authenticatedUser._id.toString()
            const { recordId } = request.params
            const { questions } = request.body as { questions: Parameters<typeof editExamRecord>[1] }
            const record = await editExamRecord(recordId, questions, userId)
            httpResponse(response, request, 200, 'Record updated successfully', record)
        } catch (error) {
            if (error instanceof CustomError) httpError(next, error, request, error.statusCode)
            else httpError(next, error, request, 500)
        }
    }),

    uploadGuide: asyncHandler(async (request: Request, response: Response, next: NextFunction) => {
        try {
            const userId = (request as IAuthenticateRequest).authenticatedUser._id.toString()
            const { testId } = request.params
            const files = (request.files as Express.Multer.File[]) ?? []
            if (files.length === 0) throw new CustomError('At least one PDF file is required.', 422)

            const result = await startGuideUpload(
                testId,
                userId,
                files.map(f => ({ buffer: f.buffer, originalname: f.originalname }))
            )
            httpResponse(response, request, 202, 'Guide extraction started', result)
        } catch (error) {
            if (error instanceof CustomError) httpError(next, error, request, error.statusCode)
            else httpError(next, error, request, 500)
        }
    }),

    pollGuideJob: asyncHandler(async (request: Request, response: Response, next: NextFunction) => {
        try {
            const userId = (request as IAuthenticateRequest).authenticatedUser._id.toString()
            const { testId, jobId } = request.params
            const job = await getGuideJobStatus(testId, jobId, userId)
            if (!job) {
                httpError(next, new CustomError('Job not found or expired', 404), request, 404)
                return
            }
            const { status, progress, result, error } = job
            httpResponse(response, request, 200, 'Job status retrieved', { status, progress, result, error })
        } catch (error) {
            if (error instanceof CustomError) httpError(next, error, request, error.statusCode)
            else httpError(next, error, request, 500)
        }
    })
}
```

- [ ] **Step 2: Wire new routes in `index.ts`**

```ts
// src/APIs/exam/index.ts
import { Router } from 'express'
import examController from './exam.controller'
import upload from '../../middlewares/upload'
import guideUpload from '../../middlewares/guideUpload'
import rateLimiter from '../../middlewares/rateLimiter'
import authenticate from '../../middlewares/authenticate'

const router = Router()

router.route('/exam/grade').post(
    rateLimiter,
    authenticate,
    upload.fields([{ name: 'answerKey', maxCount: 1 }, { name: 'studentPaper', maxCount: 1 }]),
    examController.grade
)

router.route('/exam/tests').get(rateLimiter, authenticate, examController.tests)

router.route('/exam/tests/:testId/results').get(rateLimiter, authenticate, examController.testResults)

router.route('/exam/tests/:testId/guides').post(
    rateLimiter,
    authenticate,
    guideUpload.array('guides', 10),
    examController.uploadGuide
)

router.route('/exam/tests/:testId/guides/job/:jobId').get(rateLimiter, authenticate, examController.pollGuideJob)

router.route('/exam/records/:recordId').patch(rateLimiter, authenticate, examController.editRecord)

export default router
```

- [ ] **Step 3: Compile**

```
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```
git add src/APIs/exam/exam.controller.ts src/APIs/exam/index.ts
git commit -m "feat: add uploadGuide (POST /tests/:testId/guides) and pollGuideJob routes"
```

---

## Task 12: Frontend — types + API client

**Files:**
- Modify: `frontend/src/types/exam.ts`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Update `frontend/src/types/exam.ts`**

```ts
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
```

- [ ] **Step 2: Add `uploadGuides` and `pollGuideJob` to `frontend/src/lib/api.ts`**

Add at the end of the existing file:

```ts
export async function uploadGuides(testId: string, files: File[]): Promise<BackendResponse<{ jobId: string }>> {
    const form = new FormData()
    files.forEach(f => form.append('guides', f))
    return apiUpload<{ jobId: string }>(`/v1/exam/tests/${testId}/guides`, form)
}

export async function pollGuideJob(testId: string, jobId: string): Promise<BackendResponse<import('@/types/exam').GuideJobPoll>> {
    return apiFetch(`/v1/exam/tests/${testId}/guides/job/${jobId}`)
}
```

- [ ] **Step 3: Compile frontend**

```
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```
git add frontend/src/types/exam.ts frontend/src/lib/api.ts
git commit -m "feat: add GradingMode types, GuideJobPoll, uploadGuides/pollGuideJob to frontend"
```

---

## Task 13: Frontend — exam page

**Files:**
- Modify: `frontend/src/app/exam/page.tsx`

- [ ] **Step 1: Replace `exam/page.tsx` with mode-toggle + guide upload + job polling**

```tsx
'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/context/auth'
import { apiFetch, apiUpload, uploadGuides, pollGuideJob } from '@/lib/api'
import ExamResult from '@/components/ExamResult'
import { GradeResult, TestItem, GradingMode } from '@/types/exam'

type OcrMode = 'handwritten' | 'printed'

const ERROR_MESSAGES: Record<number, string> = {
    409: 'Guide is still being processed — try again shortly',
    413: 'File too large — max 10 MB for papers, 50 MB per guide PDF',
    422: 'Could not process files — ensure they are clear and readable',
    503: 'Grading service unavailable — make sure the Python OCR service is running',
    500: 'Grading failed'
}

export default function ExamPage() {
    const { user, loading } = useAuth()

    const [tests, setTests] = useState<TestItem[]>([])
    const [testsError, setTestsError] = useState<string | null>(null)
    const [selectedTestId, setSelectedTestId] = useState<string>('')
    const [newTestName, setNewTestName] = useState<string>('')

    const [gradingMode, setGradingMode] = useState<GradingMode>('answerKey')
    const [studentName, setStudentName] = useState<string>('')
    const [answerKey, setAnswerKey] = useState<File | null>(null)
    const [studentPaper, setStudentPaper] = useState<File | null>(null)
    const [guideFiles, setGuideFiles] = useState<File[]>([])
    const [mode, setMode] = useState<OcrMode>('printed')

    const [result, setResult] = useState<GradeResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [grading, setGrading] = useState(false)

    // Guide upload job state
    const [guideJobId, setGuideJobId] = useState<string | null>(null)
    const [guideStatus, setGuideStatus] = useState<'idle' | 'uploading' | 'extracting' | 'done' | 'failed'>('idle')
    const [guideProgress, setGuideProgress] = useState<{ done: number; total: number } | null>(null)
    const [guideError, setGuideError] = useState<string | null>(null)
    const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        if (!loading && !user) window.location.href = '/login'
    }, [user, loading])

    const loadTests = () => {
        apiFetch<TestItem[]>('/v1/exam/tests')
            .then(res => { setTests(res.data); setTestsError(null) })
            .catch((err: Error & { status?: number }) => {
                if (err.status === 401) { window.location.href = '/login'; return }
                setTestsError('Could not load tests — you can still create a new one below')
            })
    }

    useEffect(() => { if (user) loadTests() }, [user])  // eslint-disable-line react-hooks/exhaustive-deps

    // Sync gradingMode when selected test changes
    useEffect(() => {
        const t = tests.find(t => t._id === selectedTestId)
        if (t) setGradingMode(t.gradingMode ?? 'answerKey')
    }, [selectedTestId, tests])

    // Poll guide job
    useEffect(() => {
        if (!guideJobId || !selectedTestId || guideStatus === 'done' || guideStatus === 'failed' || guideStatus === 'idle') return
        const poll = async () => {
            try {
                const res = await pollGuideJob(selectedTestId, guideJobId)
                const { status, progress, error: jobErr } = res.data
                setGuideProgress(progress)
                if (status === 'succeeded') {
                    setGuideStatus('done')
                    loadTests()
                } else if (status === 'failed') {
                    setGuideStatus('failed')
                    setGuideError(jobErr?.message ?? 'Guide extraction failed.')
                } else {
                    setGuideStatus('extracting')
                    pollRef.current = setTimeout(poll, 2000)
                }
            } catch {
                setGuideStatus('failed')
                setGuideError('Could not reach server while polling guide status.')
            }
        }
        pollRef.current = setTimeout(poll, 1500)
        return () => { if (pollRef.current) clearTimeout(pollRef.current) }
    }, [guideJobId, selectedTestId, guideStatus])  // eslint-disable-line react-hooks/exhaustive-deps

    const selectedTest = tests.find(t => t._id === selectedTestId) ?? null
    const isNewTest = selectedTestId === '__new__'
    const testReady = selectedTestId !== '' && (!isNewTest || newTestName.trim() !== '')

    const guideIsExtracting = guideStatus === 'uploading' || guideStatus === 'extracting'
    const hasGuide = selectedTest?.hasGuide === true || guideStatus === 'done'
    const keyReady = gradingMode === 'answerKey'
        ? (answerKey !== null || (!isNewTest && selectedTest?.hasAnswerKey === true))
        : hasGuide

    const canGrade = testReady && studentName.trim() !== '' && keyReady && studentPaper !== null && !grading && !guideIsExtracting

    async function handleGrade() {
        if (!canGrade || !studentPaper) return
        setError(null); setResult(null); setGrading(true)
        try {
            const form = new FormData()
            if (gradingMode === 'answerKey' && answerKey) form.append('answerKey', answerKey)
            form.append('studentPaper', studentPaper)
            form.append('mode', mode)
            form.append('studentName', studentName.trim())
            if (isNewTest) form.append('testName', newTestName.trim())
            else form.append('testId', selectedTestId)

            const res = await apiUpload<GradeResult>('/v1/exam/grade', form)
            setResult(res.data)
            setStudentName(''); setStudentPaper(null); setAnswerKey(null)
            setSelectedTestId(res.data.testId); setNewTestName('')
            loadTests()
        } catch (err) {
            const e = err as Error & { status?: number }
            const status = e.status ?? 500
            if (status === 401) { window.location.href = '/login'; return }
            setError(e.message && e.message !== 'Internal Server Error'
                ? e.message
                : (ERROR_MESSAGES[status] ?? ERROR_MESSAGES[500]))
        } finally {
            setGrading(false)
        }
    }

    async function handleGuideUpload(files: FileList | null) {
        if (!files || files.length === 0 || !selectedTestId || isNewTest) return
        const arr = Array.from(files)
        setGuideFiles(arr)
        setGuideStatus('uploading')
        setGuideError(null)
        try {
            const res = await uploadGuides(selectedTestId, arr)
            setGuideJobId(res.data.jobId)
            setGuideStatus('extracting')
        } catch (err) {
            const e = err as Error & { status?: number }
            setGuideStatus('failed')
            setGuideError(e.message ?? 'Failed to start guide upload.')
        }
    }

    function handleGradingModeSwitch(next: GradingMode) {
        if (next === gradingMode) return
        if (gradingMode === 'answerKey' && selectedTest?.hasAnswerKey) {
            if (!window.confirm('This will remove your saved answer key. Continue?')) return
        }
        if (gradingMode === 'guidedBook' && hasGuide) {
            if (!window.confirm('This will remove your saved guide PDFs. Continue?')) return
        }
        setGradingMode(next)
        setAnswerKey(null); setGuideFiles([]); setGuideStatus('idle'); setGuideJobId(null); setGuideError(null)
    }

    if (loading || !user) return null

    const guideSourcesLabel = selectedTest?.guideSources?.length
        ? `✓ ${selectedTest.guideSources.reduce((n, s) => n + s.pageCount, 0)} pages from ${selectedTest.guideSources.length} file${selectedTest.guideSources.length > 1 ? 's' : ''} — drop to replace`
        : guideStatus === 'done'
            ? '✓ Guide extracted — drop to replace'
            : 'Drop PDFs here or click to upload'

    return (
        <div className="max-w-2xl mx-auto px-4 py-8">
            <div className="bg-[#16213e] rounded-lg px-4 py-3 mb-6">
                <span className="text-[#4cc9f0] font-bold">✦ Exam Grader</span>
            </div>

            <div className="flex flex-col gap-4">
                {/* OCR mode */}
                <div className="flex gap-2">
                    {(['printed', 'handwritten'] as OcrMode[]).map(m => (
                        <button key={m} onClick={() => setMode(m)} disabled={grading}
                            className={['px-4 py-1.5 rounded text-sm font-medium transition-colors',
                                mode === m ? 'bg-[#4cc9f0] text-[#0f0e17]' : 'bg-[#16213e] text-[#aaa] hover:text-[#4cc9f0]'
                            ].join(' ')}>
                            {m.charAt(0).toUpperCase() + m.slice(1)}
                        </button>
                    ))}
                </div>

                {/* Test selector */}
                {testsError && <p className="text-xs text-[#e94560]">{testsError}</p>}
                <div className="flex flex-col gap-2">
                    <label className="text-sm text-[#aaa]">Test</label>
                    <select value={selectedTestId}
                        onChange={e => { setSelectedTestId(e.target.value); setAnswerKey(null); setGuideStatus('idle'); setGuideJobId(null) }}
                        disabled={grading}
                        className="bg-[#16213e] text-[#ccc] border border-[#4cc9f0]/30 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#4cc9f0] disabled:opacity-40">
                        <option value="">— select a test —</option>
                        {tests.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
                        <option value="__new__">New test…</option>
                    </select>
                    {isNewTest && (
                        <input type="text" placeholder="New test name" value={newTestName}
                            onChange={e => setNewTestName(e.target.value)} disabled={grading}
                            className="bg-[#16213e] text-[#ccc] border border-[#4cc9f0]/30 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#4cc9f0] placeholder-[#555] disabled:opacity-40" />
                    )}
                </div>

                {/* Grading mode toggle (only for existing tests) */}
                {!isNewTest && selectedTestId && (
                    <div className="flex flex-col gap-1">
                        <label className="text-sm text-[#aaa]">Answer source</label>
                        <div className="flex gap-2">
                            {(['answerKey', 'guidedBook'] as GradingMode[]).map(m => (
                                <button key={m} onClick={() => handleGradingModeSwitch(m)} disabled={grading || guideIsExtracting}
                                    className={['px-4 py-1.5 rounded text-sm font-medium transition-colors',
                                        gradingMode === m ? 'bg-[#4cc9f0] text-[#0f0e17]' : 'bg-[#16213e] text-[#aaa] hover:text-[#4cc9f0]'
                                    ].join(' ')}>
                                    {m === 'answerKey' ? 'Answer Key' : 'Guide PDFs'}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Student name */}
                <div className="flex flex-col gap-2">
                    <label className="text-sm text-[#aaa]">Student Name</label>
                    <input type="text" placeholder="Enter student name" value={studentName}
                        onChange={e => setStudentName(e.target.value)} disabled={grading}
                        className="bg-[#16213e] text-[#ccc] border border-[#4cc9f0]/30 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#4cc9f0] placeholder-[#555] disabled:opacity-40" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    {/* Answer Key OR Guide PDFs slot */}
                    {gradingMode === 'answerKey' ? (
                        <label className={['border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
                            answerKey ? 'border-[#4cc9f0] bg-[#0f3460]/20'
                            : selectedTest?.hasAnswerKey ? 'border-[#4cc9f0]/60 bg-[#0f3460]/10'
                            : 'border-[#4cc9f0]/40 hover:border-[#4cc9f0]'].join(' ')}>
                            <div className="text-2xl mb-2">📄</div>
                            <p className="text-sm text-[#4cc9f0] font-medium mb-1">Answer Key</p>
                            <p className="text-xs text-[#555] truncate">
                                {answerKey ? answerKey.name : selectedTest?.hasAnswerKey ? '✓ Saved — drop to replace' : 'Click to upload'}
                            </p>
                            <input type="file" accept=".jpg,.jpeg,.png,.webp,.tiff,.pdf,image/png,image/jpeg,image/webp,image/tiff,application/pdf"
                                className="hidden" disabled={grading} onChange={e => setAnswerKey(e.target.files?.[0] ?? null)} />
                        </label>
                    ) : (
                        <label className={['border-2 border-dashed rounded-lg p-6 text-center transition-colors',
                            guideIsExtracting ? 'border-[#4cc9f0]/40 opacity-60 cursor-wait'
                            : hasGuide ? 'border-[#4cc9f0]/60 bg-[#0f3460]/10 cursor-pointer'
                            : 'border-[#4cc9f0]/40 hover:border-[#4cc9f0] cursor-pointer'].join(' ')}>
                            <div className="text-2xl mb-2">📚</div>
                            <p className="text-sm text-[#4cc9f0] font-medium mb-1">Guide PDFs</p>
                            <p className="text-xs text-[#555]">
                                {guideIsExtracting
                                    ? `Extracting guide text… (${guideProgress ? `${guideProgress.done}/${guideProgress.total} files` : 'starting'})`
                                    : guideSourcesLabel}
                            </p>
                            {guideError && <p className="text-xs text-[#e94560] mt-1">{guideError}</p>}
                            <input type="file" accept="application/pdf,.pdf" multiple className="hidden"
                                disabled={guideIsExtracting || grading || isNewTest}
                                onChange={e => handleGuideUpload(e.target.files)} />
                        </label>
                    )}

                    {/* Student Paper */}
                    <label className={['border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
                        studentPaper ? 'border-[#4cc9f0] bg-[#0f3460]/20' : 'border-[#4cc9f0]/40 hover:border-[#4cc9f0]'].join(' ')}>
                        <div className="text-2xl mb-2">📄</div>
                        <p className="text-sm text-[#4cc9f0] font-medium mb-1">Student Paper</p>
                        <p className="text-xs text-[#555] truncate">{studentPaper ? studentPaper.name : 'Click to upload'}</p>
                        <input type="file" accept=".jpg,.jpeg,.png,.webp,.tiff,.pdf,image/png,image/jpeg,image/webp,image/tiff,application/pdf"
                            className="hidden" disabled={grading} onChange={e => setStudentPaper(e.target.files?.[0] ?? null)} />
                    </label>
                </div>

                {isNewTest && gradingMode === 'guidedBook' && (
                    <p className="text-xs text-[#aaa]">Save the test first by grading one paper, then upload guide PDFs.</p>
                )}

                <button onClick={handleGrade} disabled={!canGrade}
                    className="bg-[#4cc9f0] text-[#0f0e17] font-semibold py-2 px-6 rounded transition-opacity disabled:opacity-40">
                    {grading ? 'Grading…'
                        : guideIsExtracting ? 'Extracting guide…'
                        : 'Grade'}
                </button>

                {error && <p className="text-center text-sm text-[#e94560]">{error}</p>}
                {result && <ExamResult {...result} />}
            </div>
        </div>
    )
}
```

- [ ] **Step 2: Compile frontend**

```
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```
git add frontend/src/app/exam/page.tsx
git commit -m "feat: exam page — grading mode toggle, guide PDF uploader, job polling, 3-state grade button"
```

---

## Task 14: Frontend — ExamResult grading-source badge

**Files:**
- Modify: `frontend/src/components/ExamResult.tsx`

- [ ] **Step 1: Add badge to `ExamResult`**

```tsx
// frontend/src/components/ExamResult.tsx
import { ExamQuestion, GradeResult } from '@/types/exam'

const SCORE_STYLES: Record<ExamQuestion['score'], string> = {
    correct: 'bg-[#1a3a2a] text-[#68d391]',
    partial: 'bg-[#3a2e1a] text-[#f6ad55]',
    wrong: 'bg-[#3a1a1a] text-[#fc8181]'
}

export default function ExamResult({ totalScore, maxScore, percentage, questions, gradingMode }: GradeResult) {
    const badge = gradingMode === 'guidedBook' ? '📚 Guide' : '📄 Answer Key'

    return (
        <div className="flex flex-col gap-4">
            <div className="bg-[#16213e] rounded-lg p-4 flex items-center justify-between">
                <span className="text-[#4cc9f0] font-bold text-lg">
                    {totalScore} / {maxScore}
                </span>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-[#555]">{badge}</span>
                    <span className={[
                        'text-sm font-medium px-3 py-1 rounded',
                        percentage >= 70 ? 'bg-[#1a3a2a] text-[#68d391]'
                        : percentage >= 50 ? 'bg-[#3a2e1a] text-[#f6ad55]'
                        : 'bg-[#3a1a1a] text-[#fc8181]'
                    ].join(' ')}>
                        {percentage}%
                    </span>
                </div>
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
                    {q.feedback && <p className="text-[#f6ad55] text-xs mt-2">{q.feedback}</p>}
                </div>
            ))}
        </div>
    )
}
```

- [ ] **Step 2: Compile frontend**

```
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Run all backend tests**

```
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```
git add frontend/src/components/ExamResult.tsx
git commit -m "feat: grading-source badge on ExamResult (Answer Key vs Guide)"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] `gradingMode` field on Test — Task 2
- [x] `guidePages`/`guideSources` on Test — Task 2
- [x] `answerKeyText` optional on ExamRecord — Task 3
- [x] `POST /tests/:testId/guides` → 202 + jobId — Task 11
- [x] `GET /tests/:testId/guides/job/:jobId` poll — Task 11
- [x] One active job per test (409) — Task 10
- [x] Transactional swap in `saveGuidePages` — Task 4
- [x] TrOCR `/extract-guide` (PyMuPDF + Tesseract, no Gemini) — Task 5
- [x] Env-driven `TESSERACT_CMD` — Task 5
- [x] Remove `pandas` — Task 5
- [x] `AbortController` timeout on `extractText` — Task 6
- [x] `extractGuidePages` client (5 min timeout) — Task 6
- [x] Local keyword extraction (stopwords, stem, domain-generic) — Task 8
- [x] IDF weighting — Task 8
- [x] Per-page-length score normalisation — Task 8
- [x] ≥2 raw hits threshold, top-6 cap — Task 8
- [x] Gemini keyword fallback when <2 keywords or <2 pages qualify — Task 8
- [x] Context budget trim (800K chars, never below 1 page per matched Q) — Task 8
- [x] `gradeExamGuided` separate from `gradeExam` — Task 8
- [x] `hardenGradingJson` / `parseKeywordMap` extracted — Task 0
- [x] Node-side backoff (`callGeminiWithBackoff`) — Task 0
- [x] `hasGuide` = pages non-empty (not gradingMode === guidedBook) — Task 4
- [x] 409 when grading while extraction in flight — Task 10
- [x] 1200-page total ceiling — Task 10
- [x] TTL sweep (succeeded 1h, failed 24h) — Task 7
- [x] Mode toggle on frontend — Task 13
- [x] Guide uploader with job polling — Task 13
- [x] 3-state Grade button (ready / extracting / absent) — Task 13
- [x] ExamResult badge — Task 14
- [x] Route-scoped multer (50MB, PDF-only) — Task 9
- [x] Global multer unchanged — Tasks 9/11 (not touched)

**Type consistency check:**
- `IGuidePage` defined in Task 1, used in Tasks 4, 6, 8, 10 — consistent
- `IGuideJob` defined in Task 1, implemented in Task 7, returned in Task 10, polled in Task 11 — consistent
- `GradingMode` defined in Task 1 (backend) and Task 12 (frontend) — consistent
- `hardenGradingJson` defined in Task 0, imported in Task 8 — consistent
- `callGeminiWithBackoff` defined in Task 0, imported in Task 8 — consistent
- `getAI` exported in Task 0, imported (indirectly via `callGeminiWithBackoff`) in Task 8 — `gradeExamGuided` does not call `getAI` directly ✓
- `extractGuidePages` defined in Task 6, called in Task 10 — consistent
- `saveGuidePages(id, userId, pages, sources)` defined in Task 4, called in Task 10 — consistent
- `startGuideUpload` defined in Task 10, imported in Task 11 — consistent
- `getGuideJobStatus` defined in Task 10, imported in Task 11 — consistent

---

Plan complete and saved to `docs/superpowers/plans/2026-05-31-book-guided-grading.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, reviewed between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
