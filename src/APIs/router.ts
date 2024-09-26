import { Router } from 'express'
import controller from './controller'

const router = Router()

router.route('/self').get(controller.self)
router.route('/health').get(controller.health)

export default router
