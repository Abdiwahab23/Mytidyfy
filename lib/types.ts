export type DocumentType = "invoice" | "receipt" | "contract" | "general";

export type ProcessingOptions = {
  ocr: boolean;
  llm: boolean;
  rename: boolean;
  documentType: DocumentType;
  customPrompt?: string;
};

export type JobFile = {
  id: string;
  file: File;
  relativePath: string;
  status: "queued" | "uploading" | "ocr" | "llm" | "saving" | "done" | "failed";
  category?: string;
  suggestedFilename?: string;
  extracted?: Record<string, unknown>;
  text?: string;
  error?: string;
};

export type Job = {
  id: string;
  createdAt: string;
  status: "draft" | "processing" | "completed" | "failed";
  files: JobFile[];
  logs: string[];
  progress: number;
};

export type JobHistoryItem = {
  id: string;
  createdAt: string;
  status: "completed" | "failed";
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
  mode?: "classify" | "rename" | "extract";
  categories?: Record<string, number>;
};
