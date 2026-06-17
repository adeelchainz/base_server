// src/__tests__/services/guidedGrading.test.ts
jest.mock('@google/genai', () => ({ GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: jest.fn() } })) }))
jest.mock('../../handlers/logger', () => ({ default: { info: jest.fn(), error: jest.fn() } }))
jest.mock('../../services/grading', () => ({
    callGeminiWithBackoff: jest.fn(),

    hardenGradingJson: jest.fn((raw: string) => JSON.parse(raw) as unknown),
    parseKeywordMap: jest.fn().mockReturnValue({})
}))

import { extractLocalKeywords, scorePages, computeIdf, trimToContextBudget, gradeExamGuided } from '../../services/guidedGrading'
import { IGuidePage } from '../../APIs/exam/types/exam.interface'
import { callGeminiWithBackoff } from '../../services/grading'

const makePage = (pageNumber: number, text: string, source = 'guide.pdf'): IGuidePage => ({ pageNumber, text, source })

describe('extractLocalKeywords', () => {
    it('strips stop words', () => {
        const kw = extractLocalKeywords('What is the process of photosynthesis')
        expect(kw).toContain('photosynthesi') // stemmed
        expect(kw).not.toContain('what')
        expect(kw).not.toContain('the')
        expect(kw).not.toContain('process') // domain generic
    })

    it('deduplicates', () => {
        const kw = extractLocalKeywords('mitochondria mitochondria ATP')
        expect(kw.filter((k) => k.includes('mitochondri')).length).toBe(1)
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
        const p3 = scored.find((s) => s.page.pageNumber === 3)!
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

describe('gradeExamGuided — single-pass', () => {
    beforeEach(() => {
        ;(callGeminiWithBackoff as jest.Mock).mockClear()
    })

    it('sends all options and guide pages to Gemini in one call (no pre-extraction)', async () => {
        const mockCall = callGeminiWithBackoff as jest.Mock
        mockCall.mockResolvedValue(
            JSON.stringify({
                totalScore: 1,
                maxScore: 1,
                questions: [{ number: 1, correctAnswer: 'B) Mars', studentAnswer: 'B) Mars', score: 'correct', feedback: '' }]
            })
        )

        const guidePages = [{ pageNumber: 1, text: 'Mars is called the Red Planet because of its reddish appearance.', source: 'guide.pdf' }]
        const studentPaper = '1. Which planet is the Red Planet? A) Venus B) Mars C) Jupiter D) Saturn → B) Mars'

        await gradeExamGuided(guidePages, studentPaper)

        // Should call Gemini exactly once (single-pass)
        expect(mockCall).toHaveBeenCalledTimes(1)

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const prompt: string = mockCall.mock.calls[0][0] as string
        // Prompt must contain all four options
        expect(prompt).toContain('A) Venus')
        expect(prompt).toContain('B) Mars')
        expect(prompt).toContain('C) Jupiter')
        expect(prompt).toContain('D) Saturn')
        // Prompt must contain guide content
        expect(prompt).toContain('Red Planet')
        // Prompt must NOT contain a pre-extracted correct answer header
        expect(prompt).not.toContain('CORRECT ANSWERS (derived')
    })
})
