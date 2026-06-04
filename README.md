# MyTidyfy 🚀

**Your AI-Powered Document Organizer — Organize, Rename, Extract it.**

MyTidyfy is a modern, privacy-first web application that uses advanced Artificial Intelligence (Google Gemini 2.5 Flash) to automate your document management. Say goodbye to manual data entry and messy folders.

![MyTidyfy Architecture](https://img.shields.io/badge/Next.js-Frontend-blue) ![MyTidyfy API](https://img.shields.io/badge/FastAPI-Backend-green) ![AI Engine](https://img.shields.io/badge/Gemini-2.5_Flash-orange)

## ✨ Core Features

*   **📂 Smart Classify:** Select a messy folder of PDFs, and MyTidyfy will automatically read the contents and move them into categorized sub-folders (e.g., `Invoices`, `Receipts`, `Contracts`, `HR Documents`).
*   **✏️ Smart Rename:** Tired of files named `Scan_2023_992.pdf`? The AI analyzes the document and intelligently renames it based on its actual contents (e.g., `Google_Cloud_Invoice_Oct_2023.pdf`).
*   **📊 Smart Extract (Data Mining):** Upload dozens of documents and ask the AI to extract specific data (like "Vendor", "Total Amount", "Tax", "Date"). Review the results in a beautiful ledger and export everything directly to an **Excel (.xlsx)** file.
*   **🔒 Local File System API:** MyTidyfy uses the browser's modern File System Access API. Your files are processed securely and saved *directly* back to your local hard drive.

## 🛠️ Tech Stack

*   **Frontend:** Next.js (React), Tailwind CSS, Shadcn UI, SweetAlert2
*   **Backend:** Python, FastAPI, SQLite
*   **AI Engine:** Google Generative AI (Gemini Flash)
*   **Data Export:** SheetJS (Excel Generation)

---

## 🚀 Running Locally

You will need both **Node.js** and **Python 3.10+** installed on your machine.

### 1. Setup the Backend (Python)
Navigate to your project root and set up a virtual environment:
```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

Set your Gemini API Key. (You can get one from [Google AI Studio](https://aistudio.google.com/)):
```powershell
# Create a .env file in the root directory
GEMINI_API_KEY=your_google_gemini_key_here
```

Start the FastAPI server:
```powershell
uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000
```

### 2. Setup the Frontend (Next.js)
Open a new terminal window in the project root:
```powershell
npm install
npm run dev
```

Open `http://localhost:3000` in your browser. You're ready to automate!

---

## 🌍 Deployment Guide (Public Launch)

MyTidyfy uses a split architecture. To host this publicly on your own domain (e.g., `mytidyfy.com`), you need to deploy the frontend and backend separately.

### Deploy the Backend (Render.com)
1. Create a **New Web Service** on Render.
2. Connect this GitHub repository.
3. Build Command: `pip install -r requirements.txt`
4. Start Command: `uvicorn backend.app:app --host 0.0.0.0 --port $PORT`
5. Add `GEMINI_API_KEY` to your Render Environment Variables.
6. *(Optional)*: Mount a Persistent Disk to `/data` and update `database.py` to point to it so your extraction history persists across server restarts.

### Deploy the Frontend (Netlify or Vercel)
1. Create a new site on Netlify.
2. Connect this GitHub repository. Netlify will auto-detect Next.js.
3. In Environment Variables, add:
   * `NEXT_PUBLIC_API_URL` = `https://your-render-app-url.onrender.com`
4. Deploy! Connect your custom domain in the Netlify settings.

---

*Built with ❤️ for document automation.*
