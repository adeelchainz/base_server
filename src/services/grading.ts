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
    const cleaned = raw
        .replace(/^```(?:json)?\n?/i, '')
        .replace(/\n?```$/i, '')
        .trim()
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
            if (TRANSIENT_SIGNALS.some((s) => msg.includes(s)) && attempt < 2) {
                await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
                continue
            }
            throw new CustomError('Grading service unavailable.', 503)
        }
    }
    throw new CustomError('Grading service unavailable.', 503)
}

// ── Answer-key grading (unchanged signature) ──────────────────────────────────

const buildPrompt = (answerKeyText: string, studentPaperText: string): string =>
    `
You are an exam grader. You will be given an answer key and a student's exam paper.

ANSWER KEY:
${answerKeyText}

STUDENT PAPER:
${studentPaperText}

Instructions:
- Include EVERY question from the answer key — do not skip any.
- For each question, copy the student's answer verbatim. If the student left a question blank, wrote nothing, or the paper was blank, use an empty string "" for studentAnswer and mark it "wrong".
- Do NOT infer, guess, or fabricate answers. Only use text actually written or marked by the student.
- The student paper uses the format "[number]. [question text] → [marked answer]". The part after → is the student's answer. "(blank)" means unanswered — mark it wrong with empty studentAnswer.
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

export const gradeExam = async (answerKeyText: string, studentPaperText: string): Promise<IGradingResult> => {
    if (!answerKeyText.trim()) {
        throw new CustomError('Answer key text is empty — OCR may have failed.', 422)
    }

    const resolvedStudentText = studentPaperText.trim()
        ? studentPaperText
        : '[BLANK PAPER — student submitted no handwritten answers. Mark every question wrong with empty studentAnswer.]'

    const raw = await callGeminiWithBackoff(buildPrompt(answerKeyText, resolvedStudentText))

    if (!raw.trim()) {
        throw new CustomError('Grading service returned an empty response.', 503)
    }

    const result = hardenGradingJson(raw)
    logger.info('Exam graded', { meta: { totalScore: result.totalScore, maxScore: result.maxScore, questions: result.maxScore } })
    return result
}
