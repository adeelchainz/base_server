import io
import os
import re
import sys
import time

# Force UTF-8 output on Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

import numpy as np
import fitz  # PyMuPDF
import pytesseract
from google import genai
from google.genai import types as genai_types
from flask import Flask, jsonify, request
from PIL import Image, ImageFilter, ImageEnhance

TESSERACT_CMD = os.environ.get('TESSERACT_CMD', r'C:\Program Files\Tesseract-OCR\tesseract.exe')
pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
GEMINI_MODEL = os.environ.get('GEMINI_MODEL', 'models/gemini-flash-lite-latest')

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

if GEMINI_API_KEY:
    gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    print(f'Gemini ready: {GEMINI_MODEL}')
else:
    gemini_client = None
    print('WARNING: GEMINI_API_KEY not set — handwritten mode will fail')

app = Flask(__name__)


# ── Blank page detection ──────────────────────────────────────────────────────

# A blank page has almost no dark pixels — just sensor noise (~0.05%).
# A page with any ink/handwriting will have well above 0.5% dark pixels.
BLANK_DARK_PIXEL_RATIO = 0.005  # 0.5%
BLANK_PIXEL_THRESHOLD = 140     # pixel value < this is considered "dark"

def is_blank(pil_image: Image.Image) -> bool:
    gray = np.array(pil_image.convert('L'))
    dark_ratio = (gray < BLANK_PIXEL_THRESHOLD).sum() / gray.size
    return dark_ratio < BLANK_DARK_PIXEL_RATIO


# ── Stage 1: Preprocessing ────────────────────────────────────────────────────

def preprocess(pil_image: Image.Image) -> Image.Image:
    img = pil_image.convert('L')
    # Pad all sides so edge content is never clipped by Tesseract or vision models.
    # Bottom gets extra padding because exam answers often run to the last line.
    pad_h = max(40, img.height // 15)
    pad_w = max(40, img.width // 15)
    padded = Image.new('L', (img.width + pad_w * 2, img.height + pad_h * 2 + pad_h), 255)
    padded.paste(img, (pad_w, pad_h))
    img = ImageEnhance.Contrast(padded).enhance(2.0)
    img = img.filter(ImageFilter.SHARPEN)
    return img


# ── Stage 3: Post-processing ──────────────────────────────────────────────────

_PREAMBLE = re.compile(
    r'^(the\s+text\s+(in\s+the\s+(image|photo)\s+)?(reads|says|is|states)\s*[:\-]?\s*'
    r'|here\s+is\s+the\s+(transcribed\s+)?text\s*[:\-]?\s*'
    r'|transcription\s*[:\-]?\s*)',
    re.IGNORECASE,
)
_SUFFIX = re.compile(
    r'\n\n(there\s+is\s+no\s+other\s+(visible\s+)?text.*|note\s*:.*)$',
    re.IGNORECASE,
)
# Catch Gemini describing a blank image instead of returning empty.
_BLANK_RESPONSE = re.compile(
    r'^(the\s+image\s+(appears?\s+)?blank'
    r'|no\s+(handwritten\s+)?(text|writing)\s+(is\s+)?(visible|present|found)'
    r'|there\s+is\s+no\s+(handwritten\s+)?text'
    r'|i\s+(do\s+not|don\'t|can\'t|cannot)\s+see\s+any\s+(handwritten\s+)?text'
    r'|blank\s+(page|image|sheet)'
    r'|the\s+page\s+is\s+blank'
    r'|empty\s+(string|page|image))\s*\.?$',
    re.IGNORECASE,
)

def postprocess(text: str) -> str:
    cleaned = _PREAMBLE.sub('', text.strip()).strip()
    cleaned = _SUFFIX.sub('', cleaned).strip()
    if _BLANK_RESPONSE.match(cleaned):
        return ''
    return cleaned


# ── Helpers ───────────────────────────────────────────────────────────────────

def pdf_to_images(pdf_bytes: bytes) -> list:
    doc = fitz.open(stream=pdf_bytes, filetype='pdf')
    images = []
    for page in doc:
        pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
        images.append(Image.frombytes('RGB', [pix.width, pix.height], pix.samples))
    doc.close()
    return images


# ── Stage 2: Recognition ──────────────────────────────────────────────────────

def ocr_printed(pil_image: Image.Image, student_paper: bool = False) -> tuple[str, int]:
    if is_blank(pil_image):
        return '', 0

    # Student papers in printed mode: use Gemini vision to detect which answers
    # the student actually marked. Tesseract reads all pre-printed choices and
    # cannot tell which one was circled — only a vision model can.
    if student_paper:
        img_bytes = _prepare_image_bytes(pil_image)
        result = _extract_printed_marks(img_bytes)
        if result is not None:
            return result, 95

    pre = preprocess(pil_image)
    # PSM 3 (auto) is more robust than PSM 4 for exam pages with varying layouts.
    text = pytesseract.image_to_string(pre, config='--psm 3').strip()
    # Parse confidence from TSV output — avoids pandas dependency
    tsv = pytesseract.image_to_data(pre, config='--psm 3', output_type=pytesseract.Output.STRING)
    confs = []
    for line in tsv.splitlines()[1:]:  # skip header
        parts = line.split('\t')
        if len(parts) >= 11:
            try:
                c = int(parts[10])
                if c >= 0:
                    confs.append(c)
            except ValueError:
                pass
    confidence = int(sum(confs) / len(confs)) if confs else 90
    return text, confidence


GEMINI_MAX_DIM = 2048

def _prepare_image_bytes(pil_image: Image.Image) -> bytes:
    """Preprocess and resize to Gemini's optimal window, return JPEG bytes."""
    pre = preprocess(pil_image).convert('RGB')
    if pre.width > GEMINI_MAX_DIM or pre.height > GEMINI_MAX_DIM:
        pre.thumbnail((GEMINI_MAX_DIM, GEMINI_MAX_DIM), Image.LANCZOS)
    buf = io.BytesIO()
    pre.save(buf, format='JPEG', quality=95)
    return buf.getvalue()


_TRANSIENT_SIGNALS = ('UNAVAILABLE', 'RESOURCE_EXHAUSTED', '429', '503')
_MAX_RETRIES = 3


def _gemini_call(contents: list) -> object:
    """Call Gemini with exponential backoff on transient 503/429 errors."""
    for attempt in range(_MAX_RETRIES):
        try:
            return gemini_client.models.generate_content(model=GEMINI_MODEL, contents=contents)
        except Exception as e:
            err_str = str(e)
            is_transient = any(sig in err_str for sig in _TRANSIENT_SIGNALS)
            if is_transient and attempt < _MAX_RETRIES - 1:
                time.sleep(2 ** attempt)
                continue
            raise


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

def _extract_printed_marks(img_bytes: bytes) -> str | None:
    """Use Gemini vision to detect which answers the student marked on a printed exam.
    Returns extracted text or None if Gemini is unavailable/quota exceeded."""
    if not gemini_client:
        return None
    try:
        response = _gemini_call([
            genai_types.Part.from_text(text=_PRINTED_MARK_PROMPT),
            genai_types.Part.from_bytes(data=img_bytes, mime_type='image/jpeg'),
        ])
        return postprocess(response.text)
    except Exception:
        return None  # fall through to Tesseract


def _gemini_extract(img_bytes: bytes) -> str:
    """Send one image crop to Gemini and return postprocessed extracted text."""
    response = _gemini_call([
        genai_types.Part.from_text(text=HANDWRITING_PROMPT),
        genai_types.Part.from_bytes(data=img_bytes, mime_type='image/jpeg'),
    ])
    return postprocess(response.text)


_Q_NUM = re.compile(r'^\s*(\d+)\s*[.:\)]\s*', re.MULTILINE)

def _merge_tile_texts(top: str, bot: str) -> str:
    """Merge two tile extraction results without duplicating the overlap zone.

    Strategy: keep all of the top tile's output, then from the bottom tile only
    include lines that belong to questions numbered higher than the last question
    seen in the top tile.  This avoids per-line fuzzy matching entirely.
    """
    top_lines = [l.strip() for l in top.splitlines() if l.strip()]
    bot_lines = [l.strip() for l in bot.splitlines() if l.strip()]

    top_nums = [int(m.group(1)) for l in top_lines if (m := _Q_NUM.match(l))]

    if not top_nums:
        # No numbered questions — fall back to exact-line dedup
        seen = set(top_lines)
        extra = [l for l in bot_lines if l not in seen]
        return '\n'.join(top_lines + extra)

    cutoff = max(top_nums)

    # Take only lines from the bottom tile that start at a question > cutoff,
    # plus any continuation lines (non-numbered) that follow.
    bot_keep: list[str] = []
    taking = False
    for line in bot_lines:
        m = _Q_NUM.match(line)
        if m and int(m.group(1)) > cutoff:
            taking = True
        if taking:
            bot_keep.append(line)

    return '\n'.join(top_lines + bot_keep)


_TILED_PROMPT = (
    HANDWRITING_PROMPT +
    '\n\nThis exam paper is shown as two overlapping image halves (top half first, bottom half second). '
    'Treat them as one continuous page from top to bottom. '
    'Use the question numbers printed on the paper — do not re-number.'
)

def ocr_handwritten(pil_image: Image.Image, student_paper: bool = False) -> tuple[str, int]:
    if not gemini_client:
        raise RuntimeError('GEMINI_API_KEY not configured — add it to .env')

    if is_blank(pil_image):
        return '', 0

    w, h = pil_image.size
    if h > w:
        # Portrait page: send both halves in one Gemini call so it sees the full
        # context and never re-numbers or misses answers in either half.
        mid = h // 2
        overlap = h // 8
        top_tile = pil_image.crop((0, 0, w, mid + overlap))
        bot_tile = pil_image.crop((0, mid - overlap, w, h))
        response = _gemini_call([
            genai_types.Part.from_text(text=_TILED_PROMPT),
            genai_types.Part.from_bytes(data=_prepare_image_bytes(top_tile), mime_type='image/jpeg'),
            genai_types.Part.from_bytes(data=_prepare_image_bytes(bot_tile), mime_type='image/jpeg'),
        ])
        return postprocess(response.text), 95

    return _gemini_extract(_prepare_image_bytes(pil_image)), 95


# ── Route ─────────────────────────────────────────────────────────────────────

@app.route('/extract', methods=['POST'])
def extract():
    start = time.time()
    mode = request.form.get('mode', 'handwritten')
    student_paper = request.form.get('documentType', '') == 'student_paper'

    file = request.files.get('image')
    if not file:
        print(f'DEBUG /extract: files={list(request.files.keys())} form={list(request.form.keys())} ct={request.content_type!r}', flush=True)
        return jsonify({'error': 'No image provided'}), 422

    raw = file.read()
    is_pdf = (file.mimetype == 'application/pdf') or raw[:4] == b'%PDF'

    try:
        images = pdf_to_images(raw) if is_pdf else [Image.open(io.BytesIO(raw)).convert('RGB')]
    except Exception as e:
        print(f'DEBUG /extract parse error: {e!r} raw_len={len(raw)} is_pdf={is_pdf} first_bytes={raw[:8]!r}', flush=True)
        return jsonify({'error': f'Could not read file: {e}'}), 422

    try:
        texts, confs = [], []
        # Non-student documents (answer keys) are always printed — use Tesseract regardless of mode
        fn = (ocr_printed if mode == 'printed' else ocr_handwritten) if student_paper else ocr_printed
        for img in images:
            t, c = fn(img, student_paper=student_paper)
            if t:
                texts.append(t)
                confs.append(c)

        pipeline = 'tesseract' if mode == 'printed' else GEMINI_MODEL
        return jsonify({
            'text': '\n\n'.join(texts),
            'confidence': int(sum(confs) / len(confs)) if confs else 0,
            'processingTimeMs': int((time.time() - start) * 1000),
            'pipeline': pipeline,
        })

    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503
    except Exception as e:
        err_str = str(e)
        if 'UNAVAILABLE' in err_str or ('503' in err_str and 'high demand' in err_str):
            return jsonify({'error': 'Gemini is temporarily overloaded — please try again in a moment'}), 503
        if 'RESOURCE_EXHAUSTED' in err_str or '429' in err_str:
            return jsonify({'error': 'Gemini API quota exceeded — try again later or switch to printed mode'}), 503
        if 'PERMISSION_DENIED' in err_str or '403' in err_str or 'not allowed' in err_str.lower():
            return jsonify({'error': 'Gemini API key is invalid or lacks permission — check GEMINI_API_KEY in .env'}), 503
        if 'API_KEY_INVALID' in err_str or 'invalid api key' in err_str.lower():
            return jsonify({'error': 'Gemini API key is invalid — check GEMINI_API_KEY in .env'}), 503
        return jsonify({'error': f'Processing failed: {e}'}), 500


@app.route('/extract-guide', methods=['POST'])
def extract_guide():
    start = time.time()
    file = request.files.get('pdf')
    if not file:
        return jsonify({'error': 'No PDF provided'}), 422

    raw = file.read()
    filename = file.filename or 'guide.pdf'

    try:
        doc = fitz.open(stream=raw, filetype='pdf')
    except Exception as e:
        return jsonify({'error': f'Could not open PDF "{filename}": {e}'}), 422

    pages = []
    for page_num, page in enumerate(doc, start=1):
        text = page.get_text().strip()
        if len(text) < 50:
            # Scanned page fallback: render and run Tesseract
            try:
                pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
                pil_img = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
                text = pytesseract.image_to_string(preprocess(pil_img), config='--psm 3').strip()
            except Exception:
                text = ''
        pages.append({'pageNumber': page_num, 'text': text, 'source': filename})
    doc.close()

    readable_count = sum(1 for p in pages if p['text'])
    if readable_count == 0:
        return jsonify({'error': f'No readable text found in "{filename}"'}), 422

    return jsonify({
        'pages': pages,
        'pageCount': len(pages),
        'readableCount': readable_count,
        'processingTimeMs': int((time.time() - start) * 1000)
    })


_NAME_PROMPT = (
    'Look at this exam paper image. Find the student name field — it is usually near the top, '
    'labeled something like "Name:", "Student:", "Student Name:", "Nombre:", etc.\n'
    'Return ONLY the student\'s handwritten or typed name, exactly as written.\n'
    'If the name field is blank, not visible, or you cannot find one, return exactly: (blank)\n'
    'Output nothing else.'
)


@app.route('/detect-name', methods=['POST'])
def detect_name():
    if not gemini_client:
        return jsonify({'name': None}), 200

    file = request.files.get('image')
    if not file:
        return jsonify({'error': 'No image provided'}), 422

    raw = file.read()
    is_pdf = (file.mimetype == 'application/pdf') or raw[:4] == b'%PDF'

    try:
        if is_pdf:
            images = pdf_to_images(raw)
            pil_image = images[0] if images else None
        else:
            pil_image = Image.open(io.BytesIO(raw)).convert('RGB')
    except Exception as e:
        return jsonify({'error': f'Could not read file: {e}'}), 422

    if pil_image is None:
        return jsonify({'name': None}), 200

    try:
        img_bytes = _prepare_image_bytes(pil_image)
        response = _gemini_call([
            genai_types.Part.from_text(text=_NAME_PROMPT),
            genai_types.Part.from_bytes(data=img_bytes, mime_type='image/jpeg'),
        ])
        raw_name = (response.text or '').strip()
        name = None if not raw_name or raw_name.lower() in ('(blank)', 'blank') else raw_name
        return jsonify({'name': name}), 200
    except Exception:
        return jsonify({'name': None}), 200


if __name__ == '__main__':
    print('Checking Tesseract...')
    pytesseract.get_tesseract_version()
    print('Tesseract ready.')
    print('Service ready on :5001')
    app.run(host='127.0.0.1', port=5001, threaded=True)
