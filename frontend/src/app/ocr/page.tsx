'use client'

import { useState } from 'react'
import { apiUpload } from '@/lib/api'
import ImageUploader from '@/components/ImageUploader'
import OcrResult from '@/components/OcrResult'

interface BatchItem {
    originalname: string
    index: number
    text: string
    confidence: number
    pipeline: string
    processingTimeMs: number
}

const ERROR_MESSAGES: Record<number, string> = {
    413: 'File too large — max 10 MB per file',
    422: 'No images provided',
    503: 'OCR service unavailable — make sure the Python TrOCR service is running',
    500: 'OCR processing failed'
}

type OcrMode = 'handwritten' | 'printed'

export default function OcrPage() {
    const [results, setResults] = useState<BatchItem[]>([])
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [progress, setProgress] = useState('')
    const [mode, setMode] = useState<OcrMode>('handwritten')

    async function handleUpload(files: File[]) {
        setError(null)
        setResults([])
        setLoading(true)
        setProgress(files.length > 1 ? `Processing ${files.length} files...` : 'Extracting...')

        try {
            const form = new FormData()
            files.forEach(f => form.append('images', f))
            form.append('mode', mode)
            const res = await apiUpload<BatchItem[]>('/v1/ocr/batch', form)
            setResults(res.data)
        } catch (err) {
            const status = (err as Error & { status?: number }).status ?? 500
            setError(ERROR_MESSAGES[status] ?? ERROR_MESSAGES[500])
        } finally {
            setLoading(false)
            setProgress('')
        }
    }

    return (
        <div className="max-w-2xl mx-auto px-4 py-8">
            <div className="bg-[#16213e] rounded-lg px-4 py-3 mb-6">
                <span className="text-[#4cc9f0] font-bold">✦ OCR Extract</span>
            </div>

            <div className="flex flex-col gap-4">
                <div className="flex gap-2">
                    {(['handwritten', 'printed'] as OcrMode[]).map(m => (
                        <button
                            key={m}
                            onClick={() => setMode(m)}
                            disabled={loading}
                            className={[
                                'px-4 py-1.5 rounded text-sm font-medium transition-colors',
                                mode === m
                                    ? 'bg-[#4cc9f0] text-[#0f0e17]'
                                    : 'bg-[#16213e] text-[#aaa] hover:text-[#4cc9f0]'
                            ].join(' ')}
                        >
                            {m.charAt(0).toUpperCase() + m.slice(1)}
                        </button>
                    ))}
                </div>
                <ImageUploader onUpload={handleUpload} disabled={loading} multiple />
                {loading && <p className="text-center text-sm text-[#aaa]">{progress}</p>}
                {error && <p className="text-center text-sm text-[#e94560]">{error}</p>}
                {results.map(item => (
                    <OcrResult
                        key={item.index}
                        text={item.text}
                        confidence={item.confidence}
                        pipeline={item.pipeline}
                        processingTimeMs={item.processingTimeMs}
                        filename={results.length > 1 ? item.originalname : undefined}
                    />
                ))}
            </div>
        </div>
    )
}
