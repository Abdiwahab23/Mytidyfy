import type { JobFile, ProcessingOptions } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_PROCESSOR_API ?? "http://127.0.0.1:8000";

export async function processDocument(
  file: JobFile,
  options: ProcessingOptions,
  onProgress?: (status: JobFile["status"], data?: any) => void,
  apiKey?: string
) {
  const body = new FormData();
  body.append("file", file.file, file.file.name);
  body.append("document_type", options.documentType);
  if (options.customPrompt) {
    body.append("custom_prompt", options.customPrompt);
  }

  const headers: Record<string, string> = {};
  if (apiKey) headers["X-Gemini-Api-Key"] = apiKey;

  if (onProgress) onProgress("uploading");

  const response = await fetch(`${API_BASE}/process-file`, {
    method: "POST",
    headers,
    body
  });

  if (!response.ok) {
    throw new Error(`Processor failed: ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error("No response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        const data = JSON.parse(line);
        if (data.status === "failed") {
          throw new Error(data.error);
        }
        if (data.status === "done") {
          finalResult = data;
        } else if (onProgress) {
          onProgress(data.status, data);
        }
      }
    }
  }
  
  if (buffer.trim()) {
    const data = JSON.parse(buffer.trim());
    if (data.status === "failed") throw new Error(data.error);
    if (data.status === "done") finalResult = data;
  }

  return finalResult;
}

export async function buildExcel(results: unknown[]) {
  const response = await fetch(`${API_BASE}/export/excel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ results })
  });

  if (!response.ok) {
    throw new Error(`Excel export failed: ${response.statusText}`);
  }

  return response.json() as Promise<{ fileName: string; contentBase64: string }>;
}
