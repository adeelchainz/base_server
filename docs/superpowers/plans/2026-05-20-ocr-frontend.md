# OCR Hardening + Next.js Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the OCR service with multi-pipeline preprocessing and build a Next.js frontend that lets authenticated users upload images and see extracted text.

**Architecture:** Backend runs four Sharp preprocessing pipelines sequentially through a single Tesseract worker, short-circuits at ≥ 85 % confidence, and returns the best result with a `pipeline` field. The Next.js frontend lives in `frontend/` as a subfolder, calls the existing backend API using `credentials: 'include'`, and shows login → upload → result flow.

**Tech Stack:** Node/Express/TypeScript (backend), Tesseract.js v7, Sharp v0.34, Next.js 15, React 19, Tailwind CSS 3, TypeScript

---

## File Map

### Backend changes
| File | Action |
|---|---|
| `src/services/ocr.ts` | Refactor — 4 named pipelines, sequential loop, `pipeline` in result |
| `src/__tests__/ocr/ocr-pipelines.spec.ts` | Create — unit tests for multi-pipeline logic |
| `src/app.ts` | Modify — CORS origin from env var + `credentials: true` |
| `.env.example` | Modify — add `CORS_ORIGIN` |

### Frontend (all new, inside `frontend/`)
| File | Purpose |
|---|---|
| `package.json` | Dependencies and dev scripts |
| `next.config.ts` | Next.js config |
| `tsconfig.json` | TypeScript config |
| `tailwind.config.ts` | Tailwind content paths |
| `postcss.config.mjs` | PostCSS plugins |
| `src/app/globals.css` | Tailwind directives |
| `src/app/layout.tsx` | Root layout, dark theme |
| `src/app/page.tsx` | Root route — redirects to `/login` or `/ocr` |
| `src/app/login/page.tsx` | Login page shell |
| `src/app/ocr/page.tsx` | OCR page — auth guard, upload, result |
| `src/lib/api.ts` | Typed fetch wrapper |
| `src/lib/auth.ts` | Session check and logout |
| `src/components/LoginForm.tsx` | Login form (client component) |
| `src/components/ImageUploader.tsx` | Drag-drop file input |
| `src/components/OcrResult.tsx` | Result display |

---

## Task 1: Write failing OCR pipeline tests

**Files:**
- Create: `src/__tests__/ocr/ocr-pipelines.spec.ts`

- [ ] **Step 1: Create the test file**

```typescript
// src/__tests__/ocr/ocr-pipelines.spec.ts
import { createWorker } from 'tesseract.js'
import { extractText, IOcrResult } from '../../services/ocr'

jest.mock('../../handlers/logger', () => ({
    default: { info: jest.fn(), error: jest.fn() }
}))

jest.mock('sharp', () => {
    const instance = {
        greyscale: jest.fn().mockReturnThis(),
        normalise: jest.fn().mockReturnThis(),
        sharpen: jest.fn().mockReturnThis(),
        threshold: jest.fn().mockReturnThis(),
        blur: jest.fn().mockReturnThis(),
        gamma: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed'))
    }
    return jest.fn(() => instance)
})

jest.mock('tesseract.js', () => ({ createWorker: jest.fn() }))

const mockCreateWorker = createWorker as jest.MockedFunction<typeof createWorker>

describe('extractText', () => {
    const fakeBuffer = Buffer.from('fake-image')

    afterEach(() => jest.clearAllMocks())

    it('short-circuits and returns the first pipeline that hits >= 85% confidence', async () => {
        const recognize = jest.fn()
            .mockResolvedValueOnce({ data: { text: 'baseline text', confidence: 60 } })
            .mockResolvedValueOnce({ data: { text: 'binarize text', confidence: 75 } })
            .mockResolvedValueOnce({ data: { text: 'denoise text', confidence: 90 } })
            .mockResolvedValueOnce({ data: { text: 'high text', confidence: 50 } })
        const terminate = jest.fn().mockResolvedValue(undefined)
        mockCreateWorker.mockResolvedValue({ recognize, terminate } as never)

        const result: IOcrResult = await extractText(fakeBuffer)

        expect(result.text).toBe('denoise text')
        expect(result.confidence).toBe(90)
        expect(result.pipeline).toBe('denoise')
        expect(recognize).toHaveBeenCalledTimes(3) // stops after denoise
    })

    it('runs all pipelines and returns the best when none exceeds threshold', async () => {
        const recognize = jest.fn()
            .mockResolvedValueOnce({ data: { text: 'text a', confidence: 50 } })
            .mockResolvedValueOnce({ data: { text: 'text b', confidence: 72 } })
            .mockResolvedValueOnce({ data: { text: 'text c', confidence: 65 } })
            .mockResolvedValueOnce({ data: { text: 'text d', confidence: 40 } })
        const terminate = jest.fn().mockResolvedValue(undefined)
        mockCreateWorker.mockResolvedValue({ recognize, terminate } as never)

        const result: IOcrResult = await extractText(fakeBuffer)

        expect(result.text).toBe('text b')
        expect(result.confidence).toBe(72)
        expect(result.pipeline).toBe('binarize')
        expect(recognize).toHaveBeenCalledTimes(4)
    })

    it('always terminates the worker — even if a pipeline throws', async () => {
        const recognize = jest.fn().mockRejectedValue(new Error('tesseract failure'))
        const terminate = jest.fn().mockResolvedValue(undefined)
        mockCreateWorker.mockResolvedValue({ recognize, terminate } as never)

        await expect(extractText(fakeBuffer)).rejects.toThrow('tesseract failure')
        expect(terminate).toHaveBeenCalledTimes(1)
    })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

```
npx jest src/__tests__/ocr/ocr-pipelines.spec.ts --no-coverage
```

Expected: 3 test failures — `IOcrResult` has no `pipeline` field and `extractText` doesn't implement pipelines yet.

---

## Task 2: Refactor `src/services/ocr.ts` with multi-pipeline logic

**Files:**
- Modify: `src/services/ocr.ts`

- [ ] **Step 1: Replace the file contents**

```typescript
// src/services/ocr.ts
import path from 'path'
import sharp from 'sharp'
import { createWorker } from 'tesseract.js'
import logger from '../handlers/logger'

const TESSDATA_DIR = path.join(process.cwd(), 'tessdata')
const HIGH_CONFIDENCE_THRESHOLD = 85

export interface IOcrResult {
    text: string
    confidence: number
    processingTimeMs: number
    pipeline: string
}

type Pipeline = { name: string; fn: (buf: Buffer) => Promise<Buffer> }

const PIPELINES: Pipeline[] = [
    {
        name: 'baseline',
        fn: (buf) => sharp(buf).greyscale().normalise().sharpen().toBuffer()
    },
    {
        name: 'binarize',
        fn: (buf) => sharp(buf).greyscale().normalise().threshold(128).sharpen().toBuffer()
    },
    {
        name: 'denoise',
        fn: (buf) => sharp(buf).greyscale().blur(0.5).normalise().sharpen().toBuffer()
    },
    {
        name: 'high-contrast',
        fn: (buf) => sharp(buf).greyscale().gamma(1.5).normalise().sharpen().toBuffer()
    }
]

export const extractText = async (imageBuffer: Buffer): Promise<IOcrResult> => {
    const start = Date.now()
    const worker = await createWorker('eng', 1, { cachePath: TESSDATA_DIR })

    try {
        let best = { text: '', confidence: 0, pipeline: '' }

        for (const { name, fn } of PIPELINES) {
            const preprocessed = await fn(imageBuffer)
            const { data } = await worker.recognize(preprocessed)
            const confidence = Math.round(data.confidence)

            if (confidence > best.confidence) {
                best = { text: data.text.trim(), confidence, pipeline: name }
            }

            if (best.confidence >= HIGH_CONFIDENCE_THRESHOLD) break
        }

        const processingTimeMs = Date.now() - start

        logger.info('OCR extraction complete', {
            meta: { confidence: best.confidence, pipeline: best.pipeline, processingTimeMs }
        })

        return { ...best, processingTimeMs }
    } finally {
        await worker.terminate()
    }
}
```

- [ ] **Step 2: Run the tests and confirm they pass**

```
npx jest src/__tests__/ocr/ocr-pipelines.spec.ts --no-coverage
```

Expected: 3 tests pass.

- [ ] **Step 3: Run the full test suite to check for regressions**

```
npm test
```

Expected: all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/ocr.ts src/__tests__/ocr/ocr-pipelines.spec.ts
git commit -m "feat: harden OCR with multi-pipeline preprocessing and best-confidence selection"
```

---

## Task 3: Update CORS to use `CORS_ORIGIN` env var

**Files:**
- Modify: `src/app.ts`
- Modify: `.env.example`

- [ ] **Step 1: Update `src/app.ts`**

Replace the `cors(...)` call (lines 15–20) with:

```typescript
app.use(
    cors({
        methods: ['GET', 'POST', 'DELETE', 'OPTIONS', 'HEAD', 'PUT', 'PATCH'],
        origin: (process.env.CORS_ORIGIN ?? 'https://xyz.com').split(',').map(o => o.trim()),
        credentials: true
    })
)
```

- [ ] **Step 2: Update `.env.example`**

Add this line at the end of `.env.example`:

```
# CORS — comma-separated list of allowed frontend origins
CORS_ORIGIN=http://localhost:3001
```

- [ ] **Step 3: Add `CORS_ORIGIN` to your local `.env` file**

Open `.env` and add:

```
CORS_ORIGIN=http://localhost:3001
```

- [ ] **Step 4: Commit**

```bash
git add src/app.ts .env.example
git commit -m "feat: make CORS origin configurable via CORS_ORIGIN env var"
```

---

## Task 4: Scaffold the Next.js app

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/next.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/postcss.config.mjs`

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "ocr-frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `frontend/next.config.ts`**

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {}

export default nextConfig
```

- [ ] **Step 3: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `frontend/tailwind.config.ts`**

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {} },
  plugins: []
}

export default config
```

- [ ] **Step 5: Create `frontend/postcss.config.mjs`**

```javascript
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
}

export default config
```

- [ ] **Step 6: Create `frontend/.env.local`**

```
NEXT_PUBLIC_API_URL=http://localhost:3000
```

- [ ] **Step 7: Install dependencies**

```bash
cd frontend
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 8: Commit**

```bash
cd ..
git add frontend/package.json frontend/next.config.ts frontend/tsconfig.json frontend/tailwind.config.ts frontend/postcss.config.mjs
git commit -m "feat: scaffold Next.js frontend app"
```

---

## Task 5: Create API client and auth helpers

**Files:**
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/auth.ts`

- [ ] **Step 1: Create `frontend/src/lib/api.ts`**

```typescript
// frontend/src/lib/api.ts
export interface BackendResponse<T> {
    success: boolean
    statusCode: number
    message: string
    data: T
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<BackendResponse<T>> {
    const isJson = init?.body !== undefined && typeof init.body === 'string'
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
```

- [ ] **Step 2: Create `frontend/src/lib/auth.ts`**

```typescript
// frontend/src/lib/auth.ts
import { apiFetch } from './api'

export async function checkSession(): Promise<boolean> {
    try {
        await apiFetch('/v1/user/me')
        return true
    } catch {
        return false
    }
}

export async function logout(): Promise<void> {
    await apiFetch('/v1/logout', { method: 'PUT' }).catch(() => undefined)
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/
git commit -m "feat: add API client and auth helpers for Next.js frontend"
```

---

## Task 6: Root layout and routing

**Files:**
- Create: `frontend/src/app/globals.css`
- Create: `frontend/src/app/layout.tsx`
- Create: `frontend/src/app/page.tsx`

- [ ] **Step 1: Create `frontend/src/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 2: Create `frontend/src/app/layout.tsx`**

```typescript
// frontend/src/app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
    title: 'OCR Extract',
    description: 'Handwritten text extraction'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body className="bg-[#1a1a2e] text-[#e0e0e0] min-h-screen font-mono">{children}</body>
        </html>
    )
}
```

- [ ] **Step 3: Create `frontend/src/app/page.tsx`**

```typescript
// frontend/src/app/page.tsx
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { checkSession } from '@/lib/auth'

export default function Home() {
    const router = useRouter()

    useEffect(() => {
        checkSession().then(ok => {
            router.replace(ok ? '/ocr' : '/login')
        })
    }, [router])

    return null
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/
git commit -m "feat: add root layout and session-aware root route"
```

---

## Task 7: Login page

**Files:**
- Create: `frontend/src/components/LoginForm.tsx`
- Create: `frontend/src/app/login/page.tsx`

- [ ] **Step 1: Create `frontend/src/components/LoginForm.tsx`**

```typescript
// frontend/src/components/LoginForm.tsx
'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'

export default function LoginForm() {
    const router = useRouter()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    async function handleSubmit(e: FormEvent) {
        e.preventDefault()
        setError(null)
        setLoading(true)

        try {
            await apiFetch('/v1/login', {
                method: 'POST',
                body: JSON.stringify({ email, password })
            })
            router.push('/ocr')
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Login failed')
        } finally {
            setLoading(false)
        }
    }

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full">
            <div>
                <label className="block text-xs text-[#4cc9f0] uppercase mb-1">Email</label>
                <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    className="w-full bg-[#16213e] border border-[#0f3460] rounded px-3 py-2 text-sm text-[#e0e0e0] focus:outline-none focus:border-[#4cc9f0]"
                />
            </div>
            <div>
                <label className="block text-xs text-[#4cc9f0] uppercase mb-1">Password</label>
                <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    className="w-full bg-[#16213e] border border-[#0f3460] rounded px-3 py-2 text-sm text-[#e0e0e0] focus:outline-none focus:border-[#4cc9f0]"
                />
            </div>
            {error && <p className="text-[#e94560] text-sm">{error}</p>}
            <button
                type="submit"
                disabled={loading}
                className="bg-[#0f3460] text-[#4cc9f0] rounded px-4 py-2 text-sm hover:bg-[#4cc9f0] hover:text-[#1a1a2e] transition-colors disabled:opacity-50"
            >
                {loading ? 'Signing in...' : 'Sign in'}
            </button>
        </form>
    )
}
```

- [ ] **Step 2: Create `frontend/src/app/login/page.tsx`**

```typescript
// frontend/src/app/login/page.tsx
import LoginForm from '@/components/LoginForm'

export default function LoginPage() {
    return (
        <main className="flex min-h-screen items-center justify-center px-4">
            <div className="w-full max-w-sm">
                <h1 className="text-2xl font-bold text-[#4cc9f0] mb-8">✦ OCR Extract</h1>
                <LoginForm />
            </div>
        </main>
    )
}
```

- [ ] **Step 3: Start the backend and frontend and verify the login page renders**

In one terminal:
```bash
npm run start:dev
```

In another:
```bash
cd frontend && npm run dev
```

Open `http://localhost:3001/login` — you should see the dark login form with email and password fields.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/LoginForm.tsx frontend/src/app/login/
git commit -m "feat: add login page and LoginForm component"
```

---

## Task 8: OCR page

**Files:**
- Create: `frontend/src/components/ImageUploader.tsx`
- Create: `frontend/src/components/OcrResult.tsx`
- Create: `frontend/src/app/ocr/page.tsx`

- [ ] **Step 1: Create `frontend/src/components/ImageUploader.tsx`**

```typescript
// frontend/src/components/ImageUploader.tsx
'use client'

import { useRef, useState, DragEvent } from 'react'

interface Props {
    onUpload: (file: File) => void
    disabled?: boolean
}

export default function ImageUploader({ onUpload, disabled }: Props) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [dragging, setDragging] = useState(false)

    function handleFiles(files: FileList | null) {
        if (!files || files.length === 0) return
        onUpload(files[0])
    }

    function onDrop(e: DragEvent) {
        e.preventDefault()
        setDragging(false)
        handleFiles(e.dataTransfer.files)
    }

    return (
        <div
            onClick={() => !disabled && inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={[
                'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
                dragging ? 'border-[#4cc9f0] bg-[#0f3460]/20' : 'border-[#4cc9f0]/40 hover:border-[#4cc9f0]',
                disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
            ].join(' ')}
        >
            <div className="text-3xl mb-2">📄</div>
            <p className="text-sm text-[#aaa]">Drop image here or click to upload</p>
            <p className="text-xs text-[#555] mt-1">PNG, JPG, WEBP, TIFF · max 10 MB</p>
            <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/tiff"
                className="hidden"
                onChange={e => handleFiles(e.target.files)}
                disabled={disabled}
            />
        </div>
    )
}
```

- [ ] **Step 2: Create `frontend/src/components/OcrResult.tsx`**

```typescript
// frontend/src/components/OcrResult.tsx
interface Props {
    text: string
    confidence: number
    pipeline: string
    processingTimeMs: number
}

export default function OcrResult({ text, confidence, pipeline, processingTimeMs }: Props) {
    return (
        <div className="bg-[#16213e] rounded-lg p-4">
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
```

- [ ] **Step 3: Create `frontend/src/app/ocr/page.tsx`**

```typescript
// frontend/src/app/ocr/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { checkSession, logout } from '@/lib/auth'
import { apiUpload } from '@/lib/api'
import ImageUploader from '@/components/ImageUploader'
import OcrResult from '@/components/OcrResult'

interface OcrData {
    text: string
    confidence: number
    pipeline: string
    processingTimeMs: number
}

const ERROR_MESSAGES: Record<number, string> = {
    401: '',
    413: 'File too large — max 10 MB',
    422: 'No image provided',
    500: 'Extraction failed — try a clearer image'
}

export default function OcrPage() {
    const router = useRouter()
    const [result, setResult] = useState<OcrData | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [checking, setChecking] = useState(true)

    useEffect(() => {
        checkSession().then(ok => {
            if (!ok) router.push('/login')
            else setChecking(false)
        })
    }, [router])

    async function handleUpload(file: File) {
        setError(null)
        setResult(null)
        setLoading(true)

        try {
            const form = new FormData()
            form.append('image', file)
            const res = await apiUpload<OcrData>('/v1/ocr/extract', form)
            setResult(res.data)
        } catch (err) {
            const status = (err as Error & { status?: number }).status ?? 500
            if (status === 401) { router.push('/login'); return }
            setError(ERROR_MESSAGES[status] ?? ERROR_MESSAGES[500])
        } finally {
            setLoading(false)
        }
    }

    async function handleLogout() {
        await logout()
        router.push('/login')
    }

    if (checking) return null

    return (
        <div className="max-w-lg mx-auto px-4 py-8">
            <div className="bg-[#16213e] rounded-lg px-4 py-3 mb-6 flex justify-between items-center">
                <span className="text-[#4cc9f0] font-bold">✦ OCR Extract</span>
                <button
                    onClick={handleLogout}
                    className="text-[#e94560] hover:underline text-xs"
                >
                    logout
                </button>
            </div>

            <div className="flex flex-col gap-4">
                <ImageUploader onUpload={handleUpload} disabled={loading} />
                {loading && (
                    <p className="text-center text-sm text-[#aaa]">Extracting...</p>
                )}
                {error && (
                    <p className="text-center text-sm text-[#e94560]">{error}</p>
                )}
                {result && <OcrResult {...result} />}
            </div>
        </div>
    )
}
```

- [ ] **Step 4: Test the full flow end-to-end**

With the backend and frontend both running:

1. Go to `http://localhost:3001` — should redirect to `/login`
2. Log in with a valid account — should redirect to `/ocr`
3. Upload a handwritten image — should show extracted text, confidence %, pipeline name, and processing time
4. Click logout — should return to `/login`
5. Visit `/ocr` directly without logging in — should redirect to `/login`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ frontend/src/app/ocr/
git commit -m "feat: add OCR page with image uploader and result display"
```
