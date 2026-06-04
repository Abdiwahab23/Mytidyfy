import os
import sys
import shutil
import subprocess
import pyautogui
import base64
import datetime
import tempfile
import json
from collections import defaultdict
# Doctr imports are loaded lazily inside ClassificationThread to avoid import-time hangs.
from openai import OpenAI
from PyQt6.QtWidgets import QApplication, QMainWindow, QMessageBox, QSystemTrayIcon, QLabel
from PyQt6.QtGui import QIcon, QFont
from PyQt6.QtCore import QThread, pyqtSignal, Qt, QTimer
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import inch

# Gmail API imports
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Gmail API scope
SCOPES = ["https://www.googleapis.com/auth/gmail.send"]

# Lazy load OCR model (loaded only when needed)
model = None

# OpenAI client (consider moving this to env var for security)
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", "YOUR_API_KEY_HERE"))

# ---------------- Embedded credentials ----------------
# If you don't want a separate credentials.json file, the JSON can be embedded here.
# WARNING: embedding secrets in the binary is convenient but less secure.
EMBEDDED_GOOGLE_CREDENTIALS = r'''
{"installed":{"client_id":"YOUR_CLIENT_ID","project_id":"YOUR_PROJECT_ID","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_secret":"YOUR_CLIENT_SECRET","redirect_uris":["http://localhost"]}}
'''

# Filenames stored in the system temp folder so EXE can write/read them regardless of working dir
_TEMP_DIR = tempfile.gettempdir()
_EMBEDDED_CRED_PATH = os.path.join(_TEMP_DIR, "docusort_credentials.json")
_TOKEN_PATH = os.path.join(_TEMP_DIR, "docusort_token.json")


def ensure_embedded_credentials():
    """Write embedded credentials to a temp file if it doesn't exist."""
    # If user provided a credentials.json next to the exe/script, prefer that one
    exe_dir = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    external_cred = os.path.join(exe_dir, "Doccredentials.json")
    if os.path.exists(external_cred):
        return external_cred

    if not os.path.exists(_EMBEDDED_CRED_PATH):
        with open(_EMBEDDED_CRED_PATH, "w", encoding="utf-8") as f:
            f.write(EMBEDDED_GOOGLE_CREDENTIALS)
    return _EMBEDDED_CRED_PATH


# ---------------- Gmail API Helpers ----------------
def gmail_authenticate():
    """Authenticate with Gmail.

    Behavior:
    - If a credentials.json exists next to the exe/script it will be used.
    - Otherwise the embedded credentials will be written to the system temp folder and used.
    - token (refreshable) is stored in the system temp folder so subsequent runs are silent.
    """
    creds = None

    token_path = _TOKEN_PATH
    creds_path = ensure_embedded_credentials()

    # load existing token if present
    if os.path.exists(token_path):
        try:
            creds = Credentials.from_authorized_user_file(token_path, SCOPES)
        except Exception:
            creds = None

    # If there are no (valid) credentials available, let the user log in.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except Exception:
                creds = None

        if not creds:
            flow = InstalledAppFlow.from_client_secrets_file(creds_path, SCOPES)
            creds = flow.run_local_server(port=0)

        # Save the credentials for the next run
        with open(token_path, "w", encoding="utf-8") as token:
            token.write(creds.to_json())

    service = build("gmail", "v1", credentials=creds)
    return service


def send_email_with_report(service, report_path, recipient="abdiwahaabaadam5@gmail.com"):
    sender = "me"  # "me" = authenticated Gmail user

    # Email body
    msg = MIMEMultipart()
    msg["To"] = recipient
    msg["Subject"] = "Daily Tasks Report"
    msg.attach(MIMEText("Hello,\n\nPlease find attached the classification report.\n\nRegards,\nDocuSort AI Robot"))

    # Attach the report
    try:
        with open(report_path, "rb") as f:
            attachment = MIMEApplication(f.read(), Name=os.path.basename(report_path))
        attachment["Content-Disposition"] = f'attachment; filename="{os.path.basename(report_path)}"'
        msg.attach(attachment)
    except Exception as e:
        raise RuntimeError(f"Failed to attach report: {e}")

    # Encode and send
    raw_message = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    message = {"raw": raw_message}
    try:
        service.users().messages().send(userId=sender, body=message).execute()
        print("✅ Email sent successfully!")
    except Exception as e:
        raise RuntimeError(f"Failed to send email via Gmail API: {e}")


# ---------------- PDF Report Generation ----------------
def create_pdf_report(results, output_folder, total_docs):
    # Create filename with timestamp
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    report_filename = f"Daily_Task_Report_{timestamp}.pdf"
    report_path = os.path.join(output_folder, report_filename)

    # Create the PDF document
    doc = SimpleDocTemplate(report_path, pagesize=letter)
    styles = getSampleStyleSheet()

    # Custom styles
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=20,
        spaceAfter=30,
        alignment=1  # Center aligned
    )

    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontSize=14,
        spaceAfter=12
    )

    normal_style = styles['Normal']

    # Build the story (content)
    story = []

    # Title
    story.append(Paragraph("Daily Classification Report", title_style))

    # Date and time
    current_date = datetime.datetime.now().strftime("%B %d, %Y")
    current_time = datetime.datetime.now().strftime("%I:%M %p")

    story.append(Paragraph(f"Date: {current_date}", normal_style))
    story.append(Paragraph(f"Time: {current_time}", normal_style))
    story.append(Spacer(1, 20))

    # Summary
    story.append(Paragraph("Summary", heading_style))
    story.append(Paragraph(f"Total documents processed: {total_docs}", normal_style))
    story.append(Spacer(1, 10))

    # Classification results table
    if results:
        data = [["Category", "Count"]]
        for category, count in results.items():
            data.append([category, str(count)])

        # Create table
        table = Table(data)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 12),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 10),
            ('GRID', (0, 0), (-1, -1), 1, colors.black)
        ]))

        story.append(table)
    else:
        story.append(Paragraph("No documents were processed.", normal_style))

    story.append(Spacer(1, 30))

    # Footer
    story.append(Paragraph("Report Prepared by DocuSort AI Robot", normal_style))
    story.append(Paragraph("Thank you. Enjoy — I'm handling this job for you!", normal_style))

    # Build PDF
    doc.build(story)

    return report_path


# ---------------- OCR + Classification ----------------
def find_folder(folder_name, search_paths=None):
    if search_paths is None:
        search_paths = [f"{chr(d)}:\\" for d in range(67, 91) if os.path.exists(f"{chr(d)}:\\")]
    for base_path in search_paths:
        for root, dirs, _ in os.walk(base_path):
            if folder_name.lower() in [d.lower() for d in dirs]:
                return os.path.join(root, folder_name)
    return None


class WarningOverlay(QLabel):
    def __init__(self):
        super().__init__()
        self.setWindowFlags(Qt.WindowType.WindowStaysOnTopHint |
                            Qt.WindowType.FramelessWindowHint |
                            Qt.WindowType.Tool)
        self.setText("<div style='text-align:center;'>🤖<br>"
                     "<span style='font-size:22px; font-weight:bold;'>AI Robot is working...</span><br>"
                     "<span style='font-size:18px;'>Please wait...</span></div>")
        self.setStyleSheet(
            "background-color: rgba(173, 216, 230, 0.95);"
            "color: white;"
            "font-family: 'Segoe UI', Arial, sans-serif;"
            "padding: 25px;"
            "border-radius: 15px;"
            "box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.3);"
        )
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.resize(400, 120)
        screen = QApplication.primaryScreen().geometry()
        self.move(screen.center().x() - self.width() // 2,
                  screen.center().y() - self.height() // 2)


class ClassificationThread(QThread):
    message = pyqtSignal(str)
    result = pyqtSignal(dict, int)  # Now also sends total document count

    def __init__(self, pdf_folder, output_folder):
        super().__init__()
        self.pdf_folder = pdf_folder
        self.output_folder = output_folder
        self.classification_report = defaultdict(int)
        self.total_docs = 0

    def run(self):
        global model
        doctr_available = False
        DocumentFile = None
        ocr_predictor = None

        try:
            from doctr.io import DocumentFile as _DocumentFile
            from doctr.models import ocr_predictor as _ocr_predictor
            DocumentFile = _DocumentFile
            ocr_predictor = _ocr_predictor
            doctr_available = True
        except Exception as e:
            self.message.emit(f"doctr import failed: {e}")

        if doctr_available and model is None:
            self.message.emit("Loading OCR model...")
            try:
                model = ocr_predictor(pretrained=True)
            except Exception as e:
                self.message.emit(f"Failed to load OCR model: {e}")
                model = None
                doctr_available = False

        pdf_files = [f for f in os.listdir(self.pdf_folder) if f.lower().endswith(".pdf")]
        self.total_docs = len(pdf_files)

        for pdf_file in pdf_files:
            pdf_path = os.path.join(self.pdf_folder, pdf_file)
            self.message.emit(f"Processing: {pdf_file}")
            try:
                # Move mouse to a corner but don't worry if it gets moved by user
                try:
                    pyautogui.moveTo(200, 200, duration=0.5)
                except:
                    pass  # Ignore mouse movement errors

                text_snippet = ""
                if doctr_available and model is not None and DocumentFile is not None:
                    try:
                        doc = DocumentFile.from_pdf(pdf_path)
                        result = model(doc)
                        text_snippet = self.extract_snippet(result)
                    except Exception as e:
                        self.message.emit(f"OCR failed for {pdf_file}: {e}")

                if not text_snippet.strip():
                    text_snippet = pdf_file

                boosted = self.keyword_boost(text_snippet)
                category = self.classify_text(boosted)

                category_folder = os.path.join(self.output_folder, category)
                os.makedirs(category_folder, exist_ok=True)
                shutil.copy2(pdf_path, os.path.join(category_folder, pdf_file))

                self.classification_report[category] += 1

                # Move mouse again but don't worry if it fails
                try:
                    pyautogui.moveTo(800, 600, duration=0.5)
                except:
                    pass  # Ignore mouse movement errors

            except Exception as e:
                self.message.emit(f"❌ Failed {pdf_file}: {str(e)}")
                self.classification_report["Failed"] += 1

        self.result.emit(self.classification_report, self.total_docs)

    def extract_snippet(self, result):
        all_lines = []
        for page in result.pages:
            for block in page.blocks:
                for line in block.lines:
                    words = [word.value for word in line.words]
                    all_lines.append(" ".join(words))
        # Safe slicing if there are fewer lines
        n = len(all_lines)
        lines = []
        if n == 0:
            return ""
        lines.extend(all_lines[:min(15, n)])
        mid = n // 2
        lines.extend(all_lines[mid: mid + min(5, max(0, n - mid))])
        lines.extend(all_lines[max(0, n-5):])
        return "\n".join(lines)

    def keyword_boost(self, snippet):
        keywords = {
            "Invoice": ["invoice", "total", "amount", "balance", "bill"],
            "Contract": ["contract", "agreement", "terms", "conditions", "services"],
            "HR Document": ["salary", "payslip", "offer letter", "employee", "position"],
            "Receipt": ["receipt", "payment received", "thank you for your purchase", "item", "qty"]
        }
        found = []
        snippet_lower = snippet.lower()
        for category, keys in keywords.items():
            if any(word in snippet_lower for word in keys):
                found.append(category)
        if found:
            snippet += f"\n\n[Detected keywords suggest: {', '.join(found)}]"
        return snippet

    def classify_text(self, text_snippet):
        prompt = f"""
        Classify this document as one of:
        - Receipt
        - Invoice
        - Contract
        - HR Document
        - Other

        Text:
        {text_snippet}

        Respond with only the category.
        """
        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=10
            )
            return response.choices[0].message.content.strip()
        except Exception:
            # If OpenAI fails, try to classify based on keywords
            text_lower = text_snippet.lower()
            if any(word in text_lower for word in ["invoice", "total", "amount", "balance", "bill"]):
                return "Invoice"
            elif any(word in text_lower for word in ["contract", "agreement", "terms", "conditions"]):
                return "Contract"
            elif any(word in text_lower for word in ["salary", "payslip", "employee", "position"]):
                return "HR Document"
            elif any(word in text_lower for word in ["receipt", "payment received", "thank you for your purchase"]):
                return "Receipt"
            else:
                return "Other"


class PDFClassifierUI(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("AI PDF Auto Classifier")
        # If you bundle an icon, PyInstaller places it next to the exe in _MEIPASS; resource handling left as default
        try:
            self.setWindowIcon(QIcon("icon.ico"))
        except Exception:
            pass

        self.tray_icon = QSystemTrayIcon(QIcon("icon.ico") if os.path.exists("icon.ico") else QIcon(), self)
        self.tray_icon.show()

        self.warning_overlay = WarningOverlay()
        self.output_folder = os.path.join(os.path.expanduser("~"), "Desktop", "classified")
        os.makedirs(self.output_folder, exist_ok=True)

        self.tray_icon.showMessage("AI Robot 🤖", "Heeey! Time for AI job 😎",
                                   QSystemTrayIcon.MessageIcon.Information)

        QTimer.singleShot(1000, self.search_folder)

    def search_folder(self):
        self.tray_icon.showMessage("AI Robot 🤖", "🔍 Now searching for folder...",
                                   QSystemTrayIcon.MessageIcon.Information)
        self.pdf_folder = find_folder("scannedpdfs")

        if self.pdf_folder:
            QTimer.singleShot(1000, self.start_classification)
        else:
            QMessageBox.warning(self, "Error", f"'scannedpdfs' folder not found.")
            self.tray_icon.showMessage("AI Robot 🤖",
                                       "❌ No 'scannedpdfs' folder found!",
                                       QSystemTrayIcon.MessageIcon.Critical)

    def start_classification(self):
        self.tray_icon.showMessage("AI Robot 🤖", "⚡ Now doing classification...",
                                   QSystemTrayIcon.MessageIcon.Information)
        try:
            subprocess.Popen(f'explorer "{self.pdf_folder}"')
        except Exception:
            pass
        self.warning_overlay.show()

        self.classification_thread = ClassificationThread(self.pdf_folder, self.output_folder)
        self.classification_thread.message.connect(self.log_message)
        self.classification_thread.result.connect(self.classification_finished)
        self.classification_thread.start()

    def log_message(self, msg):
        """Log messages from the classification thread"""
        print(msg)

    def classification_finished(self, results, total_docs):
        self.warning_overlay.hide()
        self.tray_icon.showMessage("AI Robot 🤖", "✅ Classification completed!",
                                   QSystemTrayIcon.MessageIcon.Information)
        try:
            subprocess.Popen(f'explorer "{self.output_folder}"')
        except Exception:
            pass

        # Create PDF report
        report_path = create_pdf_report(results, self.output_folder, total_docs)

        # Send email 📧
        try:
            service = gmail_authenticate()
            send_email_with_report(service, report_path)
            QMessageBox.information(self, "Email Sent", "Report sent successfully ✅")
        except Exception as e:
            QMessageBox.warning(self, "Email Error", f"Failed to send email: {str(e)}")

        # Add a short delay before shutting down
        QTimer.singleShot(2000, self.shutdown_application)

    def shutdown_application(self):
        """Gracefully shutdown the application"""
        # Show a final message
        self.tray_icon.showMessage("AI Robot 🤖", "All tasks completed! Shutting down...",
                                   QSystemTrayIcon.MessageIcon.Information)

        # Add a small delay to ensure the message is seen
        QTimer.singleShot(1000, self.force_shutdown)

    def force_shutdown(self):
        """Force the application to quit"""
        QApplication.instance().quit()
        sys.exit(0)


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = PDFClassifierUI()
    window.show()
    sys.exit(app.exec())
