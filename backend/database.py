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
                user_id TEXT,
                filename TEXT,
                category TEXT,
                extracted JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS job_history (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                history_data JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()
        # Safely try to add user_id to existing extracted_data table if it doesn't exist
        try:
            c.execute("ALTER TABLE extracted_data ADD COLUMN IF NOT EXISTS user_id TEXT;")
        except:
            conn.rollback() # column might already exist
        conn.commit()
        conn.close()
    else:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('''
            CREATE TABLE IF NOT EXISTS extracted_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                filename TEXT,
                category TEXT,
                extracted JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS job_history (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                history_data JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        try:
            c.execute("ALTER TABLE extracted_data ADD COLUMN user_id TEXT;")
        except:
            pass
        conn.commit()
        conn.close()

def save_extracted_data(user_id: str, filename: str, category: str, extracted: dict):
    if DATABASE_URL:
        conn = psycopg2.connect(DATABASE_URL)
        c = conn.cursor()
        c.execute('''
            INSERT INTO extracted_data (user_id, filename, category, extracted)
            VALUES (%s, %s, %s, %s)
            RETURNING id
        ''', (user_id, filename, category, json.dumps(extracted)))
        row_id = c.fetchone()[0]
        conn.commit()
        conn.close()
        return row_id
    else:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('''
            INSERT INTO extracted_data (user_id, filename, category, extracted)
            VALUES (?, ?, ?, ?)
        ''', (user_id, filename, category, json.dumps(extracted)))
        row_id = c.lastrowid
        conn.commit()
        conn.close()
        return row_id

def get_all_extracted_data(user_id: str):
    if DATABASE_URL:
        conn = psycopg2.connect(DATABASE_URL)
        c = conn.cursor()
        c.execute('SELECT id, filename, category, extracted, created_at FROM extracted_data WHERE user_id = %s ORDER BY created_at DESC', (user_id,))
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
        c.execute('SELECT id, filename, category, extracted, created_at FROM extracted_data WHERE user_id = ? ORDER BY created_at DESC', (user_id,))
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

def save_job_history(user_id: str, job_id: str, history_data: list):
    if not user_id:
        return
    if DATABASE_URL:
        conn = psycopg2.connect(DATABASE_URL)
        c = conn.cursor()
        c.execute('''
            INSERT INTO job_history (id, user_id, history_data)
            VALUES (%s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET history_data = EXCLUDED.history_data, updated_at = CURRENT_TIMESTAMP
        ''', (job_id, user_id, json.dumps(history_data)))
        conn.commit()
        conn.close()
    else:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('''
            INSERT INTO job_history (id, user_id, history_data)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET history_data = excluded.history_data, updated_at = CURRENT_TIMESTAMP
        ''', (job_id, user_id, json.dumps(history_data)))
        conn.commit()
        conn.close()

def get_job_history(user_id: str):
    if not user_id:
        return []
    if DATABASE_URL:
        conn = psycopg2.connect(DATABASE_URL)
        c = conn.cursor()
        c.execute('SELECT history_data FROM job_history WHERE user_id = %s ORDER BY updated_at DESC LIMIT 1', (user_id,))
        row = c.fetchone()
        conn.close()
        if row and row[0]:
            return row[0] if isinstance(row[0], list) else json.loads(row[0])
        return []
    else:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('SELECT history_data FROM job_history WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1', (user_id,))
        row = c.fetchone()
        conn.close()
        if row and row[0]:
            return json.loads(row[0])
        return []


def get_admin_stats():
    stats = {'total_documents': 0, 'top_users': [], 'top_categories': []}
    if DATABASE_URL:
        conn = psycopg2.connect(DATABASE_URL)
        c = conn.cursor()
        c.execute('SELECT COUNT(*) FROM extracted_data')
        stats['total_documents'] = c.fetchone()[0]
        c.execute('SELECT user_id, COUNT(*) as count FROM extracted_data GROUP BY user_id ORDER BY count DESC LIMIT 10')
        stats['top_users'] = [{'user_id': row[0], 'count': row[1]} for row in c.fetchall()]
        c.execute('SELECT category, COUNT(*) as count FROM extracted_data GROUP BY category ORDER BY count DESC LIMIT 10')
        stats['top_categories'] = [{'category': row[0], 'count': row[1]} for row in c.fetchall()]
        conn.close()
    else:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('SELECT COUNT(*) FROM extracted_data')
        stats['total_documents'] = c.fetchone()[0]
        c.execute('SELECT user_id, COUNT(*) as count FROM extracted_data GROUP BY user_id ORDER BY count DESC LIMIT 10')
        stats['top_users'] = [{'user_id': row[0], 'count': row[1]} for row in c.fetchall()]
        c.execute('SELECT category, COUNT(*) as count FROM extracted_data GROUP BY category ORDER BY count DESC LIMIT 10')
        stats['top_categories'] = [{'category': row[0], 'count': row[1]} for row in c.fetchall()]
        conn.close()
    return stats



def log_analytics_event(event_type: str, ip_address: str, country: str):
    if DATABASE_URL:
        conn = psycopg2.connect(DATABASE_URL)
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS analytics (id SERIAL PRIMARY KEY, event_type TEXT, ip_address TEXT, country TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        c.execute('INSERT INTO analytics (event_type, ip_address, country) VALUES (%s, %s, %s)', (event_type, ip_address, country))
        conn.commit()
        conn.close()
    else:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS analytics (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT, ip_address TEXT, country TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        c.execute('INSERT INTO analytics (event_type, ip_address, country) VALUES (?, ?, ?)', (event_type, ip_address, country))
        conn.commit()
        conn.close()

def get_analytics_stats(timeframe: str = 'today'):
    import datetime
    stats = {'page_views': 0, 'unique_ips': 0, 'button_clicks': 0, 'top_countries': []}
    try:
        now = datetime.datetime.utcnow()
        if timeframe == 'today':
            start_date = now.replace(hour=0, minute=0, second=0, microsecond=0)
        elif timeframe == 'yesterday':
            start_date = (now - datetime.timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            now = start_date + datetime.timedelta(days=1)
        elif timeframe == '7days':
            start_date = now - datetime.timedelta(days=7)
        elif timeframe == '30days':
            start_date = now - datetime.timedelta(days=30)
        else:
            start_date = now.replace(hour=0, minute=0, second=0, microsecond=0)

        start_str = start_date.strftime('%Y-%m-%d %H:%M:%S')
        end_str = now.strftime('%Y-%m-%d %H:%M:%S')

        if DATABASE_URL:
            conn = psycopg2.connect(DATABASE_URL)
            c = conn.cursor()
            c.execute("SELECT COUNT(*) FROM analytics WHERE event_type='page_view' AND created_at >= %s AND created_at < %s", (start_str, end_str))
            stats['page_views'] = c.fetchone()[0]
            c.execute("SELECT COUNT(DISTINCT ip_address) FROM analytics WHERE created_at >= %s AND created_at < %s", (start_str, end_str))
            stats['unique_ips'] = c.fetchone()[0]
            c.execute("SELECT COUNT(*) FROM analytics WHERE event_type='button_click' AND created_at >= %s AND created_at < %s", (start_str, end_str))
            stats['button_clicks'] = c.fetchone()[0]
            c.execute("SELECT country, COUNT(DISTINCT ip_address) as c FROM analytics WHERE country IS NOT NULL AND country != '' AND created_at >= %s AND created_at < %s GROUP BY country ORDER BY c DESC LIMIT 5", (start_str, end_str))
            stats['top_countries'] = [{'country': r[0], 'visitors': r[1]} for r in c.fetchall()]
            conn.close()
        else:
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("SELECT COUNT(*) FROM analytics WHERE event_type='page_view' AND created_at >= ? AND created_at < ?", (start_str, end_str))
            stats['page_views'] = c.fetchone()[0]
            c.execute("SELECT COUNT(DISTINCT ip_address) FROM analytics WHERE created_at >= ? AND created_at < ?", (start_str, end_str))
            stats['unique_ips'] = c.fetchone()[0]
            c.execute("SELECT COUNT(*) FROM analytics WHERE event_type='button_click' AND created_at >= ? AND created_at < ?", (start_str, end_str))
            stats['button_clicks'] = c.fetchone()[0]
            c.execute("SELECT country, COUNT(DISTINCT ip_address) as c FROM analytics WHERE country IS NOT NULL AND country != '' AND created_at >= ? AND created_at < ? GROUP BY country ORDER BY c DESC LIMIT 5", (start_str, end_str))
            stats['top_countries'] = [{'country': r[0], 'visitors': r[1]} for r in c.fetchall()]
            conn.close()
    except Exception as e:
        print('Analytics table might not exist yet:', e)
    return stats

