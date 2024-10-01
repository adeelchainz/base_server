import { Router } from 'express'
import authenticationController from './authentication.controller'

const router = Router()

router.route('/register').post(authenticationController.register)
router.route('/registeration/confirm/:token').patch(authenticationController.confirmRegistration)

export default router
