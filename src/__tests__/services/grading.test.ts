// src/__tests__/services/grading.test.ts
jest.mock('@google/genai', () => ({ GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: jest.fn() } })) }))
jest.mock('../../handlers/logger', () => ({ default: { info: jest.fn(), error: jest.fn() } }))

import { hardenGradingJson, parseKeywordMap } from '../../services/grading'
import { CustomError } from '../../utils/errors'

describe('hardenGradingJson', () => {
    it('parses valid grading JSON', () => {
        const raw = JSON.stringify({
            totalScore: 2,
            maxScore: 3,
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
        const raw =
            '```json\n{"totalScore":1,"maxScore":1,"questions":[{"number":1,"correctAnswer":"X","studentAnswer":"X","score":"correct","feedback":""}]}\n```'
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
            totalScore: 0,
            maxScore: 1,
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
