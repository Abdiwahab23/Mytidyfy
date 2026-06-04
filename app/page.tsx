"use client";

import {
  Archive,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  Eye,
  EyeOff,
  FileJson,
  FolderOpen,
  FileSignature,
  History,
  LayoutDashboard,
  Loader2,
  Monitor,
  Moon,
  Play,
  Save,
  Search,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  UploadCloud,
  XCircle,
  Menu,
  Shield,
  Users,
  Activity,
  MousePointerClick,
  Globe2,
  Filter,
  Calendar,
  UserCircle
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";

import { processDocument } from "@/lib/api";
import { SignInButton, UserButton, useUser, useClerk } from "@clerk/nextjs";
import type { Job, JobFile, JobHistoryItem, ProcessingOptions } from "@/lib/types";
import { base64ToBlob, cn, safeFolderName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from "recharts";

type NativeDirectoryHandle = {
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<NativeDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{ createWritable(): Promise<WritableStream> }>;
};

declare global {
  interface Window {
    showDirectoryPicker?: (options?: any) => Promise<NativeDirectoryHandle>;
  }
}

const defaultOptions: ProcessingOptions = {
  ocr: true,
  llm: true,
  rename: false,
  documentType: "general"
};

const HISTORY_KEY = "ai-document-processor-history";

function formatExtractedDataToHTML(data: any): string {
  if (!data || typeof data !== "object") return "";
  let html = `<div class="overflow-x-auto text-left max-h-[60vh] overflow-y-auto"><table class="w-full text-sm text-left border-collapse"><tbody>`;
  
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === "" || key === "documentType") continue;
    
    const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).replace(/_/g, " ");

    if (Array.isArray(value)) {
      html += `<tr class="border-b border-slate-200 dark:border-slate-700"><td class="py-3 px-3 font-medium text-slate-600 dark:text-slate-400 align-top w-1/3">${formattedKey}</td><td class="py-3 px-3">`;
      if (value.length > 0 && typeof value[0] === "object") {
        html += `<div class="overflow-x-auto"><table class="w-full text-xs border border-slate-200 dark:border-slate-700"><thead><tr class="bg-slate-50 dark:bg-slate-800">`;
        const subKeys = Object.keys(value[0]);
        for (const subKey of subKeys) {
           html += `<th class="p-2 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-left capitalize whitespace-nowrap">${subKey.replace(/_/g, " ")}</th>`;
        }
        html += `</tr></thead><tbody>`;
        for (const item of value) {
          html += `<tr>`;
          for (const subKey of subKeys) {
            html += `<td class="p-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 whitespace-nowrap">${(item as any)[subKey] || ""}</td>`;
          }
          html += `</tr>`;
        }
        html += `</tbody></table></div>`;
      } else {
        html += value.join(", ");
      }
      html += `</td></tr>`;
    } else if (typeof value === "object") {
       html += `<tr class="border-b border-slate-200 dark:border-slate-700"><td class="py-3 px-3 font-medium text-slate-600 dark:text-slate-400 align-top w-1/3">${formattedKey}</td><td class="p-0">`;
       html += formatExtractedDataToHTML(value);
       html += `</td></tr>`;
    } else {
      html += `<tr class="border-b border-slate-200 dark:border-slate-700"><td class="py-3 px-3 font-medium text-slate-600 dark:text-slate-400 w-1/3">${formattedKey}</td><td class="py-3 px-3 text-slate-900 dark:text-slate-100 font-medium">${value}</td></tr>`;
    }
  }
  html += `</tbody></table></div>`;
  return html;
}

export default function Home() {
  const [view, setView] = useState<"dashboard" | "new" | "rename" | "extract" | "processing" | "results" | "history" | "settings" | "success" | "admin" | "admin-login" | "analytics" | "users" | "admin-profile">("dashboard");
  const [job, setJob] = useState<Job>(() => createJob([]));
  const [options, setOptions] = useState<ProcessingOptions>(defaultOptions);
  const [selectedResult, setSelectedResult] = useState(0);
  const [outputHandle, setOutputHandle] = useState<NativeDirectoryHandle | null>(null);
  const [outputName, setOutputName] = useState("Not selected");
  const [inputName, setInputName] = useState("Not selected");
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState<JobHistoryItem[]>([]);
  const [theme, setTheme] = useState<"light" | "dark" | "system">("light");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [showApiCard, setShowApiCard] = useState(false);
  const [extractedHistory, setExtractedHistory] = useState<any[]>([]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminStats, setAdminStats] = useState<any>(null);
  const [trueAnalytics, setTrueAnalytics] = useState<any>({ page_views: 0, unique_ips: 0, button_clicks: 0, top_countries: [] });
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [analyticsTimeframe, setAnalyticsTimeframe] = useState<"today" | "yesterday" | "7days" | "30days">("today");
  const { isSignedIn, user } = useUser();
  const { openSignIn } = useClerk();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    if (view === "results" && user?.id) {
      fetch(`${process.env.NEXT_PUBLIC_PROCESSOR_API ?? "http://127.0.0.1:8000"}/history`, {
        headers: { "x-user-id": user.id }
      })
        .then(res => res.json())
        .then(data => {
           setExtractedHistory(data.history || []);
        })
        .catch(err => console.error("Failed to load history", err));
    }
    if (view === "admin") {
      fetch(`${process.env.NEXT_PUBLIC_PROCESSOR_API ?? "http://127.0.0.1:8000"}/admin/stats`)
        .then(res => res.json())
        .then(data => setAdminStats(data))
        .catch(err => console.error("Failed to load admin stats", err));
    }
    if (view === "analytics" && isAdmin) {
      fetch(`${process.env.NEXT_PUBLIC_PROCESSOR_API ?? "http://127.0.0.1:8000"}/analytics/stats_v2?timeframe=${analyticsTimeframe}`)
        .then(res => res.json())
        .then(data => setTrueAnalytics(data))
        .catch(err => console.error("Failed to load true analytics", err));
    }
    if ((view === "users" || view === "admin") && isAdmin) {
      fetch(`${process.env.NEXT_PUBLIC_PROCESSOR_API ?? "http://127.0.0.1:8000"}/admin/users`)
        .then(res => res.json())
        .then(data => setAdminUsers(data.users || []))
        .catch(err => console.error("Failed to load admin users", err));
    }
  }, [view, user?.id, isAdmin, analyticsTimeframe]);

  // Global Analytics Tracker
  useEffect(() => {
    let visitorData = { ip: "Unknown", country: "Unknown" };
    
    // Fetch IP and Country, then log page view
    fetch("https://ipapi.co/json/")
      .then(res => res.json())
      .then(data => {
        if (data.ip && data.country_name) {
          visitorData = { ip: data.ip, country: data.country_name };
        }
        return fetch(`${process.env.NEXT_PUBLIC_PROCESSOR_API ?? "http://127.0.0.1:8000"}/analytics`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_type: "page_view", ip_address: visitorData.ip, country: visitorData.country })
        });
      })
      .catch(() => console.log("Analytics blocked or failed."));

    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("button") || target.closest("a")) {
        fetch(`${process.env.NEXT_PUBLIC_PROCESSOR_API ?? "http://127.0.0.1:8000"}/analytics`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_type: "button_click", ip_address: visitorData.ip, country: visitorData.country })
        }).catch(() => {});
      }
    };
    
    document.addEventListener("click", handleGlobalClick);
    return () => document.removeEventListener("click", handleGlobalClick);
  }, []);

  function applyTheme(next: "light" | "dark" | "system") {
    setTheme(next);
    localStorage.setItem("ai-doc-theme", next);
    const isDark = next === "dark" || (next === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
  }

  const processed = job.files.filter((file) => file.status === "done").length;
  const failed = job.files.filter((file) => file.status === "failed").length;
  // Use totalFiles as fallback for old history items that may have processedFiles=0
  const completedHistory = history.reduce((sum, item) => sum + (item.processedFiles > 0 ? item.processedFiles : item.totalFiles), 0);
  const failedHistory = history.reduce((sum, item) => sum + item.failedFiles, 0);
  const totalJobs = history.length + (job.status !== "draft" && job.files.length ? 1 : 0);
  const totalProcessedFiles = completedHistory + processed;
  const totalFailedFiles = failedHistory + failed;
  const totalAttemptedFiles = totalProcessedFiles + totalFailedFiles;
  const successRate = totalAttemptedFiles ? Math.round((totalProcessedFiles / totalAttemptedFiles) * 100) : 0;
  const currentFile = job.files.find((file) => ["uploading", "ocr", "llm", "saving"].includes(file.status)) ?? job.files.find((file) => file.status === "queued");
  const selected = job.files[selectedResult];

  const allTimeCategories = useMemo(() => {
    const counts: Record<string, number> = {};
    history.forEach(item => {
      if (item.id === job.id) return;
      if (item.categories) {
        Object.entries(item.categories).forEach(([cat, count]) => {
          counts[cat] = (counts[cat] || 0) + count;
        });
      }
    });
    if (job.status !== "draft") {
      job.files.forEach(file => {
        if (file.status === "done" && file.category) {
          counts[file.category] = (counts[file.category] || 0) + 1;
        }
      });
    }
    return counts;
  }, [history, job]);

  const hasCategoryData = Object.keys(allTimeCategories).length > 0;

  const recentJobs = useMemo(
    () => {
      const active =
        job.status !== "draft" && job.files.length
          ? [{ id: job.id, files: job.files.length, status: titleCase(job.status), mode: options.rename ? "rename" : "classify" }]
          : [];
      return [
        ...active,
        ...history
          .filter((item) => !active.some((activeItem) => activeItem.id === item.id))
          .map((item) => ({
            id: item.id,
            files: item.totalFiles,
            status: titleCase(item.status),
            mode: item.mode
          }))
      ].slice(0, 5);
    },
    [history, job, options.rename]
  );

  useEffect(() => {
    try {
      const saved = (localStorage.getItem("ai-doc-theme") ?? "light") as "light" | "dark" | "system";
      setTheme(saved);
      setApiKey(localStorage.getItem("ai-doc-gemini-key") ?? "");
      const isAdminAuth = localStorage.getItem("adminAuth") === "true";
      setIsAdmin(isAdminAuth);
      if (isAdminAuth) setView("admin");
    } catch {}

    if (user?.id) {
      fetch(`${process.env.NEXT_PUBLIC_PROCESSOR_API ?? "http://127.0.0.1:8000"}/job-history`, {
        headers: { "x-user-id": user.id }
      })
      .then(res => res.json())
      .then(data => {
        if (data.history_data) {
          setHistory(data.history_data);
        }
      })
      .catch(() => setHistory([]));
    } else {
      setHistory([]);
    }
  }, [user?.id]);

  function saveHistory(nextHistory: JobHistoryItem[]) {
    setHistory(nextHistory);
    if (user?.id) {
      fetch(`${process.env.NEXT_PUBLIC_PROCESSOR_API ?? "http://127.0.0.1:8000"}/job-history`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": user.id
        },
        body: JSON.stringify({
          job_id: job.id || "default",
          history_data: nextHistory
        })
      }).catch(console.error);
    }
  }

  function onFilesSelected(files: FileList | null) {
    if (!isSignedIn) {
      Swal.fire({
        icon: "warning",
        title: "Authentication Required",
        text: "Please sign in to process documents.",
        showCancelButton: true,
        confirmButtonText: "Sign In to Continue",
        cancelButtonText: "Cancel",
        buttonsStyling: false,
        customClass: {
          popup: "rounded-2xl border border-slate-100 shadow-2xl dark:bg-slate-900 dark:border-slate-800",
          title: "text-xl font-bold text-slate-900 dark:text-white pt-4",
          htmlContainer: "text-slate-600 dark:text-slate-400 font-medium pb-4",
          actions: "flex gap-3",
          confirmButton: "bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg transition-all shadow-sm",
          cancelButton: "bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2.5 px-6 rounded-lg transition-all dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        }
      }).then((result) => {
        if (result.isConfirmed) {
          openSignIn();
        }
      });
      return;
    }
    if (!files) return;
    const accepted = Array.from(files).filter((file) => /\.(pdf|png|jpe?g)$/i.test(file.name));
    if (accepted.length > 0) {
      if (accepted.length === 1) {
        setInputName(accepted[0].name);
      } else {
        setInputName(`${accepted[0].name} & others`);
      }
    }
    setJob(createJob(accepted));
    setSelectedResult(0);
  }

  async function chooseInputFolder() {
    if (!isSignedIn) {
      Swal.fire({
        icon: "warning",
        title: "Authentication Required",
        text: "Please sign in to process documents.",
        showCancelButton: true,
        confirmButtonText: "Sign In to Continue",
        cancelButtonText: "Cancel",
        buttonsStyling: false,
        customClass: {
          popup: "rounded-2xl border border-slate-100 shadow-2xl dark:bg-slate-900 dark:border-slate-800",
          title: "text-xl font-bold text-slate-900 dark:text-white pt-4",
          htmlContainer: "text-slate-600 dark:text-slate-400 font-medium pb-4",
          actions: "flex gap-3",
          confirmButton: "bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg transition-all shadow-sm",
          cancelButton: "bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2.5 px-6 rounded-lg transition-all dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        }
      }).then((result) => {
        if (result.isConfirmed) {
          openSignIn();
        }
      });
      return;
    }
    if (!window.showDirectoryPicker) {
      fileInputRef.current?.click();
      return;
    }
    const { isConfirmed } = await Swal.fire({
      title: "Select Your PDF Folder",
      html: "Your browser will ask permission to <b>read</b> files from a folder you choose.<br><br>This is a normal browser security step — your files stay on your computer.",
      icon: "info",
      confirmButtonText: "📂 Choose Folder",
      showCancelButton: true,
      cancelButtonText: "Cancel"
    });
    if (!isConfirmed) return;
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      setInputName(handle.name);
      const files: File[] = [];
      async function readDir(dir: NativeDirectoryHandle, prefix = "") {
        for await (const [name, entry] of (dir as any).entries()) {
          if (entry.kind === "file") {
            if (/\.(pdf|png|jpe?g)$/i.test(name)) {
              const file = await (entry as any).getFile();
              Object.defineProperty(file, "relativePath", { value: prefix + name, writable: false });
              files.push(file);
            }
          } else if (entry.kind === "directory") {
            await readDir(entry, prefix + name + "/");
          }
        }
      }
      await readDir(handle);
      setJob(createJob(files));
      setSelectedResult(0);
    } catch (err) {
      if ((err as DOMException).name !== "AbortError") throw err;
    }
  }

  async function chooseOutputFolder() {
    if (!window.showDirectoryPicker) {
      setOutputName("Browser output picker unavailable — files will be downloadable as a ZIP instead.");
      return;
    }
    const { isConfirmed } = await Swal.fire({
      title: "Select Output Folder",
      html: "Your browser will ask permission to <b>save files</b> into a folder you choose.<br><br>This is where your classified/renamed PDFs will be saved.",
      icon: "info",
      confirmButtonText: "📂 Choose Output Folder",
      showCancelButton: true,
      cancelButtonText: "Cancel"
    });
    if (!isConfirmed) return;
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      setOutputHandle(handle);
      setOutputName(handle.name);
    } catch (err) {
      // User cancelled the picker — do nothing
      if ((err as DOMException).name !== "AbortError") throw err;
    }
  }

  async function startProcessing() {
    if (!job.files.length) return;
    
    // Request permission immediately while user gesture is still active
    if (outputHandle && view !== "extract") {
      try {
        const status = await (outputHandle as any).queryPermission({ mode: "readwrite" });
        if (status !== "granted") {
          const newStatus = await (outputHandle as any).requestPermission({ mode: "readwrite" });
          if (newStatus !== "granted") {
            alert("Write permission is required to save outputs.");
            return;
          }
        }
      } catch (e) {
        console.warn("Permission check failed", e);
      }
    }

    abortRef.current = false;
    setView("processing");
    setJob((old) => ({
      ...old,
      status: "processing",
      logs: ["Batch queued", `Detected ${old.files.length} supported files`],
      files: old.files.map((file) => ({ ...file, status: "queued" }))
    }));

    const nextFiles = [...job.files];
    const BATCH_SIZE = 3;

    for (let batchStart = 0; batchStart < nextFiles.length; batchStart += BATCH_SIZE) {
      if (abortRef.current) {
        setJob((old) => ({ ...old, logs: [...old.logs, "🛑 Batch stopped by user"] }));
        break;
      }

      const batch = nextFiles.slice(batchStart, batchStart + BATCH_SIZE);

      // Mark all files in this batch as uploading
      batch.forEach((target) => {
        setJob((old) => updateFile(old, target.id, { status: "uploading" }, `Uploading: ${target.file.name}`));
      });

      // Process batch in parallel
      const results = await Promise.allSettled(batch.map((target) => processDocument(target, options, (status, data) => {
        if (status === "warn" && data?.message) {
          setJob((old) => ({ ...old, logs: [...old.logs, `⚠️ WARNING: ${data.message}`] }));
        } else {
          setJob((old) => updateFile(old, target.id, { status: status as JobFile["status"] }, `${target.file.name} -> ${status.toUpperCase()}`));
        }
      }, apiKey || undefined, user?.id)));

      results.forEach((result, i) => {
        const globalIndex = batchStart + i;
        const target = batch[i];
        if (result.status === "fulfilled") {
          const res = result.value;
          nextFiles[globalIndex] = {
            ...target,
            status: res.status === "done" ? "done" : "failed",
            category: res.category,
            suggestedFilename: res.suggestedFilename,
            extracted: res.extracted,
            text: res.text,
            error: res.error
          };
          setJob((old) =>
            updateFile(old, target.id, nextFiles[globalIndex], `${target.file.name} -> ${res.status === "done" ? "DONE" : "FAILED"}`)
          );
        } else {
          const message = result.reason instanceof Error ? result.reason.message : "Unknown error";
          nextFiles[globalIndex] = { ...target, status: "failed", category: "Failed", error: message };
          setJob((old) => updateFile(old, target.id, nextFiles[globalIndex], `${target.file.name} -> FAILED: ${message}`));
        }
      });
    }

    setJob((old) => {
      const isStopped = abortRef.current;
      const finalStatus = isStopped ? "stopped" : (old.files.some((file) => file.status === "failed") ? "failed" : "completed");
      const categories: Record<string, number> = {};
      old.files.forEach((file) => {
        if (file.status === "done" && file.category) {
          categories[file.category] = (categories[file.category] || 0) + 1;
        }
      });
      const historyItem: JobHistoryItem = {
        id: old.id,
        createdAt: old.createdAt,
        status: finalStatus,
        totalFiles: old.files.length,
        processedFiles: old.files.filter((file) => file.status === "done").length,
        failedFiles: old.files.filter((file) => file.status === "failed").length,
        mode: view === "extract" ? "extract" : (options.rename ? "rename" : "classify"),
        categories
      };
      saveHistory([historyItem, ...history.filter((item) => item.id !== old.id)].slice(0, 25));
      return {
        ...old,
        status: finalStatus,
        progress: 100,
        logs: [...old.logs, "Batch finished"]
      };
    });
    
    const jobToSave = { ...job, files: nextFiles };
    
    if (outputHandle && view !== "extract") {
      await saveOutputs(jobToSave);
      setJob((old) => ({ ...old, logs: [...old.logs, "Files copied into classified output folders"] }));
    }

    const failedBatch = nextFiles.filter(f => f.status === "failed");
    if (failedBatch.length > 0) {
      const firstError = failedBatch[0].error || "Unknown error";
      await Swal.fire({
        title: "Processing Failed",
        html: `<p class="mb-4">Some files failed to process. Error details:</p>
               <div class="bg-red-50 text-red-800 p-3 rounded text-sm text-left mb-4 font-mono overflow-auto max-h-32">${firstError}</div>
               <p class="text-sm">If you reached your quota, please update your billing or use a different API key.</p>
               <p class="text-sm mt-2"><b>1.</b> Go to <a href="https://aistudio.google.com/app/apikey" target="_blank" class="text-blue-600 underline">Google AI Studio</a> and create an API key.<br><b>2.</b> Copy and paste it into the <b>Settings</b> tab in MyTidyfy, then save.</p>`,
        icon: "error"
      });
    }

    setView(view === "extract" ? "results" : "success");
  }

  async function saveOutputs(sourceJob = job) {
    if (!outputHandle) return;
    for (const file of sourceJob.files) {
      if (file.status === "queued" || file.status === "uploading") continue;
      
      let targetDir: NativeDirectoryHandle;

      if (options.rename) {
        // Smart Rename: save all files flat into the root output folder
        targetDir = outputHandle;
      } else {
        // Classify PDFs: create category subfolders
        targetDir = await outputHandle.getDirectoryHandle(safeFolderName(file.category ?? "Other"), { create: true });
      }

      let finalName = file.file.name;
      if (options.rename && file.suggestedFilename) {
        // Sanitize invalid Windows filename characters
        let safeName = file.suggestedFilename.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
        if (!safeName.includes('.')) {
          safeName += file.file.name.substring(file.file.name.lastIndexOf('.'));
        }
        finalName = safeName;
      }

      const writeToFile = async (handle: any, blob: Blob) => {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      };

      try {
        const copied = await targetDir.getFileHandle(finalName, { create: true });
        await writeToFile(copied, file.file);
      } catch (e) {
        console.error("Failed to save with name", finalName, e);
        // Fallback to original name if AI-generated name was invalid
        const fallback = await targetDir.getFileHandle(file.file.name, { create: true });
        await writeToFile(fallback, file.file);
      }
    }
  }

  function updateExtracted(key: string, value: string) {
    if (!selected) return;
    setJob((old) => ({
      ...old,
      files: old.files.map((file, index) =>
        index === selectedResult ? { ...file, extracted: { ...(file.extracted ?? {}), [key]: value } } : file
      )
    }));
  }

  return (
    <main className="min-h-screen">
      <div className="flex">
        {/* Mobile Overlay */}
        {isMobileMenuOpen && (
          <div 
            className="fixed inset-0 z-40 bg-black/50 lg:hidden" 
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        <aside className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 transition-transform duration-300 lg:translate-x-0 lg:block",
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full",
          isAdmin ? "bg-white border-r-[4px] border-r-green-100 dark:border-r-green-900/20 dark:bg-card px-4 py-6 shadow-sm" : "border-r bg-card px-4 py-5",
          view === "admin-login" && "hidden lg:hidden"
        )}>
          {isAdmin ? (
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-3 px-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0f172a] shadow-sm">
                  <Shield className="h-5 w-5 text-green-400" />
                </div>
                <div>
                  <p className="text-lg font-bold text-slate-900 dark:text-foreground leading-tight">Admin Portal</p>
                  <p className="text-xs text-slate-500 dark:text-muted-foreground">MyTidyfy System</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setIsMobileMenuOpen(false)}>
                <XCircle className="h-5 w-5" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-3">
                <img src="/logo.png" alt="MyTidyfy" className="h-10 w-10 rounded-lg object-contain" />
                <div>
                  <p className="text-sm font-semibold">MyTidyfy</p>
                  <p className="text-xs text-muted-foreground">Document Organizer</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setIsMobileMenuOpen(false)}>
                <XCircle className="h-5 w-5" />
              </Button>
            </div>
          )}

          <nav className={cn("space-y-1", isAdmin ? "mt-10 space-y-2" : "mt-8")}>
            {(isAdmin ? [
              ["admin", LayoutDashboard, "Dashboard"],
              ["users", Users, "Manage Users"],
              ["analytics", Activity, "Website Analytics"],
              ["admin-profile", UserCircle, "Admin Profile"],
              ["settings", Settings, "Exit Admin"]
            ] : [
              ["dashboard", LayoutDashboard, "Dashboard"],
              ["new", UploadCloud, "Classify PDFs"],
              ["rename", FileSignature, "Smart Rename"],
              ["extract", FileJson, "Smart Extract"],
              ["processing", Loader2, "Processing"],
              ["results", FileJson, "Results"],
              ["history", History, "History"],
              ["settings", Settings, "Settings"]
            ]).map(([key, Icon, label]) => (
              <button
                key={key as string}
                onClick={() => {
                  if (key === "settings" && isAdmin) {
                    setIsAdmin(false);
                    localStorage.removeItem("adminAuth");
                    setView("dashboard");
                  } else {
                    setView(key as typeof view);
                    if (key === "new") setOptions({ ...options, rename: false, customPrompt: "" });
                    if (key === "rename") setOptions({ ...options, rename: true, customPrompt: "" });
                    if (key === "extract") setOptions({ ...options, rename: false, customPrompt: "" });
                  }
                  setIsMobileMenuOpen(false);
                }}
                className={isAdmin ? cn(
                  "flex w-full items-center gap-4 rounded-xl px-4 py-3 text-[15px] transition-all",
                  view === key || (key === "admin" && view === "admin")
                    ? "bg-[#0f172a] text-white shadow-md font-semibold dark:bg-white dark:text-black" 
                    : "text-slate-500 hover:text-slate-900 hover:bg-slate-50 font-medium dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/50"
                ) : cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  view === key && "bg-accent text-accent-foreground"
                )}
              >
                <Icon className={isAdmin ? cn("h-5 w-5", view === key || (key === "admin" && view === "admin") ? "text-white dark:text-black" : "text-slate-400") : "h-4 w-4"} />
                {label as string}
              </button>
            ))}
          </nav>
          
          <div className="absolute bottom-5 left-4 right-4 border-t pt-4">
            {isSignedIn ? (
              <div className="flex w-full items-center gap-3 rounded-md px-2 py-2">
                <UserButton showName={true} />
              </div>
            ) : (
              <SignInButton mode="modal">
                <button className="flex w-full items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                  Sign In
                </button>
              </SignInButton>
            )}
          </div>
        </aside>

        <section className={cn("w-full transition-all", view === "admin-login" ? "h-screen bg-slate-50 dark:bg-slate-950 flex flex-col" : "px-4 py-5 lg:ml-64 lg:px-8")}>
          {view !== "admin-login" && (
            <header className="mb-6 flex flex-col gap-4 border-b pb-5 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <Button variant="outline" size="icon" className="lg:hidden shrink-0" onClick={() => setIsMobileMenuOpen(true)}>
                  <Menu className="h-5 w-5" />
                </Button>
                <div>
                  <h1 className="text-2xl font-semibold tracking-normal">MyTidyfy</h1>
                  <p className="text-sm text-muted-foreground hidden sm:block">Your AI-Powered Document Organizer</p>
                  <p className="mt-1 text-sm font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-purple-400">Organize, rename, extract it</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {isAdmin && (
                  <Button variant="destructive" onClick={() => setView("admin")}>
                    <Shield className="h-4 w-4 mr-2" />
                    Admin
                  </Button>
                )}
                <Button variant="outline" onClick={() => setView("history")}>
                  <Archive className="h-4 w-4" />
                  History
                </Button>
                <Button onClick={() => {
                  setView("new");
                  setOptions({ ...options, rename: false });
                }}>
                  <UploadCloud className="h-4 w-4" />
                  New Activity
                </Button>
              </div>
            </header>
          )}

          {view === "dashboard" && (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-4">
                <Metric label="Total Jobs" value={(history.length + (job.status !== "draft" && job.files.length ? 1 : 0)).toString()} />
                <Metric label="Processed Files" value={totalProcessedFiles.toLocaleString()} />
                <Metric label="Failed" value={totalFailedFiles.toString()} />
                <Metric label="Success Rate" value={`${successRate}%`} />
              </div>

              {/* Category Breakdown */}
              {hasCategoryData && (
                <Card>
                  <CardHeader>
                    <CardTitle>Category Breakdown</CardTitle>
                    <CardDescription>Total PDFs classified into each category across all sessions.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-3">
                      {Object.entries(allTimeCategories)
                        .sort(([, a], [, b]) => b - a)
                        .map(([cat, count]) => (
                          <div key={cat} className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
                            <span className="text-sm font-medium">{cat}</span>
                            <span className="text-lg font-bold text-primary">{count}</span>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
                <Card>
                  <CardHeader>
                    <CardTitle>Recent Activity</CardTitle>
                    <CardDescription>Your latest document processing sessions.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {recentJobs.length ? (
                      recentJobs.map((item, idx) => <JobRow key={item.id} activityNumber={recentJobs.length - idx} files={item.files} status={item.status} mode={(item as any).mode} />)
                    ) : (
                      <EmptyState title="No activity yet" text="Your classification and rename sessions will appear here." />
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Quick Actions</CardTitle>
                    <CardDescription>Rename your PDFs.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button className="w-full" onClick={() => {
                      setView("rename");
                      setOptions({ ...options, rename: true });
                    }}>
                      <UploadCloud className="h-4 w-4" />
                      New Activity
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {(view === "new" || view === "rename" || view === "extract") && (
            <div className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>{view === "extract" ? "Smart Extract (Data Mining)" : view === "rename" ? "Smart Rename" : "Classify PDF Folder"}</CardTitle>
                  <CardDescription>
                    {view === "extract" ? "Choose files or a folder. We will extract structured data and save it to an Excel sheet." : view === "rename" 
                      ? "Choose your folder. The app will extract the contents and intelligently rename your files based on their data." 
                      : "Choose your PDF folder and output folder. The app will copy each file into its classified folder."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className={`rounded-lg border p-5 ${job.files.length ? "border-blue-300 bg-blue-50 dark:bg-blue-950" : "bg-card"}`}>
                    {/* Hidden fallback input for older browsers */}
                    <input
                      ref={fileInputRef}
                      className="hidden"
                      type="file"
                      multiple
                      accept=".pdf,.jpg,.jpeg,.png"
                      /* @ts-expect-error webkitdirectory is Chromium-specific */
                      webkitdirectory={view !== "extract" ? "" : undefined}
                      onChange={(event) => onFilesSelected(event.target.files)}
                    />
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div className="flex items-center gap-3">
                        <FolderOpen className={`h-5 w-5 shrink-0 ${job.files.length ? "text-blue-600" : "text-muted-foreground"}`} />
                        <div>
                          <p className="font-medium">Input {view === "extract" ? "Files/Folder" : "Folder"}</p>
                          <p className={`text-sm font-mono ${job.files.length ? "text-blue-700" : "text-muted-foreground"}`}>
                            {job.files.length ? `📂 ${inputName} — ${job.files.length} file(s)` : "Not selected"}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {view === "extract" && (
                          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                            <FolderOpen className="h-4 w-4" />
                            Choose Files
                          </Button>
                        )}
                        <Button variant="outline" onClick={chooseInputFolder}>
                          <FolderOpen className="h-4 w-4" />
                          {job.files.length ? "Change Folder" : "Choose Folder"}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {view === "extract" && (
                    <div className="rounded-lg border p-5 bg-card">
                      <div className="space-y-2">
                        <p className="font-medium">What data do you want to extract? (Optional)</p>
                        <p className="text-sm text-muted-foreground">Example: "Find the Vendor, Date, Total Amount, and Tax from these receipts." Leave blank for auto-detect.</p>
                        <Input 
                          placeholder="Extract Vendor, Amount, Date..." 
                          value={options.customPrompt || ""} 
                          onChange={(e) => setOptions({ ...options, customPrompt: e.target.value })}
                        />
                      </div>
                    </div>
                  )}

                  {view !== "extract" && (
                    <div className={`rounded-lg border p-5 ${outputHandle ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950" : "bg-card"}`}>
                      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-center gap-3">
                          <FolderOpen className={`h-5 w-5 shrink-0 ${outputHandle ? "text-emerald-600" : "text-muted-foreground"}`} />
                          <div>
                            <p className="font-medium">Output Folder</p>
                            <p className={`text-sm font-mono ${outputHandle ? "text-emerald-700" : "text-muted-foreground"}`}>
                              {outputHandle ? `📂 ${outputName}` : "Not selected"}
                            </p>
                          </div>
                        </div>
                        <Button variant="outline" onClick={chooseOutputFolder}>
                          <Save className="h-4 w-4" />
                          {outputHandle ? "Change Folder" : "Choose Output"}
                        </Button>
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="mb-3 text-sm font-medium">Files detected</p>
                    <div className="max-h-56 space-y-2 overflow-auto rounded-lg border bg-card p-3">
                      {job.files.length ? (
                        job.files.map((file) => (
                          <div key={file.id} className="flex items-center gap-2 text-sm">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            {file.relativePath}
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">No files selected yet.</p>
                      )}
                    </div>
                  </div>
                  <Button className="w-full" disabled={!job.files.length || (view !== "extract" && !outputHandle)} onClick={startProcessing}>
                    <Play className="h-4 w-4" />
                    {view === "extract" ? "Start Extraction" : view === "rename" ? "Start Rename" : "Start Classification"}
                  </Button>
                  {view !== "extract" && !outputHandle && <p className="text-sm text-muted-foreground">Choose an output folder before starting.</p>}
                </CardContent>
              </Card>
            </div>
          )}

          {view === "processing" && (
            <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Processing Documents</CardTitle>
                    <CardDescription>Live OCR and extraction progress for this batch.</CardDescription>
                  </div>
                  <Button variant="destructive" size="sm" onClick={() => { abortRef.current = true; }}>
                    <XCircle className="mr-2 h-4 w-4" /> Stop
                  </Button>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <div className="mb-2 flex justify-between text-sm">
                      <span>Progress</span>
                      <span>{job.progress}%</span>
                    </div>
                    <Progress value={job.progress} />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <StatusPanel title="Current File" value={currentFile?.file.name ?? "Waiting"} />
                    <StatusPanel title="Step" value={currentFile ? titleCase(currentFile.status) : "Saving Output"} />
                  </div>
                  <div className="rounded-lg border bg-card p-4">
                    <div className="space-y-3 text-sm">
                      <Step complete={!currentFile || currentFile.status !== "queued"} active={currentFile?.status === "uploading"} label="Uploading" />
                      <Step complete={!currentFile || ["llm", "saving", "done", "failed"].includes(currentFile.status)} active={currentFile?.status === "ocr"} label="OCR Running" />
                      <Step complete={!currentFile || ["saving", "done", "failed"].includes(currentFile.status)} active={currentFile?.status === "llm"} label="LLM Extraction" />
                      <Step complete={job.progress === 100} active={currentFile?.status === "saving" || (job.progress > 0 && job.progress < 100 && !currentFile)} label="Saving Output" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Live Log</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[420px] overflow-auto rounded-lg bg-slate-950 p-4 font-mono text-xs text-slate-100">
                    {job.logs.map((log, index) => (
                      <p key={`${log}-${index}`}>- {log}</p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {view === "results" && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold">Extraction Results</h2>
                  <p className="text-sm text-muted-foreground">Review the extracted data for this session.</p>
                </div>
              </div>

              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-muted text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3 font-medium">Document Name</th>
                          <th className="px-4 py-3 font-medium">Document Type</th>
                          <th className="px-4 py-3 font-medium">Date Processed</th>
                          <th className="px-4 py-3 font-medium text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {extractedHistory.map(f => {
                          const ext = typeof f.extracted_data === "string" ? JSON.parse(f.extracted_data || "{}") : (f.extracted_data || f.extracted || {});
                          const docType = ext.documentType || f.category || "-";
                          
                          // Format the date processed
                          const dateProcessed = f.created_at ? new Date(f.created_at).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          }) : "Unknown";

                          return (
                          <tr key={f.id} className="hover:bg-muted/50">
                            <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{f.filename}</td>
                            <td className="px-4 py-3 capitalize">
                               <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10 dark:bg-blue-900/30 dark:text-blue-400 dark:ring-blue-400/20">
                                 {docType}
                               </span>
                            </td>
                            <td className="px-4 py-3 text-slate-500">{dateProcessed}</td>
                            <td className="px-4 py-3 text-right">
                               <div className="flex justify-end gap-1">
                                 <Button variant="ghost" size="sm" onClick={async () => {
                                   try {
                                     const { buildExcel } = await import("@/lib/api");
                                     const res = await buildExcel([{
                                        fileName: f.filename,
                                        category: f.category,
                                        status: "done",
                                        extracted: ext
                                     }]);
                                     const blob = base64ToBlob(res.contentBase64, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
                                     const url = window.URL.createObjectURL(blob);
                                     const a = document.createElement("a");
                                     a.href = url;
                                     
                                     // Use the original filename but change the extension to .xlsx
                                     const baseName = f.filename.replace(/\.[^/.]+$/, "");
                                     a.download = `${baseName}.xlsx`;
                                     
                                     document.body.appendChild(a);
                                     a.click();
                                     window.URL.revokeObjectURL(url);
                                     a.remove();
                                   } catch(e: any) {
                                     Swal.fire("Error", e.message, "error");
                                   }
                                 }} title="Download Excel">
                                   <Download className="h-4 w-4 text-emerald-600" />
                                 </Button>
                                 <Button variant="ghost" size="sm" onClick={() => Swal.fire({ title: "Extracted Data", html: formatExtractedDataToHTML(ext), width: 700 })} title="View Data">
                                   <Eye className="h-4 w-4 text-blue-600" />
                                 </Button>
                               </div>
                            </td>
                          </tr>
                        )})}
                        {extractedHistory.length === 0 && (
                          <tr><td colSpan={4} className="text-center py-12 text-muted-foreground">No extractions found in database.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Stats row */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Metric label="Total Jobs Run" value={totalJobs.toString()} />
                <Metric label="All-Time Processed" value={totalProcessedFiles.toLocaleString()} />
                <Metric label="All-Time Failed" value={totalFailedFiles.toString()} />
                <Metric label="Success Rate" value={`${successRate}%`} />
              </div>
              {/* Category breakdown */}
              {hasCategoryData ? (
                <div>
                  <p className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">Category Breakdown (All Time)</p>
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(allTimeCategories).sort((a, b) => b[1] - a[1]).map(([category, count]) => (
                      <div key={category} className="flex items-center gap-4 rounded-lg border bg-white px-4 py-3">
                        <span className="text-sm font-medium capitalize">{category}</span>
                        <span className="text-xl font-bold text-primary">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : totalJobs > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-sm font-medium text-amber-800">📊 Category breakdown not available for past jobs</p>
                  <p className="text-xs text-amber-600 mt-1">Category tracking is now enabled — your next batch will show a full breakdown here.</p>
                </div>
              ) : null}
            </div>
          )}

          {view === "success" && (
            <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-6 text-center">
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-100">
                <CheckCircle2 className="h-12 w-12 text-emerald-600" />
              </div>
              <div className="space-y-2">
                <h2 className="text-3xl font-semibold tracking-tight">Classification Complete</h2>
                <p className="text-lg text-muted-foreground">
                  Your files have been successfully processed and organized into the output folder.
                </p>
                {outputHandle && (
                  <p className="pt-2 font-mono text-sm text-emerald-700">
                    📂 {outputName}
                  </p>
                )}
              </div>
              <div className="flex gap-4 pt-4">
                <Button onClick={() => setView("dashboard")} variant="outline" size="lg">
                  Back to Dashboard
                </Button>
                <Button onClick={() => setView("new")} size="lg">
                  Start New Job
                </Button>
              </div>
            </div>
          )}

          {view === "history" && (
            <Card>
              <CardHeader>
                <CardTitle>Processing History</CardTitle>
                <CardDescription>Search previous jobs and download their outputs.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Search jobs" value={search} onChange={(event) => setSearch(event.target.value)} />
                </div>
                {(() => {
                  const filtered = history.filter((item) => item.id.toLowerCase().includes(search.toLowerCase()));
                  const total = history.length;
                  return filtered.map((item) => {
                    const activityNum = total - history.indexOf(item);
                    return (
                      <div key={item.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="font-medium">Activity {activityNum} — {item.totalFiles} PDF{item.totalFiles !== 1 ? "s" : ""} — {item.mode === "rename" ? "Renamed" : "Classified"} — {titleCase(item.status)}</p>
                          <p className="text-sm text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => Swal.fire("Notice", `Activity ${activityNum}: Your files are safely stored in the output folder you chose during processing.`, "info")}>View</Button>
                          <Button variant="outline" size="sm" onClick={() => Swal.fire("Files Saved", `Activity ${activityNum}: Files were saved directly to your selected output folder during processing.`, "success")}>
                            <Download className="h-4 w-4" />Download
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => {
                            Swal.fire({
                              title: "Are you sure?",
                              text: `Delete Activity ${activityNum} from your history?`,
                              icon: "warning",
                              showCancelButton: true,
                              confirmButtonColor: "#ef4444",
                              confirmButtonText: "Yes, delete it"
                            }).then((result) => {
                              if (result.isConfirmed) {
                                const newHistory = history.filter(h => h.id !== item.id);
                                setHistory(newHistory);
                                localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
                              }
                            });
                          }}>
                            <Trash2 className="h-4 w-4" />Delete
                          </Button>
                        </div>
                      </div>
                    );
                  });
                })()}
                {!history.length && <EmptyState title="No processing history" text="Completed sessions will appear here after you run a batch." />}
              </CardContent>
            </Card>
          )}

          {view === "admin-login" && (
            <div className="flex flex-1 items-center justify-center p-4">
              <Card className="w-full max-w-md shadow-2xl border-0">
                <CardHeader className="space-y-3 text-center pb-8">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#0f172a] shadow-inner mb-2">
                    <Shield className="h-8 w-8 text-green-400" />
                  </div>
                  <CardTitle className="text-3xl font-bold tracking-tight">Admin Portal</CardTitle>
                  <CardDescription className="text-base">Enter your credentials to access system settings.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.target as HTMLFormElement;
                      const user = (form.elements.namedItem("user") as HTMLInputElement).value;
                      const pass = (form.elements.namedItem("pass") as HTMLInputElement).value;
                      const storedPass = localStorage.getItem("adminPass") || "123";
                      const storedUser = localStorage.getItem("adminUser") || "abdi";
                      if (user === storedUser && pass === storedPass) {
                        localStorage.setItem("adminAuth", "true");
                        setIsAdmin(true);
                        setView("admin");
                      } else {
                        Swal.fire("Error", "Invalid credentials", "error");
                      }
                    }}
                    className="space-y-6"
                  >
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Username</label>
                      <Input name="user" placeholder="admin" className="h-12 px-4" autoFocus required />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Password</label>
                      <Input name="pass" type="password" placeholder="••••••••" className="h-12 px-4" required />
                    </div>
                    <div className="pt-2 flex flex-col gap-3">
                      <Button type="submit" size="lg" className="w-full h-12 text-base font-semibold bg-[#0f172a] text-white hover:bg-slate-800">
                        Sign In to Admin
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setView("settings")} className="w-full">
                        Cancel
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </div>
          )}

          {view === "admin" && isAdmin && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold tracking-tight">System Administration</h2>
                <Button variant="outline" onClick={() => { 
                  setIsAdmin(false); 
                  localStorage.removeItem("adminAuth");
                  setView("dashboard"); 
                }}>Exit Admin Mode</Button>
              </div>
              
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Total Documents</CardDescription>
                    <CardTitle className="text-4xl">{adminStats?.total_documents || 0}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted-foreground bg-blue-100 text-blue-700 px-2 py-1 rounded-md inline-block font-semibold">+ALL TIME</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Registered Users</CardDescription>
                    <CardTitle className="text-4xl">{adminUsers.length}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted-foreground bg-green-100 text-green-700 px-2 py-1 rounded-md inline-block font-semibold">FROM CLERK</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Top Category</CardDescription>
                    <CardTitle className="text-4xl truncate" title={adminStats?.top_categories?.[0]?.category || "None"}>
                      {adminStats?.top_categories?.[0]?.category ? adminStats.top_categories[0].category.substring(0, 7) + (adminStats.top_categories[0].category.length > 7 ? "..." : "") : "N/A"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted-foreground bg-yellow-100 text-yellow-700 px-2 py-1 rounded-md inline-block font-semibold">TRENDING</div>
                  </CardContent>
                </Card>
                <Card className="bg-[#0f172a] text-white border-0">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="h-5 w-5 text-indigo-400" />
                    </div>
                    <CardDescription className="text-slate-400">System Performance</CardDescription>
                    <CardTitle className="text-4xl">100%</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted-foreground bg-slate-800 text-slate-300 px-2 py-1 rounded-md inline-block font-semibold uppercase tracking-wider">Lifetime Sum</div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Top Users (By Document Count)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {adminStats?.top_users?.map((u: any, i: number) => {
                        const userProfile = adminUsers.find((clerkUser: any) => clerkUser.id === u.user_id);
                        const displayName = userProfile ? `${userProfile.first_name || ''} ${userProfile.last_name || ''}`.trim() : (u.user_id && u.user_id !== "anonymous" ? u.user_id.slice(0, 15) + '...' : "Anonymous User");
                        return (
                          <div key={i} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {userProfile && <img src={userProfile.image_url} alt="avatar" className="h-5 w-5 rounded-full object-cover" />}
                              <div className="font-medium text-sm">{displayName}</div>
                            </div>
                            <div className="font-bold text-sm text-slate-500">{u.count} docs</div>
                          </div>
                        );
                      })}
                      {(!adminStats?.top_users || adminStats.top_users.length === 0) && (
                        <div className="text-sm text-muted-foreground">No processing history yet.</div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Admin Tools</CardTitle>
                    <CardDescription>Advanced management requires Clerk Dashboard integration.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button variant="outline" className="w-full justify-start" onClick={() => setView("users")}>
                      Manage Users in System
                    </Button>
                    <Button variant="outline" className="w-full justify-start" onClick={() => setView("analytics")}>
                      View Visitor Analytics (True Data)
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {view === "users" && isAdmin && (
            <div className="space-y-6 pb-10">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Users className="h-7 w-7 text-indigo-600" />
                    <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Manage Users</h2>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    View all signed-in users registered in your Clerk authentication portal.
                  </p>
                </div>
                <Button onClick={() => window.open('https://dashboard.clerk.com/', '_blank')} className="bg-indigo-600 hover:bg-indigo-700">
                  Manage in Clerk Dashboard
                </Button>
              </div>

              <Card className="shadow-sm border-slate-200 dark:border-slate-800">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b bg-slate-50 dark:bg-slate-900/50">
                      <tr>
                        <th className="px-6 py-4 font-medium text-slate-500">User</th>
                        <th className="px-6 py-4 font-medium text-slate-500">Email</th>
                        <th className="px-6 py-4 font-medium text-slate-500">Created</th>
                        <th className="px-6 py-4 font-medium text-slate-500">Last Sign In</th>
                        <th className="px-6 py-4 text-right font-medium text-slate-500">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {adminUsers.map((u, i) => (
                        <tr key={i} className="transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <img src={u.image_url || `https://ui-avatars.com/api/?name=${u.first_name || 'U'}`} alt="Avatar" className="h-8 w-8 rounded-full bg-slate-100 object-cover" />
                              <span className="font-semibold text-slate-900 dark:text-slate-100">{u.first_name} {u.last_name}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                            {u.email_addresses?.[0]?.email_address || "No Email"}
                          </td>
                          <td className="px-6 py-4 text-slate-500">
                            {new Date(u.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 text-slate-500">
                            {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : 'Never'}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <Button variant="ghost" size="sm" onClick={() => window.open(`https://dashboard.clerk.com/`, '_blank')}>
                              View
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {adminUsers.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-6 py-10 text-center text-slate-500">
                            No users found or loading users...
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {view === "analytics" && isAdmin && (
            <div className="space-y-8 pb-10">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Activity className="h-7 w-7 text-blue-600" />
                    <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Website Analytics</h2>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-sm font-medium text-slate-500">
                    <div className="h-2 w-2 rounded-full bg-emerald-400"></div>
                    Tracking visitors on mytidyfy.com • Today
                  </div>
                </div>
                <Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear Analysis
                </Button>
              </div>

              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2 rounded-full border bg-white p-1 shadow-sm dark:bg-slate-900 dark:border-slate-800">
                  <button onClick={() => setAnalyticsTimeframe("today")} className={cn("rounded-full px-4 py-1.5 text-sm font-semibold transition-colors", analyticsTimeframe === "today" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>Today</button>
                  <button onClick={() => setAnalyticsTimeframe("yesterday")} className={cn("rounded-full px-4 py-1.5 text-sm font-semibold transition-colors", analyticsTimeframe === "yesterday" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>Yesterday</button>
                  <button onClick={() => setAnalyticsTimeframe("7days")} className={cn("rounded-full px-4 py-1.5 text-sm font-semibold transition-colors", analyticsTimeframe === "7days" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>7 Days</button>
                  <button onClick={() => setAnalyticsTimeframe("30days")} className={cn("rounded-full px-4 py-1.5 text-sm font-semibold transition-colors", analyticsTimeframe === "30days" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>30 Days</button>
                </div>
                
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 shadow-sm dark:bg-slate-900 dark:border-slate-800">
                    <span className="text-sm font-medium">06/04/2026</span>
                    <Calendar className="h-4 w-4 text-slate-400" />
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 shadow-sm dark:bg-slate-900 dark:border-slate-800">
                    <span className="text-sm font-medium">06/04/2026</span>
                    <Calendar className="h-4 w-4 text-slate-400" />
                  </div>
                  <Button className="bg-blue-600 hover:bg-blue-700">
                    <Filter className="mr-2 h-4 w-4" />
                    Filter
                  </Button>
                </div>
              </div>

              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex flex-col justify-center rounded-2xl bg-white p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-100 dark:bg-card dark:border-border">
                  <div className="mb-4 h-12 w-12 flex items-center justify-center rounded-xl bg-indigo-50 text-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-400">
                    <Eye className="h-6 w-6" />
                  </div>
                  <h3 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-foreground">{trueAnalytics.page_views || 0}</h3>
                  <p className="mt-1 text-sm font-medium text-slate-500 dark:text-muted-foreground">Page Views</p>
                </div>

                <div className="flex flex-col justify-center rounded-2xl bg-white p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-100 dark:bg-card dark:border-border">
                  <div className="mb-4 h-12 w-12 flex items-center justify-center rounded-xl bg-emerald-50 text-emerald-500 dark:bg-emerald-900/30 dark:text-emerald-400">
                    <Users className="h-6 w-6" />
                  </div>
                  <h3 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-foreground">{trueAnalytics.unique_ips || 0}</h3>
                  <p className="mt-1 text-sm font-medium text-slate-500 dark:text-muted-foreground">Unique Visitors</p>
                </div>

                <div className="flex flex-col justify-center rounded-2xl bg-white p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-100 dark:bg-card dark:border-border">
                  <div className="mb-4 h-12 w-12 flex items-center justify-center rounded-xl bg-amber-50 text-amber-500 dark:bg-amber-900/30 dark:text-amber-400">
                    <MousePointerClick className="h-6 w-6" />
                  </div>
                  <h3 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-foreground">{trueAnalytics.button_clicks || 0}</h3>
                  <p className="mt-1 text-sm font-medium text-slate-500 dark:text-muted-foreground">Button Clicks</p>
                </div>

                <div className="flex flex-col justify-center rounded-2xl bg-white p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-100 dark:bg-card dark:border-border">
                  <div className="mb-4 h-12 w-12 flex items-center justify-center rounded-xl bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-400">
                    <Globe2 className="h-6 w-6" />
                  </div>
                  <h3 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-foreground">{trueAnalytics.unique_ips || 0}</h3>
                  <p className="mt-1 text-sm font-medium text-slate-500 dark:text-muted-foreground">Unique IPs</p>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2 rounded-2xl bg-white p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-100 dark:bg-card dark:border-border">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-2">
                      <Activity className="h-5 w-5 text-blue-500" />
                      <h3 className="text-lg font-bold">Traffic Overview</h3>
                    </div>
                    <span className="rounded-md bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300 capitalize">{analyticsTimeframe.replace('days', ' Days')}</span>
                  </div>
                  {/* Chart Area */}
                  <div className="relative h-64 w-full">
                    {(!trueAnalytics.chart_data || trueAnalytics.chart_data.length === 0) ? (
                      <div className="flex h-full items-center justify-center text-slate-400 text-sm">
                        No traffic data available for this timeframe.
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trueAnalytics.chart_data} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <XAxis 
                            dataKey="name" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{ fill: '#94a3b8', fontSize: 12 }} 
                            dy={10}
                          />
                          <Tooltip 
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                            labelStyle={{ fontWeight: 'bold', color: '#0f172a' }}
                          />
                          <Area 
                            type="monotone" 
                            dataKey="views" 
                            stroke="#3b82f6" 
                            strokeWidth={4}
                            fillOpacity={1} 
                            fill="url(#colorViews)" 
                            activeDot={{ r: 6, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-100 dark:bg-card dark:border-border">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                      <Globe2 className="h-5 w-5 text-green-500" />
                      <h3 className="text-lg font-bold">Top Countries</h3>
                    </div>
                    <span className="text-sm font-medium text-slate-500">{trueAnalytics.top_countries?.length || 0} countries</span>
                  </div>
                  
                  <div className="space-y-6">
                    {trueAnalytics.top_countries?.map((c: any, i: number) => (
                      <div key={i} className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={cn("flex h-6 w-6 items-center justify-center rounded text-xs font-bold", i === 0 ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-600")}>{i + 1}</div>
                          <div className="flex items-center gap-2 font-medium">
                            <Globe2 className={cn("h-4 w-4", i === 0 ? "text-blue-500" : "text-emerald-500")} />
                            {c.country}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold">{c.visitors}</div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-400">visitors</div>
                        </div>
                      </div>
                    ))}
                    {(!trueAnalytics.top_countries || trueAnalytics.top_countries.length === 0) && (
                      <p className="text-sm text-muted-foreground text-center py-4">No location data yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {view === "admin-profile" && isAdmin && (
            <div className="mx-auto max-w-2xl space-y-6 pb-10">
              <div className="flex items-center gap-2">
                <UserCircle className="h-7 w-7 text-indigo-600" />
                <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Admin Profile</h2>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Manage your system administrator credentials.
              </p>

              <Card>
                <CardHeader>
                  <CardTitle>Change Admin Credentials</CardTitle>
                  <CardDescription>Update the username and password used to access this admin portal.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">New Admin Username</label>
                    <Input id="new-admin-user" placeholder="e.g. newadmin" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">New Admin Password</label>
                    <Input id="new-admin-pass" type="password" placeholder="Enter new password" />
                  </div>
                  <Button 
                    className="w-full bg-indigo-600 hover:bg-indigo-700 mt-2"
                    onClick={() => {
                      const user = (document.getElementById('new-admin-user') as HTMLInputElement).value;
                      const pass = (document.getElementById('new-admin-pass') as HTMLInputElement).value;
                      if (!user || !pass) {
                        Swal.fire({ title: "Error", text: "Username and Password cannot be empty", icon: "error" });
                        return;
                      }
                      localStorage.setItem('adminUser', user);
                      localStorage.setItem('adminPass', pass);
                      Swal.fire({ title: "Success", text: "Admin credentials updated! Next time you log in, use these credentials.", icon: "success" });
                      (document.getElementById('new-admin-user') as HTMLInputElement).value = '';
                      (document.getElementById('new-admin-pass') as HTMLInputElement).value = '';
                    }}
                  >
                    Save Changes
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {view === "settings" && (
            <div className="space-y-6">
              {/* API Key */}
              <Card>
                <CardHeader
                  className="cursor-pointer select-none"
                  onClick={() => setShowApiCard((v) => !v)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Gemini API Key</CardTitle>
                      <CardDescription className="mt-1">
                        {apiKey
                          ? <span className="text-emerald-600 font-medium">✅ Key is set — click to manage</span>
                          : <span className="text-amber-600">⚠️ No key set — using system default</span>}
                      </CardDescription>
                    </div>
                    <ChevronDown className={cn("h-5 w-5 text-muted-foreground transition-transform", showApiCard && "rotate-180")} />
                  </div>
                </CardHeader>
                {showApiCard && (
                  <CardContent className="space-y-3">
                    <p className="text-xs text-muted-foreground">Stored only in this browser — never sent anywhere except your local backend.</p>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showApiKey ? "text" : "password"}
                          placeholder="AIza..."
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          className="pr-10 font-mono text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <Button
                        onClick={() => {
                          localStorage.setItem("ai-doc-gemini-key", apiKey);
                          Swal.fire({ title: "Saved!", text: "API key saved!", icon: "success", timer: 1500, showConfirmButton: false });
                        }}
                        disabled={!apiKey.trim()}
                      >
                        Save Key
                      </Button>
                      {apiKey && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setApiKey("");
                            localStorage.removeItem("ai-doc-gemini-key");
                          }}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>

              {/* Appearance */}
              <Card>
                <CardHeader>
                  <CardTitle>Appearance</CardTitle>
                  <CardDescription>Customize the look and feel of the application.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <p className="mb-3 text-sm font-medium">Theme</p>
                    <div className="flex gap-2">
                      {([
                        { key: "light", label: "Light", Icon: Sun },
                        { key: "dark",  label: "Dark",  Icon: Moon },
                        { key: "system",label: "System",Icon: Monitor }
                      ] as const).map(({ key, label, Icon }) => (
                        <button
                          key={key}
                          onClick={() => applyTheme(key)}
                          className={cn(
                            "flex items-center gap-2 rounded-lg border-2 px-4 py-2 text-sm font-medium transition-all hover:border-primary/60",
                            theme === key
                              ? "border-primary bg-accent text-accent-foreground shadow-sm"
                              : "border-border bg-card text-muted-foreground"
                          )}
                        >
                          <Icon className={cn("h-4 w-4", theme === key ? "text-primary" : "")} />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>


              {/* Data */}
              <Card>
                <CardHeader>
                  <CardTitle>Data Management</CardTitle>
                  <CardDescription>Manage locally stored job history saved in this browser.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-48">
                    <p className="text-sm text-muted-foreground">
                      <span className="font-semibold text-foreground">{history.length}</span> job{history.length !== 1 ? "s" : ""} stored &nbsp;·&nbsp;
                      <span className="font-semibold text-foreground">{history.reduce((s, i) => s + (i.processedFiles > 0 ? i.processedFiles : i.totalFiles), 0)}</span> files processed
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      Swal.fire({
                        title: "Clear all history?",
                        text: "This will permanently wipe all job history from this browser.",
                        icon: "warning",
                        showCancelButton: true,
                        confirmButtonColor: "#ef4444",
                        confirmButtonText: "Yes, clear everything"
                      }).then((result) => {
                        if (result.isConfirmed) {
                          saveHistory([]);
                          Swal.fire({ title: "Cleared!", text: "All history has been deleted.", icon: "success", timer: 1500, showConfirmButton: false });
                        }
                      });
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Clear History
                  </Button>
                </CardContent>
              </Card>

              {/* System Admin */}
              <Card className="border-destructive/50">
                <CardHeader>
                  <CardTitle className="text-destructive">System Administration</CardTitle>
                  <CardDescription>Access the full system admin panel.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="destructive" onClick={() => setView("admin-login")}>
                    <Shield className="mr-2 h-4 w-4" />
                    Enter Admin Mode
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function createJob(files: File[]): Job {
  return {
    id: `#${Math.floor(1000 + Math.random() * 9000)}`,
    createdAt: new Date().toISOString(),
    status: "draft",
    logs: [],
    progress: 0,
    files: files.map((file, index) => ({
      id: `${file.name}-${file.size}-${index}`,
      file,
      relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
      status: "queued"
    }))
  };
}

function updateFile(job: Job, fileId: string, patch: Partial<JobFile>, log?: string): Job {
  const files = job.files.map((file) => (file.id === fileId ? { ...file, ...patch } : file));
  const fileProgressMap: Record<JobFile["status"], number> = {
    queued: 0,
    uploading: 10,
    ocr: 40,
    llm: 80,
    saving: 90,
    done: 100,
    failed: 100,
  };
  const totalProgress = files.reduce((acc, f) => acc + (fileProgressMap[f.status] ?? 0), 0);
  return {
    ...job,
    files,
    progress: files.length ? Math.round(totalProgress / files.length) : 0,
    logs: log ? [...job.logs, log] : job.logs
  };
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-3xl font-semibold tracking-normal">{value}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-card p-6 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function JobRow({ activityNumber, files, status, mode }: { activityNumber: number; files: number; status: string; mode?: string }) {
  const isDone = status.toLowerCase().includes("complete");
  const isFailed = status.toLowerCase().includes("fail");
  const action = mode === "rename" ? "Renamed" : "Classified";
  const label = isFailed
    ? `${files} PDF${files !== 1 ? "s" : ""} failed to process`
    : `${action} ${files} PDF${files !== 1 ? "s" : ""}${isDone ? " successfully" : "..."}`;
  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-4">
      <div>
        <p className="font-medium">Activity {activityNumber}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
      {isFailed ? <XCircle className="h-5 w-5 text-red-500" /> : isDone ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Clock className="h-5 w-5 text-blue-600" />}
    </div>
  );
}

function StatusPanel({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-2 font-medium">{value}</p>
    </div>
  );
}

function Step({ label, complete, active }: { label: string; complete?: boolean; active?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {complete ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : active ? <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> : <div className="h-4 w-4 rounded-sm border" />}
      <span>{label}</span>
    </div>
  );
}

function toResultPayload(file: JobFile) {
  return {
    fileName: file.file.name,
    category: file.category ?? "Other",
    status: file.status,
    extracted: file.extracted ?? {},
    text: file.text ?? "",
    error: file.error ?? null
  };
}

async function writeBlob(handle: any, blob: Blob) {
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
