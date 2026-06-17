interface Props {
    text: string
    confidence: number
    pipeline: string
    processingTimeMs: number
    filename?: string
}

export default function OcrResult({ text, confidence, pipeline, processingTimeMs, filename }: Props) {
    return (
        <div className="bg-[#16213e] rounded-lg p-4">
            {filename && (
                <p className="text-[#888] text-xs mb-2 truncate" title={filename}>
                    {filename}
                </p>
            )}
            {confidence < 30 && (
                <p className="text-[#f6ad55] text-xs mb-2">
                    ⚠ Low confidence — image may be unclear, lighting poor, or handwriting hard to read
                </p>
            )}
            <p className="text-[#4cc9f0] text-xs uppercase mb-2">Extracted Text</p>
            <p className="text-sm text-[#ccc] leading-relaxed whitespace-pre-wrap min-h-[80px]">
                {text || '—'}
            </p>
            <div className="flex gap-2 mt-3 flex-wrap">
                <span className="bg-[#0f3460] text-[#4cc9f0] text-xs rounded px-2 py-1">
                    Confidence: {confidence}%
                </span>
                <span className="bg-[#0f3460] text-[#4cc9f0] text-xs rounded px-2 py-1">
                    Pipeline: {pipeline}
                </span>
                <span className="bg-[#0f3460] text-[#888] text-xs rounded px-2 py-1">
                    {(processingTimeMs / 1000).toFixed(1)}s
                </span>
            </div>
        </div>
    )
}
