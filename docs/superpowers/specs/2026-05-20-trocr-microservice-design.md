# TrOCR Microservice Design

**Date:** 2026-05-20
**Branch:** feature/ocr-extract

---

## Problem

Tesseract is trained on printed text and cannot reliably read handwriting — both block print and cursive. Confidence scores of 20–60% are typical even with optimal preprocessing. A model trained specifically on handwriting is required.

---

## Solution

Replace the Tesseract OCR engine with Microsoft's `trocr-large-handwritten` model, served as a local Python HTTP microservice. The Node.js backend calls it via HTTP instead of running Tesseract workers directly.

---

## Architecture

```
[Frontend :3001]
      ↓
[Node.js backend :3000]
      ↓  POST http://localhost:5001/extract  (multipart, field: "image")
[TrOCR Python service :5001]
      ↓
[microsoft/trocr-large-handwritten on GPU]
```

Two processes run side by side. The Python service loads the model once at startup (~5–10s) and holds it in GPU memory. Each OCR call is a single GPU inference pass.

---

## Part 1: Python Microservice

### Location

```
trocr/
├── requirements.txt
└── trocr_service.py
```

### API

**`POST /extract`**
- Body: `multipart/form-data`, field `image` (JPEG, PNG, WEBP, TIFF)
- Response 200:
  ```json
  { "text": "Hello world", "confidence": 87, "processingTimeMs": 420 }
  ```
- Response 422: `{ "error": "No image provided" }`
- Response 500: `{ "error": "<message>" }`

### Confidence Score

Computed from the model's generation probabilities: geometric mean of per-token softmax scores, scaled to 0–100. Higher values indicate the model was consistently certain about each character. This is meaningful and comparable to what Tesseract reported.

### Model

`microsoft/trocr-large-handwritten` — encoder-decoder transformer trained on IAM and IMGUR5K handwriting datasets. Handles both block print and cursive. Downloaded automatically via Hugging Face on first run (~1.5 GB, cached in `~/.cache/huggingface`).

### Dependencies (`trocr/requirements.txt`)

```
flask
transformers
torch
torchvision
Pillow
accelerate
```

### Starting the service

```bash
cd trocr
pip install -r requirements.txt   # once
python trocr_service.py            # model downloads on first run, then serves on :5001
```

---

## Part 2: Node.js Changes

### Modified files

| File | Change |
|---|---|
| `src/services/ocr.ts` | Replace 8-pipeline Tesseract logic with single `fetch` to `:5001/extract`. Keep `IOcrResult` shape. `pipeline` field is always `'trocr'`. `extractBatch` unchanged. |
| `src/bootstrap/index.ts` | Remove `initPool()` call |
| `src/bin/server.ts` | Remove `shutdownPool` import and signal handlers |
| `src/__tests__/ocr/ocr-pipelines.spec.ts` | Replace pool mock with `fetch` mock; test correct call, 503, and network failure |

### Deleted files

| File | Reason |
|---|---|
| `src/services/ocr-pool.ts` | TrOCR manages its own GPU context; no Node.js worker pool needed |

### Unchanged files

- `src/APIs/ocr/ocr.controller.ts`
- `src/APIs/ocr/index.ts`
- All frontend code
- Batch endpoint behaviour

### Error handling

| Condition | HTTP response |
|---|---|
| TrOCR service unreachable | 503 `"OCR service unavailable"` |
| TrOCR service returns 422 | 422 forwarded |
| TrOCR service returns 500 | 500 `"Extraction failed"` |

---

## Out of Scope

- Running TrOCR as a managed background process (user starts it manually)
- Multi-language handwriting support
- PDF ingestion
- Streaming results for large batches
