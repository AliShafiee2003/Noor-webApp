import sys
sys.stdout.reconfigure(encoding='utf-8')
import sqlite3, os
from inspect_subjects import discs

custom_domains = []
for disc_id, lib_db in discs:
    if not os.path.exists(lib_db): continue
    conn = sqlite3.connect(lib_db)
    c = conn.cursor()
    try:
        rows = c.execute("""
            SELECT d.id, d.title, d.parent, COUNT(di.value) 
            FROM Domain d 
            LEFT JOIN Domain_ids di ON d.id = di.object_id 
            WHERE d.title NOT IN ('root', 'All Books', 'Favorite Books', 'Recent Books', 'Related Books')
            GROUP BY d.id
        """).fetchall()
        for r in rows:
            custom_domains.append((disc_id, r[0], r[1], r[2], r[3]))
    except:
        pass
    conn.close()

print(f"Total custom domain categories: {len(custom_domains)}")
for d in custom_domains[:40]:
    print(f"[{d[0]}] {d[2]} ({d[4]} books)")
