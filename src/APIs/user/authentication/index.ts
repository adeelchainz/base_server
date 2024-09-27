import { Router } from 'express'
import authenticationController from './authentication.controller'

const router = Router()

router.route('/register').post(authenticationController.register)

export default router
