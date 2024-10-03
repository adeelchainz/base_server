import { Router } from 'express'
import controller from './controller'
import rateLimiter from '../middlewares/rateLimiter'

const router = Router()

router.route('/self').get(rateLimiter, controller.self)
router.route('/health').get(controller.health)

export default router
