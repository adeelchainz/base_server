# OCR Hardening + Next.js Frontend Design

**Date:** 2026-05-20
**Branch:** feature/ocr-extract

---

## Goal

1. Harden the existing OCR service to reliably handle diverse handwriting styles from different people.
2. Build a thin Next.js frontend that lets authenticated users upload images and see extracted text.

---

## Part 1: OCR Hardening (Backend)

### Problem

The current preprocessing pipeline (greyscale → normalise → sharpen) is a single path optimised for printed text. Handwriting from different people varies in ink weight, slant, noise, and contrast — no single preprocessing strategy works well across all of them.

### Solution: Multi-Pipeline with Best-Confidence Selection

Run four preprocessing pipelines sequentially through a single Tesseract.js worker per request. Short-circuit if any pipeline returns confidence ≥ 85%. Otherwise return the result with the highest confidence.

| Pipeline | Sharp operations | What it targets |
|---|---|---|
| `baseline` | greyscale → normalise → sharpen | Clean, well-lit handwriting |
| `binarize` | greyscale → normalise → threshold(128) → sharpen | High-contrast ink on white paper |
| `denoise` | greyscale → blur(0.5) → normalise → sharpen | Noisy or textured backgrounds |
| `high-contrast` | greyscale → gamma(1.5) → normalise → sharpen | Faded or light-coloured ink |

### Changes to `src/services/ocr.ts`

- `preprocessImage` is replaced by a `PIPELINES` array of `{ name, fn }` objects.
- `extractText` creates one worker, iterates pipelines, tracks best result, terminates worker in `finally`.
- `IOcrResult` gains a `pipeline: string` field.

### Response shape (updated)

```json
{
  "text": "Hello world",
  "confidence": 87,
  "processingTimeMs": 1340,
  "pipeline": "denoise"
}
```

### Testing

A Jest test suite at `src/__tests__/ocr/ocr-pipelines.spec.ts` runs all four pipelines against fixture images in `src/__tests__/ocr/fixtures/`. Tests assert that the best-confidence result is returned and that the `pipeline` field is populated. Fixture images must include at least one handwritten sample per pipeline target type.

---

## Part 2: Next.js Frontend

### Structure

```
frontend/
├── package.json
├── next.config.ts
├── tsconfig.json
└── src/
    ├── app/
    │   ├── layout.tsx          ← root layout, dark theme globals
    │   ├── page.tsx            ← redirects to /login or /ocr
    │   ├── login/
    │   │   └── page.tsx        ← login form
    │   └── ocr/
    │       └── page.tsx        ← OCR page (auth-protected)
    ├── lib/
    │   ├── api.ts              ← typed fetch wrapper (credentials: include)
    │   └── auth.ts             ← session check helpers
    └── components/
        ├── LoginForm.tsx
        ├── ImageUploader.tsx   ← drag-drop + click-to-upload
        └── OcrResult.tsx       ← text display, confidence badge, pipeline tag, time
```

### Visual design

Dark single-column layout:
- Top bar: app name left, email + logout right
- Upload zone: dashed border, drop target, accepted formats listed
- Result panel below upload: extracted text, confidence %, pipeline name, processing time

### Auth flow

1. User visits `/` → redirect to `/login` if no active session.
2. Login POSTs credentials to `POST /v1/login`.
3. Backend sets an httpOnly cookie; frontend stores nothing in localStorage.
4. All API calls use `credentials: 'include'`.
5. On `401` response, frontend redirects to `/login`.

### Technology

- Next.js 15 (App Router)
- Tailwind CSS (dark theme, no heavy UI library)
- TypeScript

---

## Part 3: Integration

### CORS

`app.ts` currently hardcodes `origin: ['https://xyz.com']`. This becomes an env var:

```
CORS_ORIGIN=http://localhost:3000   # .env.development
CORS_ORIGIN=https://your-domain.com # .env.production
```

### Error handling (frontend)

| HTTP status | User-facing message |
|---|---|
| 401 | Redirect to `/login` |
| 413 | "File too large — max 10 MB" |
| 422 | "No image provided" |
| 500 | "Extraction failed — try a clearer image" |

### API surface used by frontend

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/login` | Authenticate, receive session cookie |
| POST | `/v1/ocr/extract` | Upload image, receive OCR result |
| PUT  | `/v1/logout` | Clear session cookie |

---

## Out of Scope

- Extraction history / per-user result log
- Multi-language OCR
- PDF support
- Admin dashboard
