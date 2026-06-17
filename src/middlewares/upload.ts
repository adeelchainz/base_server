import multer, { FileFilterCallback } from 'multer'
import { Request } from 'express'

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/tiff', 'application/pdf']
const MAX_SIZE_BYTES = 10 * 1024 * 1024

const fileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(null, true)
    } else {
        cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: jpeg, png, webp, tiff, pdf`))
    }
}

export default multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SIZE_BYTES },
    fileFilter
})
