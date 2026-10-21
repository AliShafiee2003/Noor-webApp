import sys
sys.stdout.reconfigure(encoding='utf-8')
import json
import sqlite3
import os

CATALOG_PATH = 'D:/Noor/app_development/mini-services/noor-api/data/sources/catalog.json'

with open(CATALOG_PATH, 'r', encoding='utf-8') as f:
    catalog = json.load(f)

print(f"Loaded {len(catalog)} works from {CATALOG_PATH}")

works_by_uid = {w['uid']: w for w in catalog}

discs = [
    ('00136', 'D:/Noor/00136/Data/library.db'),
    ('00156', 'D:/Noor/00156/Data/library.db'),
    ('00166', 'D:/Noor/00166/Data/library.db'),
    ('00168', 'D:/Noor/00168/Data/library.db'),
    ('00238', 'D:/Noor/00238/Data/library.db'),
    ('00239', 'D:/Noor/00239/Data/library.db'),
    ('00240', 'D:/Noor/00240/Data/library.db'),
    ('00242', 'D:/Noor/00242/Data/library.db'),
    ('00244_nested', 'D:/Noor/00244/00242/Data/library.db'),
    ('00244', 'D:/Noor/00244/Data/library.db'),
    ('00246', 'D:/Noor/00246/Data/library.db'),
    ('00248', 'D:/Noor/00248/Data/library.db'),
    ('00249', 'D:/Noor/00249/Data/library.db'),
    ('00250', 'D:/Noor/00250/Data/library.db'),
    ('00262', 'D:/Noor/00262/Data/library.db'),
    ('00264', 'D:/Noor/00264/Data/Files/NahjLibrary/Data/library.db'),
    ('00266', 'D:/Noor/00266/Data/library.db'),
    ('00269', 'D:/Noor/00269/Data/library.db'),
    ('00283', 'D:/Noor/00283/Data/library.db'),
    ('00284', 'D:/Noor/00284/Data/library.db'),
    ('00285', 'D:/Noor/00285/Data/library.db')
]

topics_updated = 0
langs_updated = 0

for disc_id, lib_db in discs:
    if not os.path.exists(lib_db):
        continue
    conn = sqlite3.connect(lib_db)
    c = conn.cursor()
    
    # Subjects
    subj_map = {}
    try:
        for sid, sname in c.execute("SELECT id, name FROM Subject").fetchall():
            sname = sname.strip()
            if sname:
                subj_map[sid] = sname
    except:
        pass
    
    try:
        for ser_id, sub_id in c.execute("SELECT seriesId, subjectId FROM SeriesSubject").fetchall():
            s_key = str(ser_id).zfill(5)
            uid = f"w-{disc_id}-{s_key}"
            if uid in works_by_uid and sub_id in subj_map:
                w = works_by_uid[uid]
                sub_name = subj_map[sub_id]
                if sub_name not in w['topics']:
                    w['topics'].append(sub_name)
    except:
        pass

    # Domains (thematic tree categories)
    dom_map = {}
    try:
        for did, dtitle in c.execute("SELECT id, title FROM Domain WHERE title NOT IN ('root', 'All Books', 'Favorite Books', 'Recent Books', 'Related Books')").fetchall():
            dtitle = dtitle.strip()
            if dtitle:
                dom_map[did] = dtitle
    except:
        pass
    try:
        for did, val in c.execute("SELECT object_id, value FROM Domain_ids").fetchall():
            s_key = str(val).zfill(5)
            uid = f"w-{disc_id}-{s_key}"
            if uid in works_by_uid and did in dom_map:
                w = works_by_uid[uid]
                d_name = dom_map[did]
                if d_name not in w['topics']:
                    w['topics'].append(d_name)
    except:
        pass

    # Languages
    try:
        for ser_id, lval in c.execute("SELECT id, value FROM Series_languages").fetchall():
            s_key = str(ser_id).zfill(5)
            uid = f"w-{disc_id}-{s_key}"
            if uid in works_by_uid:
                lval = lval.strip()
                if lval:
                    works_by_uid[uid]['language'] = lval
    except:
        pass

    conn.close()

# Also update document language to match work language if set
for w in catalog:
    for doc in w.get('documents', []):
        doc['language'] = w['language']

with_topics = sum(1 for w in catalog if len(w['topics']) > 0)
lang_counts = {}
for w in catalog:
    lang_counts[w['language']] = lang_counts.get(w['language'], 0) + 1

print(f"Results:")
print(f"- Works with topics: {with_topics} / {len(catalog)} ({with_topics*100.0/len(catalog):.1f}%)")
print(f"- Language distribution: {lang_counts}")

# Save back to catalog.json
with open(CATALOG_PATH, 'w', encoding='utf-8') as f:
    json.dump(catalog, f, ensure_ascii=False, indent=2)

print(f"Successfully saved enriched catalog to {CATALOG_PATH}")
