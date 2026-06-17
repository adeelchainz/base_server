'use client'

import { useRef, useState, DragEvent } from 'react'

interface Props {
    onUpload: (files: File[]) => void
    disabled?: boolean
    multiple?: boolean
}

export default function ImageUploader({ onUpload, disabled, multiple = false }: Props) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [dragging, setDragging] = useState(false)

    function handleFiles(files: FileList | null) {
        if (!files || files.length === 0) return
        onUpload(Array.from(files))
    }

    function onDrop(e: DragEvent) {
        e.preventDefault()
        if (disabled) return
        setDragging(false)
        handleFiles(e.dataTransfer.files)
    }

    return (
        <div
            onClick={() => !disabled && inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={[
                'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
                dragging ? 'border-[#4cc9f0] bg-[#0f3460]/20' : 'border-[#4cc9f0]/40 hover:border-[#4cc9f0]',
                disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
            ].join(' ')}
        >
            <div className="text-3xl mb-2">📄</div>
            <p className="text-sm text-[#aaa]">
                {multiple ? 'Drop images here or click to upload' : 'Drop image here or click to upload'}
            </p>
            <p className="text-xs text-[#555] mt-1">
                PNG, JPG, WEBP, TIFF, PDF · max 10 MB{multiple ? ' · multiple files supported' : ''}
            </p>
            <input
                ref={inputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.tiff,.pdf,image/png,image/jpeg,image/webp,image/tiff,application/pdf"
                multiple={multiple}
                className="hidden"
                onChange={e => handleFiles(e.target.files)}
                disabled={disabled}
            />
        </div>
    )
}
