import { Router } from 'express'
import ocrController from './ocr.controller'
import upload from '../../middlewares/upload'
import rateLimiter from '../../middlewares/rateLimiter'

const router = Router()

router.route('/ocr/extract').post(rateLimiter, upload.single('image'), ocrController.extract)
router.route('/ocr/batch').post(rateLimiter, upload.array('images', 20), ocrController.batch)

export default router
