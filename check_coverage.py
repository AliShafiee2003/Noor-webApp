import sys
sys.stdout.reconfigure(encoding='utf-8')
import json
import sqlite3
import os
from inspect_subjects import discs

with open('D:/Noor/app_development/mini-services/noor-api/data/sources/catalog.json', 'r', encoding='utf-8') as f:
    catalog = json.load(f)

works_by_key = {w['uid']: w for w in catalog}

topics_by_uid = {}
langs_by_uid = {}

for disc_id, lib_db in discs:
    if not os.path.exists(lib_db):
        continue
    conn = sqlite3.connect(lib_db)
    c = conn.cursor()
    
    # Subjects
    subj_map = {}
    try:
        for sid, sname in c.execute("SELECT id, name FROM Subject").fetchall():
            subj_map[sid] = sname.strip()
    except:
        pass
    try:
        for ser_id, sub_id in c.execute("SELECT seriesId, subjectId FROM SeriesSubject").fetchall():
            s_key = str(ser_id).zfill(5)
            uid = f"w-{disc_id}-{s_key}"
            if uid in works_by_key and sub_id in subj_map:
                topics_by_uid.setdefault(uid, set()).add(subj_map[sub_id])
    except:
        pass

    # Domains
    dom_map = {}
    try:
        for did, dtitle in c.execute("SELECT id, title FROM Domain WHERE title NOT IN ('root', 'All Books', 'Favorite Books', 'Recent Books', 'Related Books')").fetchall():
            dom_map[did] = dtitle.strip()
    except:
        pass
    try:
        for did, val in c.execute("SELECT object_id, value FROM Domain_ids").fetchall():
            s_key = str(val).zfill(5)
            uid = f"w-{disc_id}-{s_key}"
            if uid in works_by_key and did in dom_map:
                topics_by_uid.setdefault(uid, set()).add(dom_map[did])
    except:
        pass

    # Languages
    try:
        for ser_id, lval in c.execute("SELECT id, value FROM Series_languages").fetchall():
            s_key = str(ser_id).zfill(5)
            uid = f"w-{disc_id}-{s_key}"
            if uid in works_by_key:
                langs_by_uid[uid] = lval.strip()
    except:
        pass

    conn.close()

print(f"Total works with at least one topic/subject: {len(topics_by_uid)} of {len(catalog)}")
print(f"Total works with language: {len(langs_by_uid)} of {len(catalog)}")

all_topics = set()
for t_set in topics_by_uid.values():
    all_topics.update(t_set)
print(f"Total unique topics across all works: {len(all_topics)}")

# Sample work with its topics
sample_uids = list(topics_by_uid.keys())[:5]
for uid in sample_uids:
    print(f"Work {uid} ({works_by_key[uid]['title']}): lang={langs_by_uid.get(uid)}, topics={list(topics_by_uid[uid])[:5]}")
