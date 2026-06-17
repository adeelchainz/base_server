'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/context/auth'
import { apiFetch } from '@/lib/api'
import { TestItem, TestResults, ExamRecord, ExamQuestion } from '@/types/exam'

function pctColor(pct: number) {
    if (pct >= 80) return 'text-[#68d391]'
    if (pct >= 60) return 'text-[#f6ad55]'
    return 'text-[#fc8181]'
}

function scoreColor(score: ExamQuestion['score']) {
    if (score === 'correct') return 'bg-[#1a3a2a] text-[#68d391]'
    if (score === 'partial') return 'bg-[#3a2e1a] text-[#f6ad55]'
    return 'bg-[#3a1a1a] text-[#fc8181]'
}

export default function ResultsPage() {
    const { user, loading } = useAuth()
    const [tests, setTests] = useState<TestItem[]>([])
    const [selectedTestId, setSelectedTestId] = useState<string | null>(null)
    const [results, setResults] = useState<TestResults | null>(null)
    const [loadingResults, setLoadingResults] = useState(false)
    const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null)
    const [editingRecordId, setEditingRecordId] = useState<string | null>(null)
    const [editQuestions, setEditQuestions] = useState<ExamQuestion[]>([])
    const [saveError, setSaveError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (!loading && !user) window.location.href = '/login'
    }, [user, loading])

    useEffect(() => {
        if (user) {
            apiFetch<TestItem[]>('/v1/exam/tests')
                .then(res => setTests(res.data))
                .catch(() => {})
        }
    }, [user])

    async function selectTest(testId: string) {
        setSelectedTestId(testId)
        setExpandedRecordId(null)
        setEditingRecordId(null)
        setSaveError(null)
        setResults(null)
        setLoadingResults(true)
        try {
            const res = await apiFetch<TestResults>(`/v1/exam/tests/${testId}/results`)
            setResults(res.data)
        } catch (err) {
            if ((err as Error & { status?: number }).status === 401) window.location.href = '/login'
        } finally {
            setLoadingResults(false)
        }
    }

    function toggleExpand(recordId: string) {
        setExpandedRecordId(prev => (prev === recordId ? null : recordId))
        if (editingRecordId !== recordId) {
            setEditingRecordId(null)
            setSaveError(null)
        }
    }

    function startEdit(record: ExamRecord) {
        setEditingRecordId(record._id)
        setEditQuestions(record.questions.map(q => ({ ...q })))
        setSaveError(null)
    }

    function cancelEdit() {
        setEditingRecordId(null)
        setSaveError(null)
    }

    function updateEditQuestion(index: number, patch: Partial<ExamQuestion>) {
        setEditQuestions(prev => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)))
    }

    async function saveEdit(recordId: string) {
        setSaving(true)
        setSaveError(null)
        try {
            const res = await apiFetch<ExamRecord>(`/v1/exam/records/${recordId}`, {
                method: 'PATCH',
                body: JSON.stringify({ questions: editQuestions })
            })
            setResults(prev =>
                prev ? { ...prev, records: prev.records.map(r => (r._id === recordId ? res.data : r)) } : prev
            )
            setEditingRecordId(null)
        } catch (err) {
            const e = err as Error & { status?: number }
            if (e.status === 401) { window.location.href = '/login'; return }
            setSaveError(e.message ?? 'Save failed')
        } finally {
            setSaving(false)
        }
    }

    if (loading || !user) return null

    return (
        <div className="flex h-[calc(100vh-49px)]">
            <aside className="w-60 flex-shrink-0 border-r border-[#2a2a4a] overflow-y-auto bg-[#16213e]">
                <div className="px-4 py-3 text-xs text-[#aaa] uppercase tracking-widest border-b border-[#2a2a4a]">
                    Tests
                </div>
                {tests.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-[#555]">No tests yet. Grade a paper to get started.</p>
                ) : (
                    tests.map(test => (
                        <button
                            key={test._id}
                            onClick={() => selectTest(test._id)}
                            className={[
                                'w-full text-left px-4 py-3 border-b border-[#2a2a4a] transition-colors',
                                selectedTestId === test._id ? 'bg-[#0f3460] text-[#4cc9f0]' : 'hover:bg-[#1a2a4a] text-[#e0e0e0]'
                            ].join(' ')}
                        >
                            <div className="text-sm font-medium truncate">{test.name}</div>
                            <div className="text-xs text-[#aaa] mt-0.5">{test.studentCount} student{test.studentCount !== 1 ? 's' : ''}</div>
                        </button>
                    ))
                )}
            </aside>

            <main className="flex-1 overflow-y-auto p-6">
                {!selectedTestId && (
                    <div className="flex items-center justify-center h-full text-[#555] text-sm">
                        Select a test to view results
                    </div>
                )}

                {selectedTestId && loadingResults && (
                    <div className="flex items-center justify-center h-full text-[#aaa] text-sm">Loading…</div>
                )}

                {selectedTestId && !loadingResults && results && (
                    <div>
                        <h2 className="text-lg font-bold text-[#4cc9f0] mb-4">{results.test.name}</h2>

                        <div className="flex gap-3 mb-6">
                            <div className="bg-[#1a3a2a] rounded px-4 py-2 text-sm">
                                <div className="text-xs text-[#aaa] mb-0.5">Average</div>
                                <div className="font-bold text-[#68d391]">{results.stats.avg}%</div>
                            </div>
                            <div className="bg-[#1a2a3a] rounded px-4 py-2 text-sm">
                                <div className="text-xs text-[#aaa] mb-0.5">Highest</div>
                                <div className="font-bold text-[#4cc9f0]">{results.stats.high}%</div>
                            </div>
                            <div className="bg-[#3a1a1a] rounded px-4 py-2 text-sm">
                                <div className="text-xs text-[#aaa] mb-0.5">Lowest</div>
                                <div className="font-bold text-[#fc8181]">{results.stats.low}%</div>
                            </div>
                        </div>

                        <div className="bg-[#16213e] rounded-lg overflow-hidden border border-[#2a2a4a]">
                            <div className="grid grid-cols-3 px-4 py-2 text-xs text-[#4cc9f0] uppercase tracking-widest border-b border-[#2a2a4a]">
                                <span>Student</span><span>Score</span><span>%</span>
                            </div>

                            {results.records.length === 0 && (
                                <div className="px-4 py-4 text-sm text-[#555]">No records yet.</div>
                            )}

                            {results.records.map(record => (
                                <div key={record._id} className="border-b border-[#2a2a4a] last:border-0">
                                    <button
                                        onClick={() => toggleExpand(record._id)}
                                        className="w-full grid grid-cols-3 px-4 py-3 text-sm text-left hover:bg-[#1a2a4a] transition-colors"
                                    >
                                        <span className="text-[#e0e0e0]">{record.studentName}</span>
                                        <span className="text-[#aaa]">{record.totalScore}/{record.maxScore}</span>
                                        <span className={pctColor(record.percentage)}>{record.percentage}%</span>
                                    </button>

                                    {expandedRecordId === record._id && (
                                        <div className="bg-[#0f0e17] px-4 pb-4 pt-2">
                                            {editingRecordId === record._id ? (
                                                <div>
                                                    <div className="flex flex-col gap-3 mb-4">
                                                        {editQuestions.map((q, i) => (
                                                            <div key={q.number} className="bg-[#16213e] rounded p-3">
                                                                <div className="text-xs text-[#aaa] mb-2">Q{q.number}</div>
                                                                <div className="text-xs text-[#555] mb-1">Correct: <span className="text-[#e0e0e0]">{q.correctAnswer}</span></div>
                                                                <div className="text-xs text-[#555] mb-2">Student: <span className="text-[#e0e0e0]">{q.studentAnswer}</span></div>
                                                                <div className="flex gap-2 mb-2">
                                                                    {(['correct', 'partial', 'wrong'] as const).map(s => (
                                                                        <button
                                                                            key={s}
                                                                            onClick={() => updateEditQuestion(i, { score: s })}
                                                                            className={[
                                                                                'px-3 py-1 rounded text-xs font-medium transition-colors',
                                                                                q.score === s ? 'bg-[#4cc9f0] text-[#0f0e17]' : 'bg-[#2a2a4a] text-[#aaa] hover:text-[#e0e0e0]'
                                                                            ].join(' ')}
                                                                        >
                                                                            {s}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                                <textarea
                                                                    value={q.feedback}
                                                                    onChange={e => updateEditQuestion(i, { feedback: e.target.value })}
                                                                    placeholder="Feedback"
                                                                    rows={2}
                                                                    className="w-full bg-[#0f0e17] border border-[#2a2a4a] rounded px-2 py-1 text-xs text-[#e0e0e0] resize-none focus:outline-none focus:border-[#4cc9f0]"
                                                                />
                                                            </div>
                                                        ))}
                                                    </div>
                                                    {saveError && <p className="text-xs text-[#e94560] mb-2">{saveError}</p>}
                                                    <div className="flex gap-2">
                                                        <button onClick={() => saveEdit(record._id)} disabled={saving}
                                                            className="bg-[#4cc9f0] text-[#0f0e17] text-xs font-semibold px-4 py-1.5 rounded disabled:opacity-40">
                                                            {saving ? 'Saving…' : 'Save'}
                                                        </button>
                                                        <button onClick={cancelEdit}
                                                            className="bg-[#2a2a4a] text-[#aaa] text-xs px-4 py-1.5 rounded hover:text-[#e0e0e0]">
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div>
                                                    <div className="flex justify-end mb-2">
                                                        <button onClick={() => startEdit(record)} className="text-xs text-[#4cc9f0] hover:underline">
                                                            Edit
                                                        </button>
                                                    </div>
                                                    <div className="flex flex-col gap-2">
                                                        {record.questions.map(q => (
                                                            <div key={q.number} className="bg-[#16213e] rounded p-3 text-xs">
                                                                <div className="flex items-center justify-between mb-1">
                                                                    <span className="text-[#aaa]">Q{q.number}</span>
                                                                    <span className={`px-2 py-0.5 rounded text-xs ${scoreColor(q.score)}`}>{q.score}</span>
                                                                </div>
                                                                <div className="text-[#555]">Correct: <span className="text-[#e0e0e0]">{q.correctAnswer}</span></div>
                                                                <div className="text-[#555]">Student: <span className="text-[#e0e0e0]">{q.studentAnswer}</span></div>
                                                                {q.feedback && <div className="text-[#aaa] mt-1 italic">{q.feedback}</div>}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </main>
        </div>
    )
}
