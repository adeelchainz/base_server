import { Router } from 'express';
import controller from './controller';

const router=Router();

router.route('/self').get(controller.self)

export default router