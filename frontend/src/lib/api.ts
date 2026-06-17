import type { GuideJobPoll } from '@/types/exam'

export interface BackendResponse<T> {
    success: boolean
    statusCode: number
    message: string
    data: T
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<BackendResponse<T>> {
    const isJson = init?.body !== undefined && !(init.body instanceof FormData)
    const res = await fetch(`${API_BASE}${path}`, {
        ...init,
        credentials: 'include',
        headers: {
            ...(isJson ? { 'Content-Type': 'application/json' } : {}),
            ...init?.headers
        }
    })

    if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string }
        const error = new Error(err.message ?? res.statusText) as Error & { status: number }
        error.status = res.status
        throw error
    }

    return res.json() as Promise<BackendResponse<T>>
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<BackendResponse<T>> {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        credentials: 'include',
        body: formData
    })

    if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string }
        const error = new Error(err.message ?? res.statusText) as Error & { status: number }
        error.status = res.status
        throw error
    }

    return res.json() as Promise<BackendResponse<T>>
}

export async function createTest(name: string): Promise<BackendResponse<{ _id: string; name: string }>> {
    return apiFetch('/v1/exam/tests', { method: 'POST', body: JSON.stringify({ name }) })
}

export async function uploadGuides(testId: string, files: File[]): Promise<BackendResponse<{ jobId: string }>> {
    const form = new FormData()
    files.forEach(f => form.append('guides', f))
    return apiUpload<{ jobId: string }>(`/v1/exam/tests/${testId}/guides`, form)
}

export async function pollGuideJob(testId: string, jobId: string): Promise<BackendResponse<GuideJobPoll>> {
    return apiFetch(`/v1/exam/tests/${testId}/guides/job/${jobId}`)
}

export async function ocrPreview(file: File, mode: string): Promise<string> {
    const form = new FormData()
    form.append('studentPaper', file)
    form.append('mode', mode)
    try {
        const res = await apiUpload<{ text: string }>('/v1/exam/ocr-preview', form)
        return res.data.text ?? ''
    } catch {
        return ''
    }
}

export async function detectStudentName(file: File): Promise<string | null> {
    const form = new FormData()
    form.append('studentPaper', file)
    try {
        const res = await apiUpload<{ name: string | null }>('/v1/exam/detect-name', form)
        return res.data.name ?? null
    } catch {
        return null
    }
}
