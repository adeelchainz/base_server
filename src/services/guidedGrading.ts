// src/services/guidedGrading.ts
import { CustomError } from '../utils/errors'
import { IGuidePage, IGradingResult } from '../APIs/exam/types/exam.interface'
import { hardenGradingJson, parseKeywordMap, callGeminiWithBackoff } from './grading'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logger = (require('../handlers/logger') as { default: typeof import('../handlers/logger').default }).default

const CONTEXT_BUDGET_CHARS = 800_000
const MAX_PAGES_PER_Q = 6
const MIN_RAW_HITS = 2
const MIN_KEYWORDS = 2

// ── Stop-word lists ───────────────────────────────────────────────────────────
const STOP = new Set([
    'the',
    'a',
    'an',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'shall',
    'can',
    'to',
    'of',
    'in',
    'on',
    'at',
    'by',
    'for',
    'with',
    'about',
    'into',
    'through',
    'from',
    'this',
    'that',
    'these',
    'those',
    'i',
    'we',
    'you',
    'he',
    'she',
    'it',
    'they',
    'what',
    'which',
    'who',
    'how',
    'when',
    'where',
    'why',
    'all',
    'each',
    'both',
    'and',
    'or',
    'but',
    'if',
    'because',
    'as',
    'until',
    'while',
    'not',
    'no',
    'so',
    'than',
    'too',
    'very',
    'just',
    'now',
    'own',
    'same',
    'only',
    'more',
    'most',
    's',
    't'
])
const DOMAIN_GENERIC = new Set([
    'define',
    'describe',
    'explain',
    'list',
    'name',
    'state',
    'give',
    'write',
    'process',
    'system',
    'example',
    'type',
    'use',
    'main',
    'part',
    'role',
    'function',
    'discuss',
    'compare',
    'contrast',
    'identify',
    'outline',
    'following',
    'show',
    'find',
    'make',
    'note',
    'true',
    'false',
    'answer',
    'question'
])

// ── Stemmer (simple suffix strip) ────────────────────────────────────────────
function stem(word: string): string {
    return word
        .replace(/ations?$/, 'at')
        .replace(/ments?$/, '')
        .replace(/nesses?$/, '')
        .replace(/ings?$/, '')
        .replace(/ous$/, '')
        .replace(/ive$/, '')
        .replace(/ful$/, '')
        .replace(/less$/, '')
        .replace(/ies$/, 'y')
        .replace(/es$/, 'e')
        .replace(/s$/, '')
}

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2)
}

export function extractLocalKeywords(text: string): string[] {
    const words = tokenize(text)
    const keywords = words
        .filter((w) => !STOP.has(w) && !DOMAIN_GENERIC.has(w))
        .map(stem)
        .filter((w) => w.length > 2)
    return [...new Set(keywords)]
}

// ── IDF ───────────────────────────────────────────────────────────────────────
export function computeIdf(pages: IGuidePage[]): Map<string, number> {
    const N = pages.length
    const df = new Map<string, number>()
    for (const page of pages) {
        const words = new Set(tokenize(page.text).map(stem))
        for (const w of words) df.set(w, (df.get(w) ?? 0) + 1)
    }
    const idf = new Map<string, number>()
    for (const [word, count] of df) {
        idf.set(word, Math.log((N + 1) / (count + 1)) + 1)
    }
    return idf
}

// ── Page scoring ──────────────────────────────────────────────────────────────
export interface ScoredPage {
    page: IGuidePage
    rawHits: number
    score: number
}

export function scorePages(keywords: string[], pages: IGuidePage[], idf: Map<string, number>): ScoredPage[] {
    return pages.map((page) => {
        const stemmedWords = tokenize(page.text)
            .map(stem)
            .filter((w) => w.length > 2)
        const freq = new Map<string, number>()
        for (const w of stemmedWords) freq.set(w, (freq.get(w) ?? 0) + 1)

        let rawHits = 0,
            weightedScore = 0
        for (const kw of keywords) {
            const f = freq.get(kw) ?? 0
            if (f > 0) {
                rawHits += f
                weightedScore += f * (idf.get(kw) ?? 1)
            }
        }
        const normalizedScore = page.text.length > 0 ? (weightedScore / page.text.length) * 1000 : 0
        return { page, rawHits, score: normalizedScore }
    })
}

function selectPages(scored: ScoredPage[], minHits = MIN_RAW_HITS, cap = MAX_PAGES_PER_Q): { pages: IGuidePage[]; belowThreshold: boolean } {
    const qualifying = scored
        .filter((s) => s.rawHits >= minHits)
        .sort((a, b) => b.score - a.score)
        .slice(0, cap)
    // one qualifying page is sufficient; Gemini keyword fallback only fires when none qualify
    if (qualifying.length >= 1) return { pages: qualifying.map((s) => s.page), belowThreshold: false }
    const top2 = [...scored].sort((a, b) => b.score - a.score).slice(0, 2)
    return { pages: top2.map((s) => s.page), belowThreshold: true }
}

// ── Question segment parsing ──────────────────────────────────────────────────
function parseQuestionSegments(text: string): Array<{ qNum: number; text: string }> {
    const lines = text.split('\n')
    const starts: Array<{ qNum: number; line: number }> = []
    const Q_LINE = /^\s*(\d+)\s*[.:)]/
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(Q_LINE)
        if (m) starts.push({ qNum: parseInt(m[1], 10), line: i })
    }
    return starts.map((s, idx) => {
        const end = idx + 1 < starts.length ? starts[idx + 1].line : lines.length
        return { qNum: s.qNum, text: lines.slice(s.line, end).join('\n').trim() }
    })
}

// ── Context trimming ──────────────────────────────────────────────────────────
export interface QPages {
    qNum: number
    pages: IGuidePage[]
    scores: number[]
}

export function trimToContextBudget(qPages: QPages[], budget = CONTEXT_BUDGET_CHARS): QPages[] {
    let total = qPages.reduce((sum, q) => sum + q.pages.reduce((s, p) => s + p.text.length, 0), 0)
    while (total > budget) {
        let maxIdx = -1,
            maxLen = 1
        for (let i = 0; i < qPages.length; i++) {
            if (qPages[i].pages.length > maxLen) {
                maxLen = qPages[i].pages.length
                maxIdx = i
            }
        }
        if (maxIdx === -1) break
        const removed = qPages[maxIdx].pages.pop()!
        qPages[maxIdx].scores.pop()
        total -= removed.text.length
    }
    return qPages
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Strip student answer (after →) from a segment — used for keyword extraction
// and correct-answer lookup so student responses never influence either.
function questionOnly(segText: string): string {
    const idx = segText.indexOf('→')
    return idx === -1 ? segText : segText.slice(0, idx).trim()
}

// ── Gemini keyword fallback ───────────────────────────────────────────────────
async function geminiKeywordFallback(segments: Array<{ qNum: number; text: string }>): Promise<Record<string, string[]>> {
    const prompt = `Extract important keywords for finding relevant textbook pages for each question.
Return ONLY valid JSON: {"1":["keyword1","keyword2"],"2":["keyword3"]}

${segments.map((s) => `Question ${s.qNum}: ${questionOnly(s.text)}`).join('\n')}`.trim()
    try {
        const raw = await callGeminiWithBackoff(prompt)
        return parseKeywordMap(raw)
    } catch (err) {
        logger.warn?.('Gemini keyword fallback failed', { meta: { error: (err as Error).message } })
        return {}
    }
}

// ── Single-pass prompt: Gemini derives correct answers from guide and grades ───
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
- Do not use prior knowledge — if the reference pages do not clearly support an answer, note 'unverified against guide' in feedback
- Cover EVERY numbered question in the student paper — do not skip any
- The correctAnswer must come solely from the reference pages — never from what the student wrote
- The student's answer is after the →; copy it verbatim. If blank or missing, use "" and mark wrong
- Assign score: "correct", "partial", or "wrong". correct=1, partial=0.5, wrong=0
- One-sentence feedback for wrong/partial answers explaining what the guide says; "" if correct
- The student paper uses the format "[number]. [question text] [options] → [student answer]"
  "(blank)" means unanswered — mark wrong with empty studentAnswer

Respond with ONLY valid JSON — no markdown, no explanation:
{"totalScore":number,"maxScore":number,"questions":[{"number":number,"correctAnswer":string,"studentAnswer":string,"score":"correct"|"partial"|"wrong","feedback":string}]}`
}

// ── Main export ───────────────────────────────────────────────────────────────
export const gradeExamGuided = async (guidePages: IGuidePage[], studentPaperText: string): Promise<IGradingResult> => {
    if (guidePages.length === 0) throw new CustomError('No guide pages available for this test.', 422)

    const resolvedText = studentPaperText.trim() ? studentPaperText : '[BLANK PAPER — mark every question wrong with empty studentAnswer.]'

    const segments = parseQuestionSegments(resolvedText)
    if (segments.length === 0) {
        throw new CustomError('No numbered questions detected in the student paper — ensure questions are formatted as "1." or "1)"', 422)
    }
    const idf = computeIdf(guidePages)
    const qPages: QPages[] = []
    const fallbackNeeded: typeof segments = []

    for (const seg of segments) {
        // Use only the question text (before →) for keyword extraction so that
        // different student answers never affect which guide pages are selected.
        const keywords = extractLocalKeywords(questionOnly(seg.text))
        if (keywords.length < MIN_KEYWORDS) {
            fallbackNeeded.push(seg)
            qPages.push({ qNum: seg.qNum, pages: [], scores: [] })
            continue
        }
        const scored = scorePages(keywords, guidePages, idf)
        const { pages, belowThreshold } = selectPages(scored)
        if (belowThreshold) fallbackNeeded.push(seg)
        qPages.push({ qNum: seg.qNum, pages, scores: pages.map((p) => scored.find((s) => s.page === p)?.score ?? 0) })
    }

    if (fallbackNeeded.length > 0) {
        const kwMap = await geminiKeywordFallback(fallbackNeeded)
        for (const seg of fallbackNeeded) {
            const extras = kwMap[String(seg.qNum)] ?? []
            if (extras.length === 0) continue
            const scored = scorePages(extras.map(stem), guidePages, idf)
            const { pages } = selectPages(scored)
            const idx = qPages.findIndex((q) => q.qNum === seg.qNum)
            if (idx >= 0) {
                qPages[idx].pages = pages
                qPages[idx].scores = pages.map((p) => scored.find((s) => s.page === p)?.score ?? 0)
            }
        }
    }

    trimToContextBudget(qPages)

    const refByQ = new Map(qPages.map((q) => [q.qNum, q.pages]))

    const raw = await callGeminiWithBackoff(buildGuidedPrompt(resolvedText, refByQ))

    if (!raw.trim()) throw new CustomError('Grading service returned an empty response.', 503)

    const result = hardenGradingJson(raw)
    logger.info('Guided exam graded', { meta: { totalScore: result.totalScore, maxScore: result.maxScore, pages: guidePages.length } })
    return result
}
