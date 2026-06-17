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

const resolveTestId = async (
    testId: string | undefined,
    testName: string | undefined,
    userId: string
): Promise<{ resolvedId: string; test: import('./types/exam.interface').ITest | null }> => {
    if (testId) {
        const test = await testRepository.findById(testId, userId)
        if (!test) throw new CustomError('Test not found', 404)
        return { resolvedId: testId, test }
    }
    if (testName?.trim()) {
        const created = await testRepository.create(testName.trim(), userId)
        return { resolvedId: created._id!.toString(), test: null }
    }
    throw new CustomError('Either testId or testName is required', 422)
}

export const previewStudentPaper = async (studentPaperBuffer: Buffer, mode: OcrMode): Promise<string> => {
    try {
        return (await extractText(studentPaperBuffer, mode, 'student_paper')).text
    } catch (err) {
        const msg = err instanceof CustomError ? err.message : 'OCR failed'
        throw new CustomError(msg, 422)
    }
}

export const gradeExamFiles = async (
    answerKeyBuffer: Buffer | null,
    studentPaperBuffer: Buffer,
    mode: OcrMode,
    studentName: string,
    userId: string,
    testId?: string,
    testName?: string,
    previewedStudentText?: string
): Promise<IExamRecord & { testId: string }> => {
    if (!studentName?.trim()) throw new CustomError('Student name is required', 422)

    const { resolvedId: resolvedTestId, test } = await resolveTestId(testId, testName, userId)

    // ── Guided-book grading branch ────────────────────────────────────────────
    if (test?.gradingMode === 'guidedBook') {
        const activeJob = jobStore.getActiveJobForTest(resolvedTestId)
        if (activeJob) throw new CustomError('Guide is still being processed — try again shortly.', 409)

        const guideInfo = await testRepository.getGuidePages(resolvedTestId, userId)
        if (!guideInfo || guideInfo.pages.length === 0) {
            throw new CustomError('No guide pages available for this test — upload a guide PDF first.', 422)
        }

        let studentPaperText: string
        if (previewedStudentText !== undefined && previewedStudentText.trim()) {
            studentPaperText = previewedStudentText
        } else {
            try {
                studentPaperText = (await extractText(studentPaperBuffer, mode, 'student_paper')).text
            } catch (err) {
                const msg = err instanceof CustomError ? err.message : 'Could not extract text from student paper.'
                throw new CustomError(`Student paper: ${msg}`, 422)
            }
        }

        const grading = await gradeExamGuided(guideInfo.pages, studentPaperText)
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

    if (previewedStudentText !== undefined && previewedStudentText.trim()) {
        studentPaperText = previewedStudentText
    } else {
        try {
            studentPaperText = (await extractText(studentPaperBuffer, mode, 'student_paper')).text
        } catch (err) {
            const msg = err instanceof CustomError ? err.message : 'Could not extract text from student paper.'
            throw new CustomError(`Student paper: ${msg}`, 422)
        }
    }

    const grading = await gradeExam(answerKeyText, studentPaperText)
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
                const baseMsg = err instanceof CustomError ? err.message : `Failed to extract ${file.originalname}`
                const msg = `${baseMsg} — re-upload all guide files to retry.`
                jobStore.updateJob(jobId, { status: 'failed', error: { message: msg, filename: file.originalname } })
                return
            }
            const renumbered = pages.map((p) => ({ ...p, pageNumber: p.pageNumber + pageOffset }))
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
    } catch (err) {
        logger.error('Guide extraction failed unexpectedly', { meta: { jobId, error: (err as Error).message } })
        jobStore.updateJob(jobId, { status: 'failed', error: { message: 'Extraction failed unexpectedly.' } })
    }
}

export const getGuideJobStatus = (testId: string, jobId: string, userId: string): Promise<IGuideJob | null> => {
    const job = jobStore.getJob(jobId)
    if (!job || job.testId !== testId || job.ownerId !== userId) return Promise.resolve(null)
    return Promise.resolve(job)
}

// ── Test creation ─────────────────────────────────────────────────────────────

export const createTest = async (name: string, userId: string): Promise<import('./types/exam.interface').ITest> => {
    if (!name?.trim()) throw new CustomError('Test name is required', 422)
    return testRepository.create(name.trim(), userId)
}

// ── Existing exports (unchanged) ──────────────────────────────────────────────

export const listTests = async (userId: string): Promise<ITestWithCount[]> => testRepository.listWithCounts(userId)

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
