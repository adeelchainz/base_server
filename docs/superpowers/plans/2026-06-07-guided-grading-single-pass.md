# Guided Grading Single-Pass Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix guided grading so Gemini receives the full question with all answer options, the guide pages, and the student's answer together — and reasons from the guide to determine the correct answer, rather than having the correct answer pre-extracted and handed to it.

**Architecture:** Two targeted changes: (1) update the OCR prompts in the Python service to capture all printed answer options in the output (not just the student's chosen one), and (2) collapse the two-pass grading flow in `guidedGrading.ts` into a single-pass prompt where the guide, full question with options, and student answer are all present at grading time.

**Tech Stack:** Python/Flask (trocr_service.py), TypeScript/Node (guidedGrading.ts), Gemini API via `callGeminiWithBackoff`

---

### Task 1: Update OCR prompts to capture all answer options

**Files:**
- Modify: `trocr/trocr_service.py`

The two OCR prompts currently tell Gemini to omit answer choices. We change both to include all pre-printed options before the `→`.

- [ ] **Step 1: Update `_PRINTED_MARK_PROMPT`**

In `trocr/trocr_service.py`, replace the `_PRINTED_MARK_PROMPT` string (lines ~204–232) with:

```python
_PRINTED_MARK_PROMPT = (
    'Read this printed exam paper.\n\n'
    'FIRST LINE: If a student name appears anywhere on this paper (in a "Name:", "Student:", or similar field, '
    'or written at the top), output it as the very first line like this:\n'
    'Name: [student\'s name]\n'
    'If no name is visible, output: Name: (blank)\n\n'
    'THEN for each question output ONE line:\n'
    '[number]. [full question text] [all pre-printed options] → [student\'s marked answer]\n\n'
    'The student marks answers by circling a letter, filling/shading a bubble, '
    'writing in a blank, crossing out or checking an option.\n\n'
    'Rules:\n'
    '- Include the complete question text AND all pre-printed answer options before the →\n'
    '  For multiple choice format it as: [question text] A) ... B) ... C) ... D) ...\n'
    '- After → write the FULL TEXT of what the student marked:\n'
    '  * For multiple choice: include both the letter AND the choice text (e.g. "C) Canberra", not just "C")\n'
    '  * For written answers: write exactly what the student wrote\n'
    '  * For True/False: identify which pre-printed option has a student mark — a circle, fill, shade,\n'
    '    underline, cross, or check. Write the full word of that option ("True" or "False").\n'
    '    If the student wrote "T" write "True"; if "F" write "False".\n'
    '    Only write (blank) if there is genuinely no indication of their answer.\n'
    '- If nothing is marked for a question, write → (blank)\n'
    '- Cover every question on the page from top to bottom\n'
    '- Output nothing else\n\n'
    'Example output:\n'
    'Name: John Smith\n'
    '1. What is the capital of Australia? A) Sydney B) Melbourne C) Canberra D) Brisbane → C) Canberra\n'
    '2. Which planet is the Red Planet? A) Venus B) Mars C) Jupiter D) Saturn → B) Mars\n'
    '3. Describe photosynthesis. → Plants convert sunlight to glucose\n'
    '4. True or false: water boils at 100C True False → True'
)
```

- [ ] **Step 2: Update `HANDWRITING_PROMPT`**

In `trocr/trocr_service.py`, replace the `HANDWRITING_PROMPT` string (lines ~29–56) with:

```python
HANDWRITING_PROMPT = (
    'You are scanning a student exam paper.\n\n'
    'FIRST LINE: If a student name appears anywhere on this paper (in a "Name:", "Student:", or similar field, '
    'or written at the top), output it as the very first line like this:\n'
    'Name: [student\'s name]\n'
    'If no name is visible, output: Name: (blank)\n\n'
    'THEN for each question output ONE line:\n'
    '[number]. [full question text] [all pre-printed options] → [student\'s answer]\n\n'
    'The student may have circled/filled/bubbled a choice, written an answer in a blank, or checked an option.\n\n'
    'Rules:\n'
    '- Include the complete pre-printed question text AND all pre-printed answer options before the →\n'
    '  For multiple choice format it as: [question text] A) ... B) ... C) ... D) ...\n'
    '- After → write exactly what the student wrote or marked:\n'
    '  * For multiple choice: include both the letter AND the choice text (e.g. "B) Mars", not just "B")\n'
    '  * For written answers: write exactly what the student wrote\n'
    '  * For True/False: the student may write "True"/"False" as text, OR circle/fill/check a pre-printed option.\n'
    '    Write the full word — "True" or "False" — based on whichever they indicated.\n'
    '    If they wrote "T" write "True"; if "F" write "False".\n'
    '    Only write (blank) if there is genuinely no indication of their choice.\n'
    '- If nothing is written or marked for a question, write → (blank)\n'
    '- Cover every question from top to bottom — do not skip any\n'
    '- Output nothing else\n\n'
    'Example output:\n'
    'Name: John Smith\n'
    '1. What is the capital of Australia? A) Sydney B) Melbourne C) Canberra D) Brisbane → C) Canberra\n'
    '2. Which planet is the Red Planet? A) Venus B) Mars C) Jupiter D) Saturn → B) Mars\n'
    '3. Describe photosynthesis. → Plants use sunlight to convert CO2 and water into glucose\n'
    '4. True or false: water boils at 100C True False → True'
)
```

- [ ] **Step 3: Commit**

```bash
git add trocr/trocr_service.py
git commit -m "fix: include all answer options in OCR output for guided grading"
```

---

### Task 2: Remove two-pass flow and implement single-pass grading

**Files:**
- Modify: `src/services/guidedGrading.ts`

Remove `extractCorrectAnswersFromGuide` and `buildGradingWithAnswersPrompt`. Update `buildGuidedPrompt` so the single-pass prompt instructs Gemini to derive the correct answer from the guide pages itself — not from a pre-extracted string.

- [ ] **Step 1: Write a failing test for the new single-pass behaviour**

Add this describe block to `src/__tests__/services/guidedGrading.test.ts`:

```typescript
import { gradeExamGuided } from '../../services/guidedGrading'

// Mock callGeminiWithBackoff so we can inspect the prompt sent to Gemini
jest.mock('../../services/grading', () => ({
    callGeminiWithBackoff: jest.fn(),
    hardenGradingJson: jest.fn((raw: string) => JSON.parse(raw)),
    parseKeywordMap: jest.fn().mockReturnValue({})
}))

import { callGeminiWithBackoff } from '../../services/grading'

describe('gradeExamGuided — single-pass', () => {
    it('sends all options and guide pages to Gemini in one call (no pre-extraction)', async () => {
        const mockCall = callGeminiWithBackoff as jest.Mock
        mockCall.mockResolvedValue(
            JSON.stringify({
                totalScore: 1, maxScore: 1,
                questions: [{ number: 1, correctAnswer: 'B) Mars', studentAnswer: 'B) Mars', score: 'correct', feedback: '' }]
            })
        )

        const guidePages = [{ pageNumber: 1, text: 'Mars is called the Red Planet because of its reddish appearance.', source: 'guide.pdf' }]
        const studentPaper = '1. Which planet is the Red Planet? A) Venus B) Mars C) Jupiter D) Saturn → B) Mars'

        await gradeExamGuided(guidePages, studentPaper)

        // Should call Gemini exactly once (single-pass)
        expect(mockCall).toHaveBeenCalledTimes(1)

        const prompt: string = mockCall.mock.calls[0][0]
        // Prompt must contain all four options
        expect(prompt).toContain('A) Venus')
        expect(prompt).toContain('B) Mars')
        expect(prompt).toContain('C) Jupiter')
        expect(prompt).toContain('D) Saturn')
        // Prompt must contain guide content
        expect(prompt).toContain('Red Planet')
        // Prompt must NOT contain a pre-extracted correct answer header
        expect(prompt).not.toContain('CORRECT ANSWERS (derived')
    })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx jest guidedGrading --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `callGeminiWithBackoff` called more than once, or options missing from prompt.

- [ ] **Step 3: Update `buildGuidedPrompt` in `guidedGrading.ts`**

Replace the existing `buildGuidedPrompt` function (around line 357–386) with:

```typescript
function buildGuidedPrompt(studentPaperText: string, refByQ: Map<number, IGuidePage[]>): string {
    const refBlocks = [...refByQ.entries()]
        .map(([qNum, pages]) => {
            const pagesText =
                pages.length > 0
                    ? pages.map((p) => `[Page ${p.pageNumber} from ${p.source}]\n${p.text}`).join('\n\n')
                    : '[No reference — use best judgement; note "answer unverified against guide" in feedback]'
            return `REFERENCE PAGES FOR Q${qNum}:\n${pagesText}`
        })
        .join('\n\n---\n\n')

    return `You are an exam grader. Use ONLY the reference pages below to determine the correct answer for each question. Do not rely on prior knowledge — derive every correct answer from the guide.

STUDENT PAPER:
${studentPaperText}

${refBlocks}

Instructions:
- For each question, read the reference pages to identify which answer option is correct
- The correctAnswer must come solely from the reference pages — never from what the student wrote
- The student's answer is after the →; copy it verbatim. If blank or missing, use "" and mark wrong
- Assign score: "correct", "partial", or "wrong". correct=1, partial=0.5, wrong=0
- One-sentence feedback for wrong/partial answers explaining what the guide says; "" if correct
- The student paper uses the format "[number]. [question text] [options] → [student answer]"
  "(blank)" means unanswered — mark wrong with empty studentAnswer

Respond with ONLY valid JSON — no markdown, no explanation:
{"totalScore":number,"maxScore":number,"questions":[{"number":number,"correctAnswer":string,"studentAnswer":string,"score":"correct"|"partial"|"wrong","feedback":string}]}`
}
```

- [ ] **Step 4: Remove `extractCorrectAnswersFromGuide` and `buildGradingWithAnswersPrompt`**

Delete both functions from `guidedGrading.ts` (approximately lines 283–354). They are no longer called.

- [ ] **Step 5: Update the main `gradeExamGuided` export to single-pass**

Replace the section at the bottom of `gradeExamGuided` (approximately lines 440–450) that reads:

```typescript
    const correctAnswers = await extractCorrectAnswersFromGuide(segments, refByQ)

    const raw = correctAnswers.size > 0
        ? await callGeminiWithBackoff(buildGradingWithAnswersPrompt(resolvedText, correctAnswers))
        : await callGeminiWithBackoff(buildGuidedPrompt(resolvedText, refByQ))
```

with:

```typescript
    const raw = await callGeminiWithBackoff(buildGuidedPrompt(resolvedText, refByQ))
```

- [ ] **Step 6: Remove the unused `geminiKeywordFallback` prompt import**

`geminiKeywordFallback` passes segments through `questionOnly` to Gemini for keyword extraction. That function is unchanged and still needed — no removal required. Verify the file compiles:

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 7: Run all tests**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests pass including the new single-pass test.

- [ ] **Step 8: Commit**

```bash
git add src/services/guidedGrading.ts src/__tests__/services/guidedGrading.test.ts
git commit -m "fix: single-pass guided grading — Gemini reasons from guide+options, no pre-extraction"
```

---

### Task 3: Push and update PR

- [ ] **Step 1: Push**

```bash
git push origin feature/ocr-extract
```

Expected: branch updates on remote, existing PR at https://github.com/adeelchainz/base_server/pull/6 picks up the new commits automatically.
