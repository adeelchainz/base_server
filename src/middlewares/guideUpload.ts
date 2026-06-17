// src/middlewares/guideUpload.ts
import multer, { FileFilterCallback } from 'multer'
import { Request } from 'express'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB per file — covers real textbooks

const guideFileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (file.mimetype === 'application/pdf') {
        cb(null, true)
    } else {
        cb(new Error(`Guide files must be PDF (received ${file.mimetype})`))
    }
}

export default multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE, files: 10 },
    fileFilter: guideFileFilter
})
