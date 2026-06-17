import { NextFunction, Request, Response } from 'express'
import multer from 'multer'
import { THttpError } from '../types/types'
import errorObject from '../handlers/errorHandler/errorObject'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default (err: THttpError | Error, req: Request, res: Response, __: NextFunction): void => {
    if (err instanceof multer.MulterError) {
        const statusCode = err.code === 'LIMIT_FILE_SIZE' ? 413 : 422
        res.status(statusCode).json(errorObject(err, req, statusCode))
    } else if (!('request' in err && 'data' in err)) {
        // Raw Error (e.g. multer file-filter rejection) — format before sending
        const statusCode = 'statusCode' in err && typeof (err as Record<string, unknown>).statusCode === 'number'
            ? (err as unknown as { statusCode: number }).statusCode
            : 422
        res.status(statusCode).json(errorObject(err, req, statusCode))
    } else {
        const httpErr = err
        res.status(httpErr.statusCode ?? 500).json(httpErr)
    }
}
