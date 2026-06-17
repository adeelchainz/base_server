#!/usr/bin/env node
'use strict'

// Use direct CJS paths to avoid ESM/CJS export map issues
const path = require('path')
const _cjsRoot = path.dirname(path.dirname(require.resolve('@modelcontextprotocol/sdk/server')))
const { Server } = require('@modelcontextprotocol/sdk/server')
const { StdioServerTransport } = require(path.join(_cjsRoot, 'server', 'stdio.js'))
const {
    ListToolsRequestSchema,
    CallToolRequestSchema,
} = require(path.join(_cjsRoot, 'types.js'))
const fs = require('fs')
const https = require('https')
const http = require('http')

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL = process.env.EXAM_API_URL ?? 'http://localhost:3000'
const AUTO_EMAIL = process.env.EXAM_EMAIL ?? ''
const AUTO_PASSWORD = process.env.EXAM_PASSWORD ?? ''

// ── In-memory cookie jar ──────────────────────────────────────────────────────
let sessionCookies = '' // raw Cookie header value

function extractCookies(response) {
    const raw = response.headers.raw?.()?.['set-cookie'] ?? response.headers.getSetCookie?.() ?? []
    const pairs = raw.map(c => c.split(';')[0]).filter(Boolean)
    if (pairs.length > 0) sessionCookies = pairs.join('; ')
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function apiGet(path) {
    const res = await fetch(`${BASE_URL}${path}`, {
        method: 'GET',
        credentials: 'include',
        headers: { Cookie: sessionCookies }
    })
    extractCookiesFromFetch(res)
    return res
}

async function apiPost(path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Cookie: sessionCookies },
        body: JSON.stringify(body)
    })
    extractCookiesFromFetch(res)
    return res
}

async function apiUpload(path, formData, method = 'POST') {
    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        credentials: 'include',
        headers: { Cookie: sessionCookies },
        body: formData
    })
    extractCookiesFromFetch(res)
    return res
}

function extractCookiesFromFetch(res) {
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : []
    if (setCookie.length > 0) {
        const pairs = setCookie.map(c => c.split(';')[0]).filter(Boolean)
        sessionCookies = pairs.join('; ')
    }
}

async function parseResponse(res) {
    const text = await res.text()
    try {
        return JSON.parse(text)
    } catch {
        return { success: false, message: text }
    }
}

// ── Auto-login ────────────────────────────────────────────────────────────────
async function ensureLoggedIn() {
    if (sessionCookies || !AUTO_EMAIL || !AUTO_PASSWORD) return
    const res = await apiPost('/v1/login', { email: AUTO_EMAIL, password: AUTO_PASSWORD })
    if (!res.ok) throw new Error(`Auto-login failed (${res.status})`)
    sessionCookies = sessionCookies || 'logged_in=1' // force truthy if no cookie returned
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function toolLogin({ email, password }) {
    const res = await apiPost('/v1/login', { email, password })
    const data = await parseResponse(res)
    if (res.ok && data.success) return `Logged in as ${email}. Session stored.`
    return `Login failed: ${data.message ?? res.status}`
}

async function toolListTests() {
    await ensureLoggedIn()
    const res = await apiGet('/v1/exam/tests')
    const data = await parseResponse(res)
    if (!res.ok) return `Error: ${data.message ?? res.status}`
    const tests = data.data ?? []
    if (tests.length === 0) return 'No tests found.'
    return tests.map(t =>
        `[${t._id}] ${t.name} | students: ${t.studentCount} | ` +
        `mode: ${t.gradingMode ?? 'answerKey'} | ` +
        (t.hasAnswerKey ? 'has answer key' : t.hasGuide ? `has guide (${t.guideSources?.reduce((n, s) => n + s.pageCount, 0) ?? '?'} pages)` : 'no key/guide')
    ).join('\n')
}

async function toolGetTestResults({ test_id }) {
    await ensureLoggedIn()
    const res = await apiGet(`/v1/exam/tests/${test_id}/results`)
    const data = await parseResponse(res)
    if (!res.ok) return `Error: ${data.message ?? res.status}`
    const { test, stats, records } = data.data ?? {}
    const lines = [
        `Test: ${test?.name ?? test_id}`,
        `Avg: ${stats?.avg ?? '-'}%  High: ${stats?.high ?? '-'}%  Low: ${stats?.low ?? '-'}%`,
        `Records (${records?.length ?? 0}):`,
        ...(records ?? []).map(r =>
            `  ${r.studentName}: ${r.totalScore}/${r.maxScore} (${r.percentage}%) [${r.gradingMode ?? 'answerKey'}]`
        )
    ]
    return lines.join('\n')
}

async function toolGradeExam({ test_id, test_name, student_name, student_paper_path, answer_key_path, mode }) {
    await ensureLoggedIn()

    if (!fs.existsSync(student_paper_path)) {
        return `Error: student paper file not found: ${student_paper_path}`
    }

    const form = new FormData()
    const paperBlob = new Blob([fs.readFileSync(student_paper_path)], { type: 'application/octet-stream' })
    form.append('studentPaper', paperBlob, path.basename(student_paper_path))
    form.append('studentName', student_name)
    form.append('mode', mode ?? 'printed')

    if (test_id) form.append('testId', test_id)
    else if (test_name) form.append('testName', test_name)
    else return 'Error: provide either test_id or test_name'

    if (answer_key_path) {
        if (!fs.existsSync(answer_key_path)) return `Error: answer key file not found: ${answer_key_path}`
        const keyBlob = new Blob([fs.readFileSync(answer_key_path)], { type: 'application/octet-stream' })
        form.append('answerKey', keyBlob, path.basename(answer_key_path))
    }

    const res = await apiUpload('/v1/exam/grade', form)
    const data = await parseResponse(res)
    if (!res.ok) return `Grade failed: ${data.message ?? res.status}`

    const r = data.data
    const lines = [
        `Graded: ${student_name}`,
        `Score: ${r.totalScore}/${r.maxScore} (${r.percentage}%)`,
        `Mode: ${r.gradingMode ?? 'answerKey'}`,
        `Test ID: ${r.testId}`,
        '',
        ...r.questions.map(q =>
            `Q${q.number}: ${q.score.toUpperCase()} | Student: "${q.studentAnswer || '—'}" | Correct: "${q.correctAnswer}"` +
            (q.feedback ? ` | Note: ${q.feedback}` : '')
        )
    ]
    return lines.join('\n')
}

async function toolUploadGuide({ test_id, pdf_paths }) {
    await ensureLoggedIn()

    const paths = Array.isArray(pdf_paths) ? pdf_paths : [pdf_paths]
    for (const p of paths) {
        if (!fs.existsSync(p)) return `Error: file not found: ${p}`
    }

    const form = new FormData()
    for (const p of paths) {
        const blob = new Blob([fs.readFileSync(p)], { type: 'application/pdf' })
        form.append('guides', blob, path.basename(p))
    }

    const res = await apiUpload(`/v1/exam/tests/${test_id}/guides`, form)
    const data = await parseResponse(res)
    if (!res.ok) return `Upload failed: ${data.message ?? res.status}`

    return `Guide upload started. Job ID: ${data.data?.jobId}\nUse poll_guide_job to track progress.`
}

async function toolPollGuideJob({ test_id, job_id }) {
    await ensureLoggedIn()
    const res = await apiGet(`/v1/exam/tests/${test_id}/guides/job/${job_id}`)
    const data = await parseResponse(res)
    if (!res.ok) return `Error: ${data.message ?? res.status}`
    const { status, progress, result, error } = data.data ?? {}
    const lines = [`Job ${job_id}: ${status}`]
    if (progress) lines.push(`Progress: ${progress.done}/${progress.total} files`)
    if (result) lines.push(`Result: ${result.pageCount} pages from ${result.sources?.length ?? 0} file(s)`)
    if (error) lines.push(`Error: ${error.message}${error.filename ? ` (file: ${error.filename})` : ''}`)
    return lines.join('\n')
}

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS = [
    {
        name: 'login',
        description: 'Log in to the exam grading system with email and password.',
        inputSchema: {
            type: 'object',
            properties: {
                email: { type: 'string', description: 'User email address' },
                password: { type: 'string', description: 'User password' }
            },
            required: ['email', 'password']
        }
    },
    {
        name: 'list_tests',
        description: 'List all exam tests for the current user, showing student counts, grading mode, and key/guide status.',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'get_test_results',
        description: 'Get graded results and statistics for a specific test.',
        inputSchema: {
            type: 'object',
            properties: {
                test_id: { type: 'string', description: 'The test ID (from list_tests)' }
            },
            required: ['test_id']
        }
    },
    {
        name: 'grade_exam',
        description: 'Grade a student paper against an answer key or saved guide. Uploads the file, calls OCR + Gemini grading, and returns per-question results.',
        inputSchema: {
            type: 'object',
            properties: {
                student_name: { type: 'string', description: 'Name of the student' },
                student_paper_path: { type: 'string', description: 'Absolute path to the student paper image/PDF' },
                test_id: { type: 'string', description: 'Existing test ID to attach the result to' },
                test_name: { type: 'string', description: 'Name for a new test (used if test_id not provided)' },
                answer_key_path: { type: 'string', description: 'Absolute path to the answer key image/PDF (optional if test already has one saved)' },
                mode: { type: 'string', enum: ['printed', 'handwritten'], description: 'OCR mode — "printed" for typed text, "handwritten" for handwriting' }
            },
            required: ['student_name', 'student_paper_path']
        }
    },
    {
        name: 'upload_guide',
        description: 'Upload one or more PDF guide books for a test. Guide text is extracted asynchronously — use poll_guide_job to track completion.',
        inputSchema: {
            type: 'object',
            properties: {
                test_id: { type: 'string', description: 'The test ID to attach the guide to' },
                pdf_paths: {
                    oneOf: [
                        { type: 'string', description: 'Absolute path to a single PDF file' },
                        { type: 'array', items: { type: 'string' }, description: 'Array of absolute paths to PDF files' }
                    ],
                    description: 'Path(s) to PDF guide file(s)'
                }
            },
            required: ['test_id', 'pdf_paths']
        }
    },
    {
        name: 'poll_guide_job',
        description: 'Check the status of a guide PDF extraction job.',
        inputSchema: {
            type: 'object',
            properties: {
                test_id: { type: 'string', description: 'The test ID' },
                job_id: { type: 'string', description: 'The job ID returned by upload_guide' }
            },
            required: ['test_id', 'job_id']
        }
    }
]

const TOOL_HANDLERS = {
    login: toolLogin,
    list_tests: toolListTests,
    get_test_results: toolGetTestResults,
    grade_exam: toolGradeExam,
    upload_guide: toolUploadGuide,
    poll_guide_job: toolPollGuideJob
}

// ── Server setup ──────────────────────────────────────────────────────────────
const server = new Server(
    { name: 'exam-grader', version: '1.0.0' },
    { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const handler = TOOL_HANDLERS[name]
    if (!handler) {
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    }
    try {
        const result = await handler(args ?? {})
        return { content: [{ type: 'text', text: result }] }
    } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
    }
})

async function main() {
    const transport = new StdioServerTransport()
    await server.connect(transport)
    // Log to stderr so it doesn't interfere with stdio MCP protocol
    process.stderr.write('Exam Grader MCP server running (stdio)\n')
}

main().catch(err => {
    process.stderr.write(`Fatal: ${err.message}\n`)
    process.exit(1)
})
