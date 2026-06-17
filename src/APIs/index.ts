import { Application } from 'express'
import { API_ROOT } from '../constant/application'

import General from './router'
import authRoutes from './user/authentication'
import userManagementRoutes from './user/management'
import ocrRoutes from './ocr'
import examRoutes from './exam'

const App = (app: Application) => {
    app.use(`${API_ROOT}`, General)
    app.use(`${API_ROOT}`, authRoutes)
    app.use(`${API_ROOT}/user`, userManagementRoutes)
    app.use(`${API_ROOT}`, ocrRoutes)
    app.use(`${API_ROOT}`, examRoutes)
}

export default App
