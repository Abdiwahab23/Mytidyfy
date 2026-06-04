import base64
import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from dotenv import load_dotenv

import google.generativeai as genai

SUPPORTED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}

@dataclass
class ProcessedDocument:
    file_name: str
    category: str
    text: str
    extracted: dict[str, Any]
    status: str
    error: str | None = None

def _setup_gemini(api_key: str | None = None) -> bool:
    load_dotenv()
    key = api_key or os.getenv("GEMINI_API_KEY")
    if not key:
        return False
    genai.configure(api_key=key)
    return True

def upload_document(file_path: str, api_key: str | None = None) -> str:
    if not _setup_gemini(api_key):
        raise Exception("Gemini API key not configured")
        
    suffix = Path(file_path).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {suffix}")

    # Upload to Gemini File API
    # It returns a File object with a .name property used to reference it
    uploaded_file = genai.upload_file(path=file_path)
    return uploaded_file.name


def classify_and_extract(file_uri: str, requested_type: str = "general", api_key: str | None = None, custom_prompt: str = "") -> tuple[str, dict[str, Any], str, str]:
    if not _setup_gemini(api_key):
        raise Exception("Gemini API key not configured")

    extra_instructions = f"User explicitly asked to extract: {custom_prompt}\nMake sure to include all these custom fields in the 'extracted' JSON object." if custom_prompt else "If it's an Invoice, extract vendor, amount, date, description, currency. If Contract, extract parties, effective date. Otherwise, extract relevant fields."

    prompt = f"""
You are an advanced document processing engine. Please read the attached document carefully.
Classify it and extract structured data.

Requested document type: {requested_type}

{extra_instructions}

Return strict JSON only. Do not wrap in markdown or backticks.
Ensure every property name is enclosed in double quotes.
{{
  "category": "Invoice | Receipt | Contract | HR Document | Other",
  "suggestedFilename": "A clean, safe, descriptive filename with extension. Adapt to ANY document type.",
  "text": "Provide a brief text summary of the document contents here",
  "extracted": {{
    // Put all extracted fields here as key-value pairs
  }}
}}
"""
    try:
        from google.generativeai.types import HarmCategory, HarmBlockThreshold
        model = genai.GenerativeModel(
            'gemini-2.5-flash',
            generation_config={
                "response_mime_type": "application/json",
                "temperature": 0.1,
                "max_output_tokens": 4000
            },
            safety_settings={
                HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
                HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
                HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
                HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
            }
        )
        
        # Get the uploaded file object using the URI name
        uploaded_file = genai.get_file(file_uri)
        
        # Pass the file and the prompt to Gemini
        response = model.generate_content([uploaded_file, prompt])
        
        raw_text = response.text or ""
        raw_text = raw_text.strip()
        
        if not raw_text:
            return "Other", {}, ""
            
        if raw_text.startswith("```json"):
            raw_text = raw_text[7:]
        elif raw_text.startswith("```"):
            raw_text = raw_text[3:]
        if raw_text.endswith("```"):
            raw_text = raw_text[:-3]
        raw_text = raw_text.strip()
        
        payload = json.loads(raw_text)
        category = str(payload.get("category", "Other")).strip()
        suggested_filename = str(payload.get("suggestedFilename", "")).strip()
        extracted = payload.get("extracted", {})
        summary_text = payload.get("text", "")
        
        return category, extracted, summary_text, suggested_filename
    except Exception as e:
        print(f"Extraction error: {e}")
        raise e


def build_excel_base64(results: list[dict[str, Any]]) -> str:
    import pandas as pd

    rows = []
    # Collect all unique keys from extracted data
    all_keys = set()
    for item in results:
        extracted = item.get("extracted") or {}
        all_keys.update(extracted.keys())

    for item in results:
        extracted = item.get("extracted") or {}
        row = {
            "fileName": item.get("fileName") or item.get("filename"),
            "category": item.get("category"),
            "status": item.get("status", "done"),
        }
        for k in all_keys:
            if k not in ["documentType", "fields"]:
                row[k] = extracted.get(k, "")
        rows.append(row)

    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
        path = tmp.name

    try:
        pd.DataFrame(rows).to_excel(path, index=False)
        return base64.b64encode(Path(path).read_bytes()).decode("utf-8")
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
