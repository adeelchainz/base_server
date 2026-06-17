# TrOCR Microservice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Tesseract OCR engine with Microsoft's `trocr-large-handwritten` model served as a local Python microservice, giving dramatically better handwriting recognition for both print and cursive.

**Architecture:** A Flask Python server at `:5001` loads the TrOCR model once at startup and keeps it on GPU. The Node.js backend replaces all Tesseract/pool logic with a single `fetch` call to that service. The frontend and batch endpoint are unchanged.

**Tech Stack:** Python 3.10+, Flask, Hugging Face Transformers, PyTorch (GPU), Node.js/Express/TypeScript

---

## File Map

### New files
| File | Purpose |
|---|---|
| `trocr/requirements.txt` | Python dependencies |
| `trocr/trocr_service.py` | Flask server wrapping TrOCR model |

### Modified files
| File | Change |
|---|---|
| `src/services/ocr.ts` | Replace all Tesseract/pool/sharp logic with single `fetch` to TrOCR |
| `src/bootstrap/index.ts` | Remove `initPool()` |
| `src/bin/server.ts` | Remove `shutdownPool` import and SIGTERM/SIGINT handlers |
| `src/__tests__/ocr/ocr-pipelines.spec.ts` | Replace pool mock with `global.fetch` mock |
| `.env.example` | Add `TROCR_URL` |
| `.gitignore` | Add Python cache files |

### Deleted files
| File | Reason |
|---|---|
| `src/services/ocr-pool.ts` | TrOCR manages its own GPU context |

---

## Task 1: Create the Python microservice

**Files:**
- Create: `trocr/requirements.txt`
- Create: `trocr/trocr_service.py`

- [ ] **Step 1: Create `trocr/requirements.txt`**

```
flask
transformers
torch
torchvision
Pillow
accelerate
```

> **GPU note:** The above installs CPU PyTorch by default. For GPU support (strongly recommended), first install PyTorch with your CUDA version from https://pytorch.org/get-started/locally — e.g. for CUDA 12.1:
> `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121`
> Then run `pip install flask transformers Pillow accelerate` separately.

- [ ] **Step 2: Create `trocr/trocr_service.py`**

```python
import io
import math
import time

import torch
import torch.nn.functional as F
from flask import Flask, jsonify, request
from PIL import Image
from transformers import TrOCRProcessor, VisionEncoderDecoderModel

app = Flask(__name__)

DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f'Loading TrOCR model on {DEVICE}...')

processor = TrOCRProcessor.from_pretrained('microsoft/trocr-large-handwritten')
model = VisionEncoderDecoderModel.from_pretrained('microsoft/trocr-large-handwritten').to(DEVICE)
model.eval()

print('Model ready.')


def compute_confidence(scores) -> int:
    if not scores:
        return 0
    probs = [F.softmax(s, dim=-1).max(dim=-1).values.item() for s in scores]
    return int(math.exp(sum(math.log(max(p, 1e-9)) for p in probs) / len(probs)) * 100)


@app.route('/extract', methods=['POST'])
def extract():
    start = time.time()

    file = request.files.get('image')
    if not file:
        return jsonify({'error': 'No image provided'}), 422

    try:
        image = Image.open(io.BytesIO(file.read())).convert('RGB')
    except Exception as e:
        return jsonify({'error': f'Invalid image: {e}'}), 422

    pixel_values = processor(images=image, return_tensors='pt').pixel_values.to(DEVICE)

    with torch.no_grad():
        outputs = model.generate(
            pixel_values,
            return_dict_in_generate=True,
            output_scores=True,
            max_new_tokens=128
        )

    text = processor.batch_decode(outputs.sequences, skip_special_tokens=True)[0]
    confidence = compute_confidence(outputs.scores)
    processing_time_ms = int((time.time() - start) * 1000)

    return jsonify({
        'text': text,
        'confidence': confidence,
        'processingTimeMs': processing_time_ms
    })


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5001, threaded=True)
```

- [ ] **Step 3: Add Python cache files to `.gitignore`**

Open `.gitignore` and add at the end:
```
# Python
trocr/__pycache__/
trocr/*.pyc
```

- [ ] **Step 4: Install Python dependencies**

```bash
cd trocr
pip install flask transformers Pillow accelerate
# GPU PyTorch (adjust CUDA version as needed — check yours with: nvidia-smi)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

- [ ] **Step 5: Start the service and verify it responds**

```bash
python trocr_service.py
```

Expected output (after model download, first run only):
```
Loading TrOCR model on cuda...
Model ready.
 * Running on http://127.0.0.1:5001
```

- [ ] **Step 6: Test the endpoint with curl**

```bash
curl -s -X POST http://localhost:5001/extract \
  -F "image=@C:/Windows/Web/Screen/img100.jpg" | python -m json.tool
```

Expected: JSON with `text`, `confidence`, `processingTimeMs` fields.

- [ ] **Step 7: Commit the Python service**

```bash
git add trocr/ .gitignore
git commit -m "feat: add TrOCR Python microservice"
```

---

## Task 2: Write failing Node.js tests for the new `ocr.ts`

**Files:**
- Modify: `src/__tests__/ocr/ocr-pipelines.spec.ts`

- [ ] **Step 1: Replace the entire test file**

```typescript
// src/__tests__/ocr/ocr-pipelines.spec.ts
import { extractText, IOcrResult } from '../../services/ocr'

jest.mock('../../handlers/logger', () => ({
    default: { info: jest.fn(), error: jest.fn() }
}))

describe('extractText', () => {
    const fakeBuffer = Buffer.from('fake-image')
    const mockFetch = jest.fn()

    beforeEach(() => {
        global.fetch = mockFetch as typeof global.fetch
    })

    afterEach(() => jest.clearAllMocks())

    it('calls the TrOCR service and returns the result', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ text: 'Hello world', confidence: 87, processingTimeMs: 420 })
        })

        const result: IOcrResult = await extractText(fakeBuffer)

        expect(result.text).toBe('Hello world')
        expect(result.confidence).toBe(87)
        expect(result.processingTimeMs).toBe(420)
        expect(result.pipeline).toBe('trocr')
        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:5001/extract',
            expect.objectContaining({ method: 'POST' })
        )
    })

    it('throws 503 when the TrOCR service is unreachable', async () => {
        mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))

        await expect(extractText(fakeBuffer)).rejects.toMatchObject({
            message: 'OCR service unavailable',
            statusCode: 503
        })
    })

    it('throws 500 when the TrOCR service returns an error response', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

        await expect(extractText(fakeBuffer)).rejects.toMatchObject({
            statusCode: 500
        })
    })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

```
npx jest src/__tests__/ocr/ocr-pipelines.spec.ts --no-coverage
```

Expected: 3 failures — `ocr.ts` still uses Tesseract/pool so the behavior doesn't match.

---

## Task 3: Refactor `ocr.ts` to call the TrOCR service

**Files:**
- Modify: `src/services/ocr.ts`

- [ ] **Step 1: Replace the entire file**

```typescript
// src/services/ocr.ts
import { CustomError } from '../utils/errors'

// require() bypasses ts-jest's __importDefault wrapping, which double-nests
// the default export when the Jest mock factory omits __esModule:true.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const logger = (require('../handlers/logger') as { default: typeof import('../handlers/logger').default }).default

const TROCR_URL = process.env.TROCR_URL ?? 'http://localhost:5001'

export interface IOcrResult {
    text: string
    confidence: number
    processingTimeMs: number
    pipeline: string
}

export interface IOcrBatchItem extends IOcrResult {
    originalname: string
    index: number
}

export const extractText = async (imageBuffer: Buffer): Promise<IOcrResult> => {
    const form = new FormData()
    form.append('image', new Blob([imageBuffer]), 'image.bin')

    let response: Response
    try {
        response = await fetch(`${TROCR_URL}/extract`, { method: 'POST', body: form })
    } catch {
        throw new CustomError('OCR service unavailable', 503)
    }

    if (response.status === 422) {
        throw new CustomError('No image provided', 422)
    }

    if (!response.ok) {
        throw new CustomError('Extraction failed', 500)
    }

    const data = (await response.json()) as { text: string; confidence: number; processingTimeMs: number }

    logger.info('OCR extraction complete', {
        meta: { confidence: data.confidence, pipeline: 'trocr', processingTimeMs: data.processingTimeMs }
    })

    return {
        text: data.text,
        confidence: data.confidence,
        processingTimeMs: data.processingTimeMs,
        pipeline: 'trocr'
    }
}

// Runs all files concurrently — throttled naturally by the TrOCR service's GPU.
export const extractBatch = async (
    files: Array<{ buffer: Buffer; originalname: string }>
): Promise<IOcrBatchItem[]> => {
    const results = await Promise.all(
        files.map(async ({ buffer, originalname }, index) => {
            const result = await extractText(buffer)
            return { ...result, originalname, index }
        })
    )
    return results.sort((a, b) => a.index - b.index)
}
```

- [ ] **Step 2: Run the OCR tests and confirm they pass**

```
npx jest src/__tests__/ocr/ocr-pipelines.spec.ts --no-coverage
```

Expected: 3 tests pass.

- [ ] **Step 3: Run the full test suite to check for regressions**

```
npm test
```

Expected: 13/13 pass (the auth tests should still pass; OCR tests pass with new mocks).

---

## Task 4: Remove pool infrastructure

**Files:**
- Delete: `src/services/ocr-pool.ts`
- Modify: `src/bootstrap/index.ts`
- Modify: `src/bin/server.ts`
- Modify: `.env.example`

- [ ] **Step 1: Delete `src/services/ocr-pool.ts`**

```bash
rm src/services/ocr-pool.ts
```

- [ ] **Step 2: Replace `src/bootstrap/index.ts`**

```typescript
// src/bootstrap/index.ts
import { initRateLimiter } from '../config/rate-limiter'
import logger from '../handlers/logger'
import database from '../services/database'

export async function bootstrap(): Promise<void> {
    try {
        const connection = await database.connect()
        logger.info(`Database connection established`, {
            meta: { CONNECTION_NAME: connection.name }
        })

        initRateLimiter(connection)
        logger.info(`Rate limiter initiated`)
    } catch (error) {
        logger.error(`Error during bootstrap:`, { meta: error })
        throw error
    }
}
```

- [ ] **Step 3: Replace `src/bin/server.ts`**

```typescript
// src/bin/server.ts
import app from '../app'
import { bootstrap } from '../bootstrap'
import config from '../config/config'
import logger from '../handlers/logger'

const server = app.listen(config.PORT)

void (async () => {
    try {
        await bootstrap().then(() => {
            logger.info(`Application started on port ${config.PORT}`, {
                meta: { SERVER_URL: config.SERVER_URL }
            })
        })
    } catch (error) {
        logger.error(`Error starting server:`, { meta: error })
        server.close((err) => {
            if (err) logger.error(`error`, { meta: error })
            process.exit(1)
        })
    }
})()
```

- [ ] **Step 4: Add `TROCR_URL` to `.env.example`**

Add at the end of `.env.example`:
```
# TrOCR microservice (start with: cd trocr && python trocr_service.py)
TROCR_URL=http://localhost:5001
```

- [ ] **Step 5: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Run full test suite one final time**

```
npm test
```

Expected: 13/13 pass.

- [ ] **Step 7: Commit**

```bash
git add src/services/ocr.ts src/bootstrap/index.ts src/bin/server.ts \
        src/__tests__/ocr/ocr-pipelines.spec.ts .env.example
git rm src/services/ocr-pool.ts
git commit -m "feat: replace Tesseract with TrOCR microservice"
```

---

## Task 5: End-to-end test

- [ ] **Step 1: Start the TrOCR service** (in a separate terminal)

```bash
cd trocr && python trocr_service.py
```

Wait for `Model ready.`

- [ ] **Step 2: Start the Node.js backend** (in a separate terminal)

```bash
npm run start:dev
```

- [ ] **Step 3: Start the frontend** (in a separate terminal)

```bash
cd frontend && npm run dev
```

- [ ] **Step 4: Upload a handwritten image at `http://localhost:3001`**

Verify:
- Text is extracted and readable
- `pipeline` badge shows `trocr`
- Confidence is higher than the previous Tesseract results

- [ ] **Step 5: Test the batch endpoint with two images**

Drop two images at once. Verify both results appear in order with filenames shown.

- [ ] **Step 6: Test error handling — stop the TrOCR service and upload an image**

```bash
# Stop the Python service (Ctrl+C in its terminal)
```

Upload an image in the browser. Expected: error message `"Extraction failed — try a clearer image"` (the 503 maps to the 500 error message bucket).
