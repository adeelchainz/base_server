// src/APIs/exam/exam.controller.ts
import { NextFunction, Request, Response } from 'express'
import httpResponse from '../../handlers/httpResponse'
import httpError from '../../handlers/errorHandler/httpError'
import asyncHandler from '../../handlers/async'
import { CustomError } from '../../utils/errors'
import { OcrMode } from '../../services/ocr'
import { IAuthenticateRequest } from '../../types/types'
import {
    gradeExamFiles,
    listTests,
    getTestResults,
    editExamRecord,
    startGuideUpload,
    getGuideJobStatus,
    createTest,
    previewStudentPaper
} from './exam.service'
import { detectStudentName } from '../../services/ocr'

export default {
    grade: asyncHandler(async (request: Request, response: Response, next: NextFunction) => {
        try {
            const files = request.files as Record<string, Express.Multer.File[]> | undefined
            const answerKey = files?.['answerKey']?.[0]
            const studentPaper = files?.['studentPaper']?.[0]

            if (!studentPaper) throw new CustomError('Student paper file is required.', 422)

            const userId = (request as IAuthenticateRequest).authenticatedUser._id.toString()
            const body = request.body as { mode?: OcrMode; studentName?: string; testId?: string; testName?: string; studentPaperText?: string }
            const mode: OcrMode = body.mode ?? 'printed'
            const result = await gradeExamFiles(
                answerKey?.buffer ?? null,
                studentPaper.buffer,
                mode,
                body.studentName ?? '',
                userId,
                body.testId,
                body.testName,
                body.studentPaperText
            )
            httpResponse(response, request, 200, 'Exam graded successfully', result)
        } catch (error) {
            if (error instanceof CustomError) httpError(next, error, request, error.statusCode)
            else httpError(next, error, request, 500)
        }
    }),

    createTest: asyncHandler(async (request: Request, response: Response, next: NextFunction) => {
        try {
            const userId = (request as IAuthenticateRequest).authenticatedUser._id.toString()
            const { name } = request.body as { name?: string }
            const test = await createTest(name ?? '', userId)
            httpResponse(response, request, 201, 'Test created', test)
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
                files.map((f) => ({ buffer: f.buffer, originalname: f.originalname }))
            )
            httpResponse(response, request, 202, 'Guide extraction started', result)
        } catch (error) {
            if (error instanceof CustomError) httpError(next, error, request, error.statusCode)
            else httpError(next, error, request, 500)
        }
    }),

    ocrPreview: asyncHandler(async (request: Request, response: Response, next: NextFunction) => {
        try {
            const files = request.files as Record<string, Express.Multer.File[]> | undefined
            const file = files?.['studentPaper']?.[0]
            if (!file) throw new CustomError('Student paper file is required.', 422)
            const body = request.body as { mode?: OcrMode }
            const text = await previewStudentPaper(file.buffer, body.mode ?? 'printed')
            httpResponse(response, request, 200, 'OCR preview complete', { text })
        } catch (error) {
            if (error instanceof CustomError) httpError(next, error, request, error.statusCode)
            else httpError(next, error, request, 500)
        }
    }),

    detectName: asyncHandler(async (request: Request, response: Response, next: NextFunction) => {
        try {
            const files = request.files as Record<string, Express.Multer.File[]> | undefined
            const file = files?.['studentPaper']?.[0]
            if (!file) throw new CustomError('Student paper file is required.', 422)
            const name = await detectStudentName(file.buffer)
            httpResponse(response, request, 200, 'Name detection complete', { name })
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
