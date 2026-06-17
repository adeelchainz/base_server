# Exam Dashboard — Design Spec
**Date:** 2026-05-24

## Overview

Add persistent test management and a results dashboard to the homework grader. A single teacher logs in, grades student papers grouped under named tests, and views per-test results with class statistics.

---

## Data Models

### New: `Test` (`src/APIs/exam/test.model.ts`)

| Field | Type | Notes |
|---|---|---|
| `name` | String, required | Display name e.g. "Chapter 5 Quiz" |
| `createdAt` | Date | Auto via timestamps |

### Updated: `ExamRecord`

Two new required fields added to the existing schema:

| Field | Type | Notes |
|---|---|---|
| `testId` | ObjectId, ref Test | Links record to a test |
| `studentName` | String, required | Typed by teacher at grade time |

All existing fields (`mode`, `answerKeyText`, `studentPaperText`, `totalScore`, `maxScore`, `percentage`, `questions`) unchanged. No migration needed for existing records — new fields apply going forward.

---

## Backend API

All exam routes are wrapped with the existing `authenticate` middleware.

### Modified endpoint

**`POST /v1/exam/grade`**
- Accepts `testId` (existing test) **or** `testName` (new test — creates a `Test` document first)
- Accepts `studentName` (required string)
- Returns the saved `ExamRecord` as before

### New endpoints

**`GET /v1/exam/tests`**
- Returns all tests: `{ _id, name, studentCount, createdAt }`
- `studentCount` computed via aggregation on `ExamRecord`
- Used by: grade-form dropdown, results sidebar

**`GET /v1/exam/tests/:testId/results`**
- Returns all `ExamRecord`s for the test plus computed stats: `{ avg, high, low }`
- Stats derived from a single Mongoose aggregation over `percentage`
- Used by: results panel

**`PATCH /v1/exam/records/:recordId`**
- Accepts partial updates to `questions` array
- Recomputes `totalScore`, `maxScore`, `percentage` from updated questions
- Used by: edit-grading feature

---

## Frontend

### Updated `/exam` page

- **Test selector** (above file uploads): dropdown of existing tests from `GET /v1/exam/tests` + "New test…" option that reveals a text input
- **Student name** text input (required)
- Grade button disabled until test, student name, and both files are selected

### New `/results` page (`src/app/results/page.tsx`)

**Layout: Sidebar + Panel**

- **Sidebar (left):** scrollable list of all tests showing name and student count. Selected test is highlighted. Loads on mount via `GET /v1/exam/tests`.
- **Panel (right):**
  - Stats bar: Avg % / Highest % / Lowest % (from `GET /v1/exam/tests/:testId/results`)
  - Student table: name, score (e.g. 19/20), percentage — colour-coded green/amber/red
  - Clicking a student row expands inline question-by-question breakdown
  - Each expanded row has an **Edit** button
- **Edit mode:** score chip (`correct`/`partial`/`wrong`) and feedback for each question become editable. Save hits `PATCH /v1/exam/records/:recordId` and refreshes panel stats.

### Navigation

Add a "Results" link to the shared header so the teacher can switch between `/exam` (grading) and `/results` (dashboard).

### Auth guard

All frontend exam/results pages redirect to `/login` if no valid session cookie is present.

---

## Error Handling

| Scenario | Response |
|---|---|
| `testName` provided but blank | 422 — "Test name is required" |
| `studentName` blank | 422 — "Student name is required" |
| `testId` not found | 404 — "Test not found" |
| `recordId` not found on PATCH | 404 — "Record not found" |
| Unauthenticated request | 401 (existing middleware) |

---

## Out of Scope

- Multiple teachers / multi-user support
- Deleting tests or student records
- Exporting results (CSV, PDF)
- Student-facing login
