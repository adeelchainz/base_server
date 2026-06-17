// src/services/ocr.ts
import { CustomError } from '../utils/errors'
import { IGuidePage } from '../APIs/exam/types/exam.interface'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logger = (require('../handlers/logger') as { default: typeof import('../handlers/logger').default }).default

const TROCR_URL = process.env.TROCR_URL ?? 'http://localhost:5001'
const EXTRACT_TIMEOUT_MS = 120_000 // 2 min for student paper / answer key
const GUIDE_TIMEOUT_MS = 300_000 // 5 min for guide PDF (may have scanned pages)

export type OcrMode = 'handwritten' | 'printed'

export interface IOcrResult {
    text: string
    confidence: number
    processingTimeMs: number
    pipeline: string
}

export interface IOcrBatchItem extends IOcrResult {
    originalname: string
    index: number
}

export type DocumentType = 'answer_key' | 'student_paper'

export const extractText = async (
    imageBuffer: Buffer,
    mode: OcrMode = 'handwritten',
    documentType: DocumentType = 'student_paper'
): Promise<IOcrResult> => {
    const form = new FormData()
    form.append('image', new Blob([imageBuffer]), 'image.bin')
    form.append('mode', mode)
    form.append('documentType', documentType)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS)

    let response: Response
    try {
        response = await fetch(`${TROCR_URL}/extract`, { method: 'POST', body: form, signal: controller.signal })
    } catch (err) {
        logger.error('OCR fetch failed', { meta: { error: (err as Error).message } })
        throw new CustomError('OCR service unavailable', 503)
    } finally {
        clearTimeout(timer)
    }

    if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new CustomError(body.error ?? `OCR service error (${response.status})`, response.status === 422 ? 422 : 500)
    }

    const data = (await response.json()) as {
        text: string
        confidence: number
        processingTimeMs: number
        pipeline: string
    }

    logger.info('OCR extraction complete', {
        meta: { confidence: data.confidence, pipeline: data.pipeline, processingTimeMs: data.processingTimeMs, mode }
    })

    return { text: data.text, confidence: data.confidence, processingTimeMs: data.processingTimeMs, pipeline: data.pipeline }
}

export const extractGuidePages = async (pdfBuffer: Buffer, filename: string): Promise<IGuidePage[]> => {
    const form = new FormData()
    form.append('pdf', new Blob([pdfBuffer]), filename)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), GUIDE_TIMEOUT_MS)

    let response: Response
    try {
        response = await fetch(`${TROCR_URL}/extract-guide`, { method: 'POST', body: form, signal: controller.signal })
    } catch (err) {
        logger.error('OCR fetch failed', { meta: { error: (err as Error).message } })
        throw new CustomError('OCR service unavailable', 503)
    } finally {
        clearTimeout(timer)
    }

    if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new CustomError(body.error ?? `Guide extraction error (${response.status})`, response.status === 422 ? 422 : 500)
    }

    const data = (await response.json()) as { pages: IGuidePage[] }
    return data.pages
}

export const detectStudentName = async (imageBuffer: Buffer): Promise<string | null> => {
    const form = new FormData()
    form.append('image', new Blob([imageBuffer]), 'image.bin')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)

    let response: Response
    try {
        response = await fetch(`${TROCR_URL}/detect-name`, { method: 'POST', body: form, signal: controller.signal })
    } catch {
        return null
    } finally {
        clearTimeout(timer)
    }

    if (!response.ok) return null
    const data = (await response.json().catch(() => ({}))) as { name?: string | null }
    return data.name ?? null
}

export const extractBatch = async (
    files: Array<{ buffer: Buffer; originalname: string }>,
    mode: OcrMode = 'handwritten'
): Promise<IOcrBatchItem[]> => {
    const results = await Promise.all(
        files.map(async ({ buffer, originalname }, index) => {
            const result = await extractText(buffer, mode)
            return { ...result, originalname, index }
        })
    )
    return results.sort((a, b) => a.index - b.index)
}
