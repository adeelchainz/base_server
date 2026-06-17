// src/__tests__/services/guideJobs.test.ts
import { createJob, getJob, updateJob, getActiveJobForTest, clearStore } from '../../services/guideJobs'

describe('guideJobs', () => {
    beforeEach(() => {
        clearStore()
    })

    it('creates a job in queued state', () => {
        const job = createJob('test1', 'user1', 3)
        expect(job.status).toBe('queued')
        expect(job.progress).toEqual({ done: 0, total: 3 })
        expect(job.testId).toBe('test1')
        expect(job.ownerId).toBe('user1')
        expect(job.jobId).toBeTruthy()
    })

    it('retrieves a job by id', () => {
        const job = createJob('test2', 'user2', 1)
        expect(getJob(job.jobId)).toBeDefined()
        expect(getJob('nonexistent')).toBeUndefined()
    })

    it('updates job fields', () => {
        const job = createJob('test3', 'user3', 2)
        updateJob(job.jobId, { status: 'extracting', progress: { done: 1, total: 2 } })
        const updated = getJob(job.jobId)!
        expect(updated.status).toBe('extracting')
        expect(updated.progress.done).toBe(1)
    })

    it('getActiveJobForTest returns active job', () => {
        const job = createJob('testActive', 'userA', 1)
        expect(getActiveJobForTest('testActive')).toBeDefined()
        updateJob(job.jobId, { status: 'succeeded' })
        expect(getActiveJobForTest('testActive')).toBeUndefined()
    })

    it('getActiveJobForTest ignores failed jobs', () => {
        const job = createJob('testFailed', 'userB', 1)
        updateJob(job.jobId, { status: 'failed' })
        expect(getActiveJobForTest('testFailed')).toBeUndefined()
    })
})
