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
    upload.fields([
        { name: 'answerKey', maxCount: 1 },
        { name: 'studentPaper', maxCount: 1 }
    ]),
    examController.grade
)

router.route('/exam/tests').get(rateLimiter, authenticate, examController.tests).post(rateLimiter, authenticate, examController.createTest)

router.route('/exam/tests/:testId/results').get(rateLimiter, authenticate, examController.testResults)

router.route('/exam/tests/:testId/guides').post(rateLimiter, authenticate, guideUpload.array('guides', 10), examController.uploadGuide)

router.route('/exam/tests/:testId/guides/job/:jobId').get(rateLimiter, authenticate, examController.pollGuideJob)

router.route('/exam/ocr-preview').post(rateLimiter, authenticate, upload.fields([{ name: 'studentPaper', maxCount: 1 }]), examController.ocrPreview)

router.route('/exam/detect-name').post(rateLimiter, authenticate, upload.fields([{ name: 'studentPaper', maxCount: 1 }]), examController.detectName)

router.route('/exam/records/:recordId').patch(rateLimiter, authenticate, examController.editRecord)

export default router
