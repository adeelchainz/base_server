import { Router } from 'express'
import authenticationController from './authentication.controller'
import authenticate from '../../../middlewares/authenticate'
import rateLimiter from '../../../middlewares/rateLimiter'

const router = Router()

router.route('/register').post(rateLimiter, authenticationController.register)
router.route('/registeration/confirm/:token').patch(rateLimiter, authenticationController.confirmRegistration)

router.route('/login').post(rateLimiter, authenticationController.login)
router.route('/logout').put(authenticate, authenticationController.logout)

export default router
