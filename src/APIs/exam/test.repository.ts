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
        // Exclude answerKey and guidePages buffers from list — only flag their presence
        const tests = await TestModel.find({ userId }).select('-answerKey -guidePages').sort({ createdAt: -1 }).lean()
        const testIds = tests.map((t) => t._id)
        const counts = await ExamRecord.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
            { $match: { testId: { $in: testIds } } },
            { $group: { _id: '$testId', count: { $sum: 1 } } }
        ])
        const countMap = new Map(counts.map((c) => [c._id.toString(), c.count]))
        const withKeys = await TestModel.find({ userId, answerKey: { $exists: true } })
            .select('_id')
            .lean()
        const keySet = new Set(withKeys.map((t) => t._id?.toString() ?? ''))
        const withGuides = await TestModel.find({ userId, 'guidePages.0': { $exists: true } })
            .select('_id')
            .lean()
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
