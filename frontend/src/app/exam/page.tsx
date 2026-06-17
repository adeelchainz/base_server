'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/context/auth'
import { apiFetch, apiUpload, uploadGuides, pollGuideJob, createTest as apiCreateTest, ocrPreview } from '@/lib/api'
import ExamResult from '@/components/ExamResult'
import { GradeResult, TestItem, GradingMode } from '@/types/exam'

type OcrMode = 'handwritten' | 'printed'

const ERROR_MESSAGES: Record<number, string> = {
    409: 'Guide is still being processed — try again shortly',
    413: 'File too large — max 10 MB for papers, 50 MB per guide PDF',
    422: 'Could not process files — ensure they are clear and readable',
    503: 'Grading service unavailable — make sure the Python OCR service is running',
    500: 'Grading failed'
}

export default function ExamPage() {
    const { user, loading } = useAuth()

    const [tests, setTests] = useState<TestItem[]>([])
    const [testsError, setTestsError] = useState<string | null>(null)
    const [selectedTestId, setSelectedTestId] = useState<string>('')
    const [newTestName, setNewTestName] = useState<string>('')

    const [gradingMode, setGradingMode] = useState<GradingMode>('answerKey')
    const [studentName, setStudentName] = useState<string>('')
    const [answerKey, setAnswerKey] = useState<File | null>(null)
    const [studentPaper, setStudentPaper] = useState<File | null>(null)
    const [mode, setMode] = useState<OcrMode>('printed')

    const [result, setResult] = useState<GradeResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [grading, setGrading] = useState(false)

    const [scannedText, setScannedText] = useState<string | null>(null)
    const [editedText, setEditedText] = useState<string>('')
    const [scanning, setScanning] = useState(false)
    const [previewOpen, setPreviewOpen] = useState(false)

    // Guide upload job state
    const [guideJobId, setGuideJobId] = useState<string | null>(null)
    const [guideStatus, setGuideStatus] = useState<'idle' | 'uploading' | 'extracting' | 'done' | 'failed'>('idle')
    const [guideProgress, setGuideProgress] = useState<{ done: number; total: number } | null>(null)
    const [guideError, setGuideError] = useState<string | null>(null)
    const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        if (!loading && !user) window.location.href = '/login'
    }, [user, loading])

    const loadTests = () => {
        apiFetch<TestItem[]>('/v1/exam/tests')
            .then(res => { setTests(res.data); setTestsError(null) })
            .catch((err: Error & { status?: number }) => {
                if (err.status === 401) { window.location.href = '/login'; return }
                setTestsError('Could not load tests — you can still create a new one below')
            })
    }

    useEffect(() => { if (user) loadTests() }, [user])  // eslint-disable-line react-hooks/exhaustive-deps

    // Sync gradingMode when selected test changes, but don't override while a guide is being uploaded
    useEffect(() => {
        const t = tests.find(t => t._id === selectedTestId)
        if (t && guideStatus !== 'uploading' && guideStatus !== 'extracting') {
            setGradingMode(t.gradingMode ?? 'answerKey')
        }
    }, [selectedTestId, tests, guideStatus])

    // Poll guide job
    useEffect(() => {
        if (!guideJobId || !selectedTestId || guideStatus === 'done' || guideStatus === 'failed' || guideStatus === 'idle') return
        const poll = async () => {
            try {
                const res = await pollGuideJob(selectedTestId, guideJobId)
                const { status, progress, error: jobErr } = res.data
                setGuideProgress(progress)
                if (status === 'succeeded') {
                    setGuideStatus('done')
                    loadTests()
                } else if (status === 'failed') {
                    setGuideStatus('failed')
                    setGuideError(jobErr?.message ?? 'Guide extraction failed.')
                } else {
                    setGuideStatus('extracting')
                    pollRef.current = setTimeout(poll, 2000)
                }
            } catch {
                setGuideStatus('failed')
                setGuideError('Could not reach server while polling guide status.')
            }
        }
        pollRef.current = setTimeout(poll, 1500)
        return () => { if (pollRef.current) clearTimeout(pollRef.current) }
    }, [guideJobId, selectedTestId, guideStatus])  // eslint-disable-line react-hooks/exhaustive-deps

    const selectedTest = tests.find(t => t._id === selectedTestId) ?? null
    const isNewTest = selectedTestId === '__new__'
    const testReady = selectedTestId !== '' && (!isNewTest || newTestName.trim() !== '')

    const guideIsExtracting = guideStatus === 'uploading' || guideStatus === 'extracting'
    const hasGuide = selectedTest?.hasGuide === true || guideStatus === 'done'
    const keyReady = gradingMode === 'answerKey'
        ? (answerKey !== null || (!isNewTest && selectedTest?.hasAnswerKey === true))
        : hasGuide

    const canGrade = testReady && studentName.trim() !== '' && keyReady && studentPaper !== null && !grading && !guideIsExtracting && !scanning

    async function handleGrade() {
        if (!canGrade || !studentPaper) return
        setError(null); setResult(null); setGrading(true)
        try {
            const form = new FormData()
            if (gradingMode === 'answerKey' && answerKey) form.append('answerKey', answerKey)
            form.append('studentPaper', studentPaper)
            form.append('mode', mode)
            form.append('studentName', studentName.trim())
            if (isNewTest) form.append('testName', newTestName.trim())
            else form.append('testId', selectedTestId)
            if (scannedText !== null) form.append('studentPaperText', editedText)

            const res = await apiUpload<GradeResult>('/v1/exam/grade', form)
            setResult(res.data)
            setStudentName(''); setStudentPaper(null); setAnswerKey(null)
            setScannedText(null); setEditedText(''); setPreviewOpen(false)
            setSelectedTestId(res.data.testId); setNewTestName('')
            loadTests()
        } catch (err) {
            const e = err as Error & { status?: number }
            const status = e.status ?? 500
            if (status === 401) { window.location.href = '/login'; return }
            setError(e.message && e.message !== 'Internal Server Error'
                ? e.message
                : (ERROR_MESSAGES[status] ?? ERROR_MESSAGES[500]))
        } finally {
            setGrading(false)
        }
    }

    async function handleGuideUpload(files: FileList | null) {
        if (!files || files.length === 0) return

        let uploadTestId = selectedTestId

        if (isNewTest) {
            if (!newTestName.trim()) return
            try {
                const res = await apiCreateTest(newTestName.trim())
                uploadTestId = res.data._id
                setSelectedTestId(uploadTestId)
                setNewTestName('')
                loadTests()
            } catch (err) {
                const e = err as Error & { status?: number }
                if (e.status === 401) { window.location.href = '/login'; return }
                setGuideStatus('failed')
                setGuideError(e.message ?? 'Failed to create test.')
                return
            }
        }

        if (!uploadTestId) return

        const arr = Array.from(files)
        setGuideStatus('uploading')
        setGuideError(null)
        try {
            const res = await uploadGuides(uploadTestId, arr)
            setGuideJobId(res.data.jobId)
            setGuideStatus('extracting')
        } catch (err) {
            const e = err as Error & { status?: number }
            setGuideStatus('failed')
            setGuideError(e.message ?? 'Failed to start guide upload.')
        }
    }

    async function handleStudentPaperChange(file: File | null) {
        setStudentPaper(file)
        setScannedText(null)
        setEditedText('')
        setPreviewOpen(false)
        if (!file) return

        setScanning(true)
        const raw = await ocrPreview(file, mode)
        setScanning(false)

        if (!raw) return

        // The OCR prompt outputs "Name: [name]" as the first line.
        // Strip it before showing in the review panel so the grader doesn't see it.
        const lines = raw.split('\n')
        let detectedName: string | null = null
        let bodyStart = 0
        if (/^name:\s*/i.test(lines[0]?.trim() ?? '')) {
            const rawName = lines[0].replace(/^name:\s*/i, '').trim()
            detectedName = rawName.toLowerCase() === '(blank)' || !rawName ? null : rawName
            bodyStart = 1
        }
        const bodyText = lines.slice(bodyStart).join('\n').trim()

        if (detectedName && !studentName.trim()) setStudentName(detectedName)
        if (bodyText) {
            setScannedText(bodyText)
            setEditedText(bodyText)
            setPreviewOpen(true)
        }
    }

    function handleGradingModeSwitch(next: GradingMode) {
        if (next === gradingMode) return
        if (gradingMode === 'answerKey' && selectedTest?.hasAnswerKey) {
            if (!window.confirm('This will remove your saved answer key. Continue?')) return
        }
        if (gradingMode === 'guidedBook' && hasGuide) {
            if (!window.confirm('This will remove your saved guide PDFs. Continue?')) return
        }
        setGradingMode(next)
        setAnswerKey(null); setGuideStatus('idle'); setGuideJobId(null); setGuideError(null)
    }

    if (loading || !user) return null

    const guideSourcesLabel = selectedTest?.guideSources?.length
        ? `✓ ${selectedTest.guideSources.reduce((n, s) => n + s.pageCount, 0)} pages from ${selectedTest.guideSources.length} file${selectedTest.guideSources.length > 1 ? 's' : ''} — drop to replace`
        : guideStatus === 'done'
            ? '✓ Guide extracted — drop to replace'
            : isNewTest && !newTestName.trim()
                ? 'Enter a test name first'
                : 'Drop PDFs here or click to upload'

    return (
        <div className="max-w-2xl mx-auto px-4 py-8">
            <div className="bg-[#16213e] rounded-lg px-4 py-3 mb-6">
                <span className="text-[#4cc9f0] font-bold">✦ Exam Grader</span>
            </div>

            <div className="flex flex-col gap-4">
                {/* OCR mode */}
                <div className="flex gap-2">
                    {(['printed', 'handwritten'] as OcrMode[]).map(m => (
                        <button key={m} onClick={() => setMode(m)} disabled={grading}
                            className={['px-4 py-1.5 rounded text-sm font-medium transition-colors',
                                mode === m ? 'bg-[#4cc9f0] text-[#0f0e17]' : 'bg-[#16213e] text-[#aaa] hover:text-[#4cc9f0]'
                            ].join(' ')}>
                            {m.charAt(0).toUpperCase() + m.slice(1)}
                        </button>
                    ))}
                </div>

                {/* Test selector */}
                {testsError && <p className="text-xs text-[#e94560]">{testsError}</p>}
                <div className="flex flex-col gap-2">
                    <label className="text-sm text-[#aaa]">Test</label>
                    <select value={selectedTestId}
                        onChange={e => { setSelectedTestId(e.target.value); setAnswerKey(null); setGuideStatus('idle'); setGuideJobId(null) }}
                        disabled={grading}
                        className="bg-[#16213e] text-[#ccc] border border-[#4cc9f0]/30 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#4cc9f0] disabled:opacity-40">
                        <option value="">— select a test —</option>
                        {tests.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
                        <option value="__new__">New test…</option>
                    </select>
                    {isNewTest && (
                        <input type="text" placeholder="New test name" value={newTestName}
                            onChange={e => setNewTestName(e.target.value)} disabled={grading}
                            className="bg-[#16213e] text-[#ccc] border border-[#4cc9f0]/30 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#4cc9f0] placeholder-[#555] disabled:opacity-40" />
                    )}
                </div>

                {/* Grading mode toggle */}
                {selectedTestId && (
                    <div className="flex flex-col gap-1">
                        <label className="text-sm text-[#aaa]">Answer source</label>
                        <div className="flex gap-2">
                            {(['answerKey', 'guidedBook'] as GradingMode[]).map(m => (
                                <button key={m} onClick={() => handleGradingModeSwitch(m)} disabled={grading || guideIsExtracting}
                                    className={['px-4 py-1.5 rounded text-sm font-medium transition-colors',
                                        gradingMode === m ? 'bg-[#4cc9f0] text-[#0f0e17]' : 'bg-[#16213e] text-[#aaa] hover:text-[#4cc9f0]'
                                    ].join(' ')}>
                                    {m === 'answerKey' ? 'Answer Key' : 'Guide PDFs'}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Student name */}
                <div className="flex flex-col gap-2">
                    <label className="text-sm text-[#aaa]">
                        Student Name
                        {scanning && <span className="ml-2 text-xs text-[#4cc9f0]/70">detecting…</span>}
                    </label>
                    <input type="text" placeholder="Enter student name" value={studentName}
                        onChange={e => setStudentName(e.target.value)} disabled={grading}
                        className="bg-[#16213e] text-[#ccc] border border-[#4cc9f0]/30 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#4cc9f0] placeholder-[#555] disabled:opacity-40" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    {/* Answer Key OR Guide PDFs slot */}
                    {gradingMode === 'answerKey' ? (
                        <label className={['border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
                            answerKey ? 'border-[#4cc9f0] bg-[#0f3460]/20'
                            : selectedTest?.hasAnswerKey ? 'border-[#4cc9f0]/60 bg-[#0f3460]/10'
                            : 'border-[#4cc9f0]/40 hover:border-[#4cc9f0]'].join(' ')}>
                            <div className="text-2xl mb-2">📄</div>
                            <p className="text-sm text-[#4cc9f0] font-medium mb-1">Answer Key</p>
                            <p className="text-xs text-[#555] truncate">
                                {answerKey ? answerKey.name : selectedTest?.hasAnswerKey ? '✓ Saved — drop to replace' : 'Click to upload'}
                            </p>
                            <input type="file" accept=".jpg,.jpeg,.png,.webp,.tiff,.pdf,image/png,image/jpeg,image/webp,image/tiff,application/pdf"
                                className="hidden" disabled={grading} onChange={e => setAnswerKey(e.target.files?.[0] ?? null)} />
                        </label>
                    ) : (
                        <label className={['border-2 border-dashed rounded-lg p-6 text-center transition-colors',
                            guideIsExtracting ? 'border-[#4cc9f0]/40 opacity-60 cursor-wait'
                            : hasGuide ? 'border-[#4cc9f0]/60 bg-[#0f3460]/10 cursor-pointer'
                            : 'border-[#4cc9f0]/40 hover:border-[#4cc9f0] cursor-pointer'].join(' ')}>
                            <div className="text-2xl mb-2">📚</div>
                            <p className="text-sm text-[#4cc9f0] font-medium mb-1">Guide PDFs</p>
                            <p className="text-xs text-[#555]">
                                {guideIsExtracting
                                    ? `Extracting guide text… (${guideProgress ? `${guideProgress.done}/${guideProgress.total} files` : 'starting'})`
                                    : guideSourcesLabel}
                            </p>
                            {guideError && <p className="text-xs text-[#e94560] mt-1">{guideError}</p>}
                            <input type="file" accept="application/pdf,.pdf" multiple className="hidden"
                                disabled={guideIsExtracting || grading || (isNewTest && !newTestName.trim())}
                                onChange={e => handleGuideUpload(e.target.files)} />
                        </label>
                    )}

                    {/* Student Paper */}
                    <label className={['border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
                        studentPaper ? 'border-[#4cc9f0] bg-[#0f3460]/20' : 'border-[#4cc9f0]/40 hover:border-[#4cc9f0]'].join(' ')}>
                        <div className="text-2xl mb-2">📄</div>
                        <p className="text-sm text-[#4cc9f0] font-medium mb-1">Student Paper</p>
                        <p className="text-xs text-[#555] truncate">{studentPaper ? studentPaper.name : 'Click to upload'}</p>
                        <input type="file" accept=".jpg,.jpeg,.png,.webp,.tiff,.pdf,image/png,image/jpeg,image/webp,image/tiff,application/pdf"
                            className="hidden" disabled={grading} onChange={e => handleStudentPaperChange(e.target.files?.[0] ?? null)} />
                    </label>
                </div>

                {/* OCR scan preview */}
                {(scanning || scannedText !== null) && (
                    <div className="border border-[#4cc9f0]/30 rounded-lg overflow-hidden">
                        <button
                            type="button"
                            onClick={() => setPreviewOpen(o => !o)}
                            className="w-full flex items-center justify-between px-4 py-2 bg-[#16213e] text-sm text-[#aaa] hover:text-[#4cc9f0] transition-colors"
                        >
                            <span>
                                {scanning
                                    ? 'Scanning student paper…'
                                    : `Review scan${editedText !== scannedText ? ' (edited)' : ''}`}
                            </span>
                            {!scanning && <span className="text-xs">{previewOpen ? '▲ hide' : '▼ show'}</span>}
                        </button>
                        {previewOpen && !scanning && (
                            <div className="px-4 pb-4 pt-2 bg-[#0f0e17]">
                                <p className="text-xs text-[#555] mb-2">
                                    Edit below if anything was misread — your changes will be used for grading.
                                </p>
                                <textarea
                                    value={editedText}
                                    onChange={e => setEditedText(e.target.value)}
                                    rows={Math.min(20, (editedText.match(/\n/g)?.length ?? 0) + 3)}
                                    disabled={grading}
                                    className="w-full bg-[#16213e] text-[#ccc] border border-[#4cc9f0]/20 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#4cc9f0] resize-y disabled:opacity-40"
                                />
                                {editedText !== scannedText && (
                                    <button
                                        type="button"
                                        onClick={() => setEditedText(scannedText ?? '')}
                                        className="mt-1 text-xs text-[#aaa] hover:text-[#4cc9f0] transition-colors"
                                    >
                                        Reset to original scan
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <button onClick={handleGrade} disabled={!canGrade || scanning}
                    className="bg-[#4cc9f0] text-[#0f0e17] font-semibold py-2 px-6 rounded transition-opacity disabled:opacity-40">
                    {grading ? 'Grading…'
                        : scanning ? 'Scanning…'
                        : guideIsExtracting ? 'Extracting guide…'
                        : 'Grade'}
                </button>

                {error && <p className="text-center text-sm text-[#e94560]">{error}</p>}
                {result && <ExamResult {...result} />}
            </div>
        </div>
    )
}
