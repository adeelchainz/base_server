import { Router } from 'express'
import projectFuntionality from './site-production/functionality/functionality.controller'
// import authenticate from '../middlewares/authenticate'
import asyncHandler from '../handlers/async'

const router = Router()

router.route('/').post(asyncHandler(projectFuntionality.createProject))
router.route('/delete-project/:projectId').delete(asyncHandler(projectFuntionality.deleteProject))
router.route('/:projectId').patch(asyncHandler(projectFuntionality.updateProject))
router.route('/confirm-project/:token').get(asyncHandler(projectFuntionality.confirmProject))

export default router
