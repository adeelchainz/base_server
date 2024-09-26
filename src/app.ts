import express, { Application } from 'express'
import path from 'path'
import router from './APIs/router'
import errorHandler from './middlewares/errorHandler'
import notFound from './handlers/notFound'
import helmet from 'helmet'
import cors from 'cors'

const app: Application = express()

//Middlewares
app.use(helmet())
app.use(
    cors({
        methods: ['GET', 'POST', 'DELETE', 'OPTIONS', 'HEAD', 'PUT', 'PATCH'],
        origin: ['https://xyz.com'],
        credentials: true
    })
)
app.use(express.json())
app.use(express.static(path.join(__dirname, '../', 'public')))

//Router
app.use('/v1', router)

//404 handler
app.use(notFound)

//Handlers as Middlewares
app.use(errorHandler)

export default app
