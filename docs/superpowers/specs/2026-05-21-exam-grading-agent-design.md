# Exam Grading AI Agent — Design Spec

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Upload an answer key and a student exam paper, OCR both, then have an AI agent score every question and explain each mistake — saving the result to MongoDB and displaying it in the React frontend.

**Architecture:** OCR extraction stays in the Python microservice (existing). The grading agent lives entirely in the Node.js/Express backend, calling Gemini's text API directly (`@google/genai`). Results are stored in MongoDB and returned to a new Next.js page.

**Tech Stack:** MongoDB, Express, React/Next.js, Node.js (MERN) + existing Python OCR service + Gemini text API via `google-genai`

---

## Data Flow

```
React (Next.js) — /exam page
  → POST /v1/exam/grade  (multipart: answerKey file + studentPaper file + mode)
    → Python OCR service  — extracts text from both files
    → Gemini text API     — grades, scores, produces per-question feedback
    → MongoDB             — saves ExamRecord
  ← { totalScore, maxScore, percentage, questions[] }
```

---

## File Structure

**New files:**
- `src/APIs/exam/index.ts` — route registration
- `src/APIs/exam/exam.controller.ts` — request handling, multipart parsing
- `src/APIs/exam/exam.service.ts` — orchestrates OCR → grading → save
- `src/APIs/exam/exam.model.ts` — Mongoose schema + model
- `src/services/grading.ts` — Gemini text API call, prompt, response parsing
- `src/APIs/exam/types/exam.interface.ts` — shared TypeScript types
- `src/__tests__/exam/grading.spec.ts` — unit tests for grading service
- `frontend/src/app/exam/page.tsx` — new Next.js page
- `frontend/src/components/ExamResult.tsx` — score badge + per-question cards

**Modified files:**
- `src/APIs/router.ts` — register `/v1/exam` route
- `src/middlewares/upload.ts` — already supports required MIME types (no change needed)

---

## MongoDB Schema

```typescript
// ExamRecord
{
  _id: ObjectId,
  createdAt: Date,
  mode: 'handwritten' | 'printed',
  answerKeyText: string,       // raw OCR output of answer key
  studentPaperText: string,    // raw OCR output of student paper
  totalScore: number,
  maxScore: number,
  percentage: number,          // 0–100
  questions: [{
    number: number,
    correctAnswer: string,
    studentAnswer: string,
    score: 'correct' | 'partial' | 'wrong',
    feedback: string            // one sentence explaining any mistake
  }],
}
```

---

## Grading Prompt

Sent from `src/services/grading.ts` to Gemini text API:

```
You are an exam grader. You will be given an answer key and a student's exam paper.

ANSWER KEY:
<answerKeyText>

STUDENT PAPER:
<studentPaperText>

Instructions:
- Match each question in the student paper to the corresponding answer in the key.
- For each question assign a score: "correct", "partial", or "wrong".
- Write a one-sentence feedback explaining any mistake (leave empty string if correct).
- Count totalScore (correct=1, partial=0.5, wrong=0) and maxScore (total questions).

Respond with ONLY valid JSON in this exact shape:
{
  "totalScore": number,
  "maxScore": number,
  "questions": [
    {
      "number": number,
      "correctAnswer": string,
      "studentAnswer": string,
      "score": "correct" | "partial" | "wrong",
      "feedback": string
    }
  ]
}
```

---

## API Endpoint

**`POST /v1/exam/grade`**

- Content-Type: `multipart/form-data`
- Fields: `answerKey` (file), `studentPaper` (file), `mode` (string, default `"printed"`)
- Success `200`: `{ success: true, data: ExamRecord }`
- Error responses:
  - `422` — missing file, OCR failed, or Gemini couldn't parse question structure
  - `503` — Gemini API unavailable
  - `500` — unexpected server error

---

## Frontend

**`/exam` page (`frontend/src/app/exam/page.tsx`):**
- Two upload zones side by side: "Answer Key" and "Student Paper"
- Mode toggle (Handwritten / Printed) — reuses same pattern as OCR page
- Single "Grade" button, disabled until both files are selected
- Loading state while grading

**`ExamResult` component:**
- Score badge at top: e.g. `14 / 20 (70%)`
- One card per question showing:
  - Question number
  - Correct answer vs. student answer
  - Score chip (green = correct, amber = partial, red = wrong)
  - Feedback sentence (hidden if correct)

---

## Error Handling

| Scenario | HTTP | Message |
|---|---|---|
| Missing answerKey or studentPaper file | 422 | "Both answer key and student paper files are required." |
| OCR fails on either file | 422 | "Could not extract text from [answer key / student paper]." |
| Gemini returns malformed JSON | 422 | "Could not identify question structure — ensure the exam is clearly formatted." |
| Gemini API error | 503 | "Grading service unavailable." |
| Unexpected error | 500 | "Grading failed." |

---

## Testing

`src/__tests__/exam/grading.spec.ts` — unit tests for `src/services/grading.ts`:
- Mock Gemini response → verify correct score calculation and question mapping
- Malformed Gemini JSON → verify throws with correct message
- Empty answer key text → verify 422 error
