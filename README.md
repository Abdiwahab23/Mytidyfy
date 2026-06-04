# AI Document Batch Processor

A local web app for batch OCR, LLM document classification, structured extraction, and categorized output export.

## Run

Install frontend dependencies:

```powershell
npm install
```

Install backend dependencies:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Install the OCR engine after the core API is working:

```powershell
pip install -r requirements-ocr.txt
```

Python 3.11 or 3.12 is recommended for the OCR backend because Doctr/Torch wheels may not be available yet for newer Python releases.

Create `.env.local` for Next.js and set `NEXT_PUBLIC_PROCESSOR_API=http://127.0.0.1:8000`.

Set your OpenAI key for the backend:

```powershell
$env:OPENAI_API_KEY="your_key_here"
```

Start the backend:

```powershell
uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend:

```powershell
npm run dev
```

Open `http://localhost:3000`.
