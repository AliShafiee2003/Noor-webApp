import sys
sys.stdout.reconfigure(encoding='utf-8')
import json
import sqlite3
import os
from inspect_subjects import discs

# Load current catalog
with open('D:/Noor/app_development/mini-services/noor-api/data/sources/catalog.json', 'r', encoding='utf-8') as f:
    catalog = json.load(f)

print(f"Loaded {len(catalog)} works from catalog.json")

# Map of (disc_id, series_id) -> work in catalog
# Note: catalog UID is "w-{disc_id}-{series_id}" (e.g. "w-00136-00372")
works_by_key = {}
for w in catalog:
    works_by_key[w['uid']] = w

# Now extract metadata from all discs
books_with_subjects = 0
books_with_domains = 0
lang_updates = 0

for disc_id, lib_db in discs:
    if not os.path.exists(lib_db):
        continue
    conn = sqlite3.connect(lib_db)
    c = conn.cursor()
    
    # 1. Subjects
    subj_map = {}
    try:
        for sid, sname in c.execute("SELECT id, name FROM Subject").fetchall():
            subj_map[sid] = sname.strip()
    except:
        pass
        
    series_subjects = {}
    try:
        for ser_id, sub_id in c.execute("SELECT seriesId, subjectId FROM SeriesSubject").fetchall():
            s_key = str(ser_id).zfill(5)
            if sub_id in subj_map:
                series_subjects.setdefault(s_key, []).append(subj_map[sub_id])
    except:
        pass
        
    # 2. Languages
    series_langs = {}
    try:
        for ser_id, lval in c.execute("SELECT id, value FROM Series_languages").fetchall():
            s_key = str(ser_id).zfill(5)
            series_langs[s_key] = lval.strip()
    except:
        pass

    # 3. Domains
    dom_map = {}
    try:
        for did, dtitle in c.execute("SELECT id, title FROM Domain WHERE title NOT IN ('root', 'All Books', 'Favorite Books', 'Recent Books', 'Related Books')").fetchall():
            dom_map[did] = dtitle.strip()
    except:
        pass
        
    series_domains = {}
    try:
        for did, val in c.execute("SELECT object_id, value FROM Domain_ids").fetchall():
            s_key = str(val).zfill(5)
            if did in dom_map:
                series_domains.setdefault(s_key, []).append(dom_map[did])
    except:
        pass

    # Now apply to catalog works for this disc
    for ser_id_str, subs in series_subjects.items():
        uid = f"w-{disc_id}-{ser_id_str}"
        if uid in works_by_key:
            books_with_subjects += 1
            
    for ser_id_str, lval in series_langs.items():
        uid = f"w-{disc_id}-{ser_id_str}"
        if uid in works_by_key:
            lang_updates += 1

    conn.close()

print(f"Books matching SeriesSubject: {books_with_subjects}")
print(f"Books matching Series_languages: {lang_updates}")
