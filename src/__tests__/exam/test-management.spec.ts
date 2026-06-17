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
const mockSaveAnswerKey = jest.fn().mockResolvedValue(undefined)
const mockGetAnswerKey = jest.fn().mockResolvedValue(Buffer.from('key'))

jest.mock('../../APIs/exam/test.repository', () => ({
    __esModule: true,
    default: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        create: (...args: unknown[]) => mockTestCreate(...args),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        findById: (...args: unknown[]) => mockTestFindById(...args),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        listWithCounts: (...args: unknown[]) => mockListWithCounts(...args),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        getResults: (...args: unknown[]) => mockGetResults(...args),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        saveAnswerKey: (...args: unknown[]) => mockSaveAnswerKey(...args),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        getAnswerKey: (...args: unknown[]) => mockGetAnswerKey(...args)
    }
}))

const mockRecordCreate = jest.fn()
const mockRecordFindById = jest.fn()
const mockRecordFindByIdAndUpdate = jest.fn()

jest.mock('../../APIs/exam/exam.model', () => ({
    __esModule: true,
    default: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        create: (...args: unknown[]) => mockRecordCreate(...args),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        findById: (...args: unknown[]) => mockRecordFindById(...args),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        findByIdAndUpdate: (...args: unknown[]) => mockRecordFindByIdAndUpdate(...args)
    }
}))

const buf = Buffer.from('test')
const UID = 'user-1'

beforeEach(() => {
    jest.clearAllMocks()
    mockRecordFindById.mockReset()
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

        await gradeExamFiles(buf, buf, 'printed', 'Alice', UID, undefined, 'Chapter 5')

        expect(mockTestCreate).toHaveBeenCalledWith('Chapter 5', UID)
        expect(mockRecordCreate).toHaveBeenCalledWith(expect.objectContaining({ studentName: 'Alice', testId: 'new-test-id' }))
    })

    it('uses existing testId when provided', async () => {
        mockTestFindById.mockResolvedValue({ _id: 'existing-id', name: 'Midterm' })

        await gradeExamFiles(buf, buf, 'printed', 'Bob', UID, 'existing-id')

        expect(mockTestCreate).not.toHaveBeenCalled()
        expect(mockTestFindById).toHaveBeenCalledWith('existing-id', UID)
        expect(mockRecordCreate).toHaveBeenCalledWith(expect.objectContaining({ testId: 'existing-id', studentName: 'Bob' }))
    })

    it('throws 422 when neither testId nor testName is provided', async () => {
        await expect(gradeExamFiles(buf, buf, 'printed', 'Alice', UID)).rejects.toMatchObject({ statusCode: 422 })
    })

    it('throws 422 when studentName is empty', async () => {
        await expect(gradeExamFiles(buf, buf, 'printed', '', UID)).rejects.toMatchObject({ statusCode: 422 })
    })

    it('throws 404 when testId does not exist', async () => {
        mockTestFindById.mockResolvedValue(null)
        await expect(gradeExamFiles(buf, buf, 'printed', 'Alice', UID, 'bad-id')).rejects.toMatchObject({ statusCode: 404 })
    })
})

describe('listTests', () => {
    it('delegates to testRepository.listWithCounts with userId', async () => {
        const tests = [{ _id: '1', name: 'Quiz', studentCount: 3 }]
        mockListWithCounts.mockResolvedValue(tests)

        const result = await listTests(UID)

        expect(mockListWithCounts).toHaveBeenCalledWith(UID)
        expect(result).toEqual(tests)
    })
})

describe('getTestResults', () => {
    it('returns results when test exists', async () => {
        const payload = { test: { _id: '1', name: 'Quiz' }, stats: { avg: 75, high: 95, low: 55 }, records: [] }
        mockGetResults.mockResolvedValue(payload)

        const result = await getTestResults('1', UID)

        expect(mockGetResults).toHaveBeenCalledWith('1', UID)
        expect(result).toEqual(payload)
    })

    it('throws 404 when test not found', async () => {
        mockGetResults.mockResolvedValue(null)
        await expect(getTestResults('bad-id', UID)).rejects.toMatchObject({ statusCode: 404 })
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
        mockRecordFindById.mockReturnValue({ lean: () => Promise.resolve({ _id: 'rec-1', testId: 'test-id' }) })
        mockTestFindById.mockResolvedValue({ _id: 'test-id', name: 'Quiz' })
        mockRecordFindByIdAndUpdate.mockReturnValue({ lean: () => Promise.resolve(updated) })

        const result = await editExamRecord('rec-1', questions, UID)

        expect(mockTestFindById).toHaveBeenCalledWith('test-id', UID)
        expect(mockRecordFindByIdAndUpdate).toHaveBeenCalledWith(
            'rec-1',
            { $set: { questions, totalScore: 2, maxScore: 3, percentage: 67 } },
            { new: true, runValidators: true }
        )
        expect(result).toEqual(updated)
    })

    it('throws 404 when record not found', async () => {
        mockRecordFindById.mockReturnValue({ lean: () => Promise.resolve(null) })
        await expect(editExamRecord('rec-1', questions, UID)).rejects.toMatchObject({ statusCode: 404 })
    })

    it('throws 404 when record belongs to another user', async () => {
        mockRecordFindById.mockReturnValue({ lean: () => Promise.resolve({ _id: 'rec-1', testId: 'test-id' }) })
        mockTestFindById.mockResolvedValue(null)
        await expect(editExamRecord('rec-1', questions, UID)).rejects.toMatchObject({ statusCode: 404 })
    })
})
