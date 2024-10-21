import { Router } from 'express'
import projectFuntionality from './site-production/functionality/functionality.controller'
// import authenticate from '../middlewares/authenticate'

const router = Router()

router.route('/').post(projectFuntionality.createProject)
router.route('/delete-project/:projectId').delete(projectFuntionality.deleteProject)
router.route('/:projectId').patch(projectFuntionality.updateProject)
router.route('/confirm-project/:token').get(projectFuntionality.confirmProject)

export default router
