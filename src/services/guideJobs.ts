// src/services/guideJobs.ts
import { randomUUID } from 'crypto'
import { IGuideJob } from '../APIs/exam/types/exam.interface'

// In-memory store. A process restart loses in-flight jobs — acceptable because
// extraction is re-runnable and the transactional-replace rule means no guide
// is destroyed by a lost job. If multi-instance deployment is added, move this
// to Mongo or Redis.
const store = new Map<string, IGuideJob>()

const TTL_SUCCEEDED_MS = 60 * 60 * 1000 // 1 h
const TTL_FAILED_MS = 24 * 60 * 60 * 1000 // 24 h (keep errors actionable)
const TTL_OTHER_MS = 48 * 60 * 60 * 1000 // 48 h fallback

setInterval(
    () => {
        const now = Date.now()
        for (const [id, job] of store) {
            const ttl = job.status === 'succeeded' ? TTL_SUCCEEDED_MS : job.status === 'failed' ? TTL_FAILED_MS : TTL_OTHER_MS
            if (now - job.updatedAt > ttl) store.delete(id)
        }
    },
    10 * 60 * 1000
).unref()

export function createJob(testId: string, ownerId: string, totalFiles: number): IGuideJob {
    const job: IGuideJob = {
        jobId: randomUUID(),
        testId,
        ownerId,
        status: 'queued',
        progress: { done: 0, total: totalFiles },
        createdAt: Date.now(),
        updatedAt: Date.now()
    }
    store.set(job.jobId, job)
    return job
}

export function getJob(jobId: string): IGuideJob | undefined {
    return store.get(jobId)
}

export function updateJob(jobId: string, updates: Partial<Omit<IGuideJob, 'jobId' | 'testId' | 'ownerId' | 'createdAt'>>): void {
    const job = store.get(jobId)
    if (!job) return
    Object.assign(job, updates, { updatedAt: Date.now() })
}

export function getActiveJobForTest(testId: string): IGuideJob | undefined {
    for (const job of store.values()) {
        if (job.testId === testId && (job.status === 'queued' || job.status === 'extracting')) {
            return job
        }
    }
    return undefined
}

export function clearStore(): void {
    store.clear()
}
