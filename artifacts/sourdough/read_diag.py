import sqlite3
import json

conn = sqlite3.connect('E:/Bread-Lab/artifacts/sourdough/RKStorage.db')
cursor = conn.cursor()
cursor.execute('SELECT value FROM catalystLocalStorage WHERE key=?', ('bread_lab_share_diag_logs_v1',))
row = cursor.fetchone()

if row:
    logs = json.loads(row[0])
    logs.reverse() # Sort in chronological order
    print(json.dumps(logs, indent=2))
else:
    print("NO DIAG LOGS FOUND")
