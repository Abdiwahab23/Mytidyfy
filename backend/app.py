from dataclasses import asdict
from typing import Annotated

from fastapi import FastAPI, File, Form, Header, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .processor import build_excel_base64
from .database import init_db, save_extracted_data, get_all_extracted_data, save_job_history, get_job_history

app = FastAPI(title="AI Document Batch Processor API", lifespan=None)

@app.on_event("startup")
def on_startup():
    init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ExcelRequest(BaseModel):
    results: list[dict]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/process-file")
async def process_file(
    file: Annotated[UploadFile, File()],
    document_type: Annotated[str, Form()] = "general",
    custom_prompt: Annotated[str, Form()] = "",
    x_gemini_api_key: Annotated[str | None, Header()] = None,
    x_user_id: Annotated[str | None, Header()] = "anonymous"
):
    import asyncio
    import json
    import tempfile
    import os
    from pathlib import Path
    from fastapi.responses import StreamingResponse
    
    content = await file.read()
    
    async def process_generator():
        api_key_to_use = x_gemini_api_key
        suffix = Path(file.filename or "").suffix.lower()
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
            
        try:
            yield json.dumps({"status": "uploading"}) + "\n"
            
            loop = asyncio.get_event_loop()
            from .processor import upload_document
            try:
                # We reuse the 'ocr' status step in UI to represent uploading to Gemini
                yield json.dumps({"status": "ocr"}) + "\n"
                file_uri = await loop.run_in_executor(None, upload_document, tmp_path, api_key_to_use)
            except Exception as exc:
                if api_key_to_use:
                    yield json.dumps({"status": "warn", "message": "Invalid/expired API key provided. Falling back to system default key."}) + "\n"
                    try:
                        file_uri = await loop.run_in_executor(None, upload_document, tmp_path, None)
                        api_key_to_use = None # Clear it so we don't try again in extraction
                    except Exception as exc2:
                        yield json.dumps({"status": "failed", "error": str(exc2), "fileName": file.filename}) + "\n"
                        return
                else:
                    yield json.dumps({"status": "failed", "error": str(exc), "fileName": file.filename}) + "\n"
                    return
                
            yield json.dumps({"status": "llm", "text": "Analyzing document structure with Gemini..."}) + "\n"
            
            from .processor import classify_and_extract
            try:
                category, extracted, summary_text, suggested_filename = await loop.run_in_executor(None, classify_and_extract, file_uri, document_type, api_key_to_use, custom_prompt)
                if extracted:
                    save_extracted_data(x_user_id, file.filename, category, extracted)
                yield json.dumps({"status": "done", "category": category, "extracted": extracted, "text": summary_text, "suggestedFilename": suggested_filename, "fileName": file.filename}) + "\n"
            except Exception as exc:
                if api_key_to_use:
                    yield json.dumps({"status": "warn", "message": "Invalid/expired API key provided. Falling back to system default key."}) + "\n"
                    try:
                        category, extracted, summary_text, suggested_filename = await loop.run_in_executor(None, classify_and_extract, file_uri, document_type, None, custom_prompt)
                        if extracted:
                            save_extracted_data(x_user_id, file.filename, category, extracted)
                        yield json.dumps({"status": "done", "category": category, "extracted": extracted, "text": summary_text, "suggestedFilename": suggested_filename, "fileName": file.filename}) + "\n"
                    except Exception as exc2:
                        yield json.dumps({"status": "failed", "error": str(exc2), "fileName": file.filename}) + "\n"
                        return
                else:
                    yield json.dumps({"status": "failed", "error": str(exc), "fileName": file.filename}) + "\n"
                    return
                
        except Exception as e:
            yield json.dumps({"status": "failed", "error": str(e), "fileName": file.filename}) + "\n"
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    return StreamingResponse(process_generator(), media_type="application/x-ndjson")


@app.post("/export/excel")
def export_excel(payload: ExcelRequest):
    return {"fileName": "processed_results.xlsx", "contentBase64": build_excel_base64(payload.results)}

@app.get("/history")
def get_history(x_user_id: Annotated[str | None, Header()] = "anonymous"):
    return {"history": get_all_extracted_data(x_user_id)}

class JobHistoryRequest(BaseModel):
    job_id: str
    history_data: list

@app.post("/job-history")
def save_user_job_history(
    payload: JobHistoryRequest,
    x_user_id: Annotated[str | None, Header()] = "anonymous"
):
    save_job_history(x_user_id, payload.job_id, payload.history_data)
    return {"status": "ok"}

@app.get("/job-history")
def get_user_job_history(x_user_id: Annotated[str | None, Header()] = "anonymous"):
    return {"history_data": get_job_history(x_user_id)}

@app.get('/admin/stats')
def admin_stats():
    from .database import get_admin_stats
    return get_admin_stats()

