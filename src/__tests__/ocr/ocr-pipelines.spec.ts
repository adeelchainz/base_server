// src/__tests__/ocr/ocr-pipelines.spec.ts
import { extractText, IOcrResult } from '../../services/ocr'

jest.mock('../../handlers/logger', () => ({
    default: { info: jest.fn(), error: jest.fn() }
}))

describe('extractText', () => {
    const fakeBuffer = Buffer.from('fake-image')
    const mockFetch = jest.fn()

    beforeEach(() => {
        global.fetch = mockFetch as typeof global.fetch
    })

    afterEach(() => jest.clearAllMocks())

    it('calls the TrOCR service and returns the result', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ text: 'Hello world', confidence: 87, processingTimeMs: 420, pipeline: 'gemini-2.0-flash' })
        })

        const result: IOcrResult = await extractText(fakeBuffer)

        expect(result.text).toBe('Hello world')
        expect(result.confidence).toBe(87)
        expect(result.processingTimeMs).toBe(420)
        expect(result.pipeline).toBe('gemini-2.0-flash')
        expect(mockFetch).toHaveBeenCalledWith('http://localhost:5001/extract', expect.objectContaining({ method: 'POST' }))
    })

    it('throws 503 when the TrOCR service is unreachable', async () => {
        mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))

        await expect(extractText(fakeBuffer)).rejects.toMatchObject({
            message: 'OCR service unavailable',
            statusCode: 503
        })
    })

    it('throws 422 when the TrOCR service reports no image provided', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 422, json: () => Promise.resolve({ error: 'No image provided' }) })

        await expect(extractText(fakeBuffer)).rejects.toMatchObject({
            message: 'No image provided',
            statusCode: 422
        })
    })

    it('throws 500 when the TrOCR service returns an error response', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) })

        await expect(extractText(fakeBuffer)).rejects.toMatchObject({
            statusCode: 500
        })
    })
})
