import { Router } from 'express'
import managementController from './management.controller'
import authenticate from '../../../middlewares/authenticate'

const router = Router()

router.route('/me').get(authenticate, managementController.me)

export default router
