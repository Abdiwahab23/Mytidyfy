import os
import json
import sqlite3
from pathlib import Path

try:
    import psycopg2
except ImportError:
    psycopg2 = None

DATABASE_URL = os.environ.get("DATABASE_URL")
DB_PATH = Path(__file__).parent / "extractor.db"

def init_db():
    if DATABASE_URL:
        conn = psycopg2.connect(DATABASE_URL)
        c = conn.cursor()
        c.execute('''
            CREATE TABLE IF NOT EXISTS extracted_data (
                id SERIAL PRIMARY KEY,
                filename TEXT,
                category TEXT,
                extracted JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()
        conn.close()
    else:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('''
            CREATE TABLE IF NOT EXISTS extracted_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT,
                category TEXT,
                extracted JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()
        conn.close()

def save_extracted_data(filename: str, category: str, extracted: dict):
    if DATABASE_URL:
        conn = psycopg2.connect(DATABASE_URL)
        c = conn.cursor()
        c.execute('''
            INSERT INTO extracted_data (filename, category, extracted)
            VALUES (%s, %s, %s)
            RETURNING id
        ''', (filename, category, json.dumps(extracted)))
        row_id = c.fetchone()[0]
        conn.commit()
        conn.close()
        return row_id
    else:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('''
            INSERT INTO extracted_data (filename, category, extracted)
            VALUES (?, ?, ?)
        ''', (filename, category, json.dumps(extracted)))
        row_id = c.lastrowid
        conn.commit()
        conn.close()
        return row_id

def get_all_extracted_data():
    if DATABASE_URL:
        conn = psycopg2.connect(DATABASE_URL)
        c = conn.cursor()
        c.execute('SELECT id, filename, category, extracted, created_at FROM extracted_data ORDER BY created_at DESC')
        rows = c.fetchall()
        conn.close()
        
        results = []
        for row in rows:
            results.append({
                "id": row[0],
                "filename": row[1],
                "category": row[2],
                "extracted": row[3] if isinstance(row[3], dict) else (json.loads(row[3]) if row[3] else {}),
                "created_at": str(row[4])
            })
        return results
    else:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('SELECT id, filename, category, extracted, created_at FROM extracted_data ORDER BY created_at DESC')
        rows = c.fetchall()
        conn.close()
        
        results = []
        for row in rows:
            results.append({
                "id": row[0],
                "filename": row[1],
                "category": row[2],
                "extracted": json.loads(row[3]) if row[3] else {},
                "created_at": row[4]
            })
        return results
