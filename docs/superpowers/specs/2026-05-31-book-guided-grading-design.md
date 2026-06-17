# Book-Guided Grading Design Spec

**Date:** 2026-05-31  
**Branch:** feature/ocr-extract  
**Status:** Approved

## Overview

Allow teachers to upload one or more PDF reference books/guides as the answer source for a test, instead of an image answer key. The agent extracts text from the PDFs, uses keyword-based page retrieval to find the relevant sections for each exam question, and grades the student's answers against that reference material.

This replaces the manual answer key workflow for knowledge-based exams where answers can be derived from a course guide or textbook.

---

## Grading Modes

A test now has a `gradingMode` field — either `answerKey` (existing image-based flow) or `guidedBook` (new PDF guide flow). The two modes are mutually exclusive per test. Switching modes clears the previous mode's stored data after a teacher confirmation prompt.

---

## Data Model Changes

**Test document — new fields:**

```ts
gradingMode: 'answerKey' | 'guidedBook'   // default: 'answerKey'
guidePages: Array<{
  pageNumber: number
  text: string
  source: string   // original PDF filename
}>
guideSources: Array<{
  filename: string
  pageCount: number
}>
```

- `answerKey` buffer field is unchanged and still used when `gradingMode === 'answerKey'`
- Guide pages from multiple PDFs are merged into one flat array with sequential page numbers
- A 200-page guide at ~1500 chars/page ≈ 300KB of text — acceptable for MongoDB document storage
- No new collections required

---

## API Changes

### New endpoint: Upload guide PDFs
`POST /v1/exam/tests/:testId/guides`  
- Accepts: multipart, one or more PDF files  
- Calls TrOCR `/extract-guide` for each PDF  
- Merges all pages into the test's `guidePages` array  
- Sets `gradingMode: 'guidedBook'`, clears `answerKey`  
- Returns: `{ pageCount, sources: [{ filename, pageCount }] }`

### Modified endpoint: Grade student paper
`POST /v1/exam/grade`  
- No signature change  
- Internally detects `gradingMode` and branches to the guided grading pipeline if `guidedBook`

---

## TrOCR Service Changes

### New route: `/extract-guide` (POST)
Accepts a single PDF file. For each page:
1. Attempt text extraction via PyMuPDF (`page.get_text()`)
2. If extracted text < 50 chars, render the page as an image and run Tesseract OCR (fallback for scanned pages)
3. Return array of `{ pageNumber, text, source }` objects

Pages that yield no text after both attempts are stored as empty strings and skipped during retrieval — no crash.

If an entire PDF is unreadable (corrupt), return a 422 with the filename. If all pages across all files are empty, reject with "No readable text found in guide PDFs."

---

## Grading Pipeline (guidedBook mode)

### Step 1 — OCR student paper (unchanged)
Extract student paper text via existing OCR pipeline.

### Step 2 — Keyword extraction (one Gemini call)
Send all question texts to Gemini in a single call. Returns a map:
```json
{ "1": ["mitochondria", "ATP", "cellular respiration"], "2": ["photosynthesis", "chlorophyll"] }
```

### Step 3 — Page scoring (local, no API call)
For each question:
- Score every guide page by counting keyword hits (case-insensitive)
- Include all pages scoring **≥ 2 keyword hits**, up to a **cap of 6 pages per question**
- If fewer than 2 pages meet the threshold, fall back to top 2 pages by score regardless
- Each question gets its own independently retrieved page set

**Context window safety:** if total retrieved text across all questions exceeds ~800K chars, trim lowest-scoring pages per question until it fits.

### Step 4 — Grading (one Gemini call)
Single prompt batching all questions with their retrieved pages:

```
QUESTION 1: [text]
STUDENT ANSWER 1: [text]
REFERENCE PAGES FOR Q1: [page 4 text] [page 11 text] [page 23 text]

QUESTION 2: [text]
STUDENT ANSWER 2: [text]
REFERENCE PAGES FOR Q2: [page 7 text] [page 19 text] [page 31 text] [page 44 text]
...
```

Instructions tell Gemini to use the reference pages to determine the correct answer, then grade the student answer. If no reference material is available for a question, Gemini grades on general knowledge and notes "answer unverified against guide" in the feedback.

Response shape is identical to today: `{ totalScore, maxScore, questions: [{ number, correctAnswer, studentAnswer, score, feedback }] }`.

---

## Frontend Changes

### Test setup (exam page)
- Mode toggle: `Answer Key` | `Guide PDFs` — appears when creating or selecting a test
- `Guide PDFs` selected: replaces Answer Key upload slot with a multi-file PDF-only uploader
- Saved guides shown as: "✓ X pages loaded from Y files — drop to replace"
- Switching modes: confirmation dialog "This will remove your saved [answer key / guide PDFs]. Continue?"
- Guide upload in progress: "Extracting guide text…" spinner (OCR on scanned pages can take time)

### Grade button readiness
`canGrade` checks `hasAnswerKey` or `hasGuide` depending on `gradingMode` — no other change.

### Results display
- `ExamResult` component unchanged — same JSON shape
- Small badge on result: `📄 Answer Key` or `📚 Guide (X pages)` indicating what was used for grading

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Corrupt PDF in upload | 422 with the specific filename; other PDFs in the same batch are still saved |
| All guide pages empty | Upload rejected: "No readable text found in guide PDFs" |
| No pages retrieved for a question | Gemini grades on general knowledge; feedback notes "unverified against guide" |
| Context window exceeded | Trim lowest-scoring pages per question until total fits within ~800K chars |
| Teacher switches grading mode | Frontend warns; backend clears previous mode's data on confirm |

---

## What Does Not Change

- `gradeExam` service function signature
- `ExamRecord` model and schema
- Results page and `ExamResult` component
- Printed / handwritten OCR pipeline
- Auth and user-scoping logic
