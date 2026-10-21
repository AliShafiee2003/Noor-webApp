import sys
sys.stdout.reconfigure(encoding='utf-8')
import sqlite3
import glob
import os

discs = [
    ('00136', 'D:/Noor/00136/Data/library.db'),
    ('00248', 'D:/Noor/00248/Data/library.db'),
    ('00285', 'D:/Noor/00285/Data/library.db'),
]

for disc_id, lib_db in discs:
    if not os.path.exists(lib_db):
        continue
    print(f"=== Disc {disc_id}: {lib_db} ===")
    conn = sqlite3.connect(lib_db)
    c = conn.cursor()
    tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print(f"Tables ({len(tables)}):", tables)
    for t in tables:
        cols = [col[1] for col in c.execute(f"PRAGMA table_info({t})").fetchall()]
        count = c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"  {t} ({count} rows): {cols}")
        # Sample 1 row if available
        if count > 0:
            sample = c.execute(f"SELECT * FROM {t} LIMIT 1").fetchone()
            print(f"    sample: {sample}")
    conn.close()
