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

        expect(result.totalScore).toBe(2) // recomputed: 2 correct × 1 + 2 wrong × 0
        expect(result.maxScore).toBe(4) // recomputed: total questions
        expect(result.questions).toHaveLength(4)
        expect(result.questions[1].score).toBe('wrong')
        expect(result.questions[1].feedback).toBe('The formula for water is H2O, not H20.')
    })

    it('strips markdown code fences from Gemini response', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            text: '```json\n' + JSON.stringify(validGeminiResponse) + '\n```'
        })

        const result: IGradingResult = await gradeExam('answer key text', 'student paper text')
        expect(result.totalScore).toBe(2) // recomputed from questions
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

    it('still grades when student paper text is empty (blank paper = score 0)', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            text: JSON.stringify({
                totalScore: 0,
                maxScore: 4,
                questions: [
                    { number: 1, correctAnswer: 'Paris', studentAnswer: '', score: 'wrong', feedback: 'No answer provided.' },
                    { number: 2, correctAnswer: 'H2O', studentAnswer: '', score: 'wrong', feedback: 'No answer provided.' },
                    { number: 3, correctAnswer: 'Newton', studentAnswer: '', score: 'wrong', feedback: 'No answer provided.' },
                    { number: 4, correctAnswer: '4', studentAnswer: '', score: 'wrong', feedback: 'No answer provided.' }
                ]
            })
        })

        const result = await gradeExam('answer key text', '')
        expect(result.totalScore).toBe(0)
        expect(result.maxScore).toBe(4)
        expect(result.questions.every((q) => q.score === 'wrong')).toBe(true)
        expect(result.questions.every((q) => q.studentAnswer === '')).toBe(true)
    })
})
