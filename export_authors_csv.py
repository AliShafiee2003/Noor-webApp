import sys
import os
import json
import sqlite3
import glob
import csv
import re
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8')

CATALOG_PATH = 'D:/Noor/app_development/mini-services/noor-api/data/sources/catalog.json'

with open(CATALOG_PATH, 'r', encoding='utf-8') as f:
    catalog = json.load(f)

# 1. Map disc and series to AuthorId and Author name from all 21 library.dbs
discs = sorted(glob.glob('D:/Noor/**/library.db', recursive=True))

disc_series_author = {}
disc_author_name = {}
all_db_authors = {} # (disc_code, aid) -> aname

for db_path in discs:
    norm_path = db_path.replace('\\', '/')
    if '00244/00242' in norm_path:
        disc_code = '00244_nested'
    else:
        parts = norm_path.split('/')
        idx = parts.index('Data')
        disc_code = parts[idx-1]
        
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    
    if disc_code not in disc_series_author:
        disc_series_author[disc_code] = {}
        disc_author_name[disc_code] = {}
        
    try:
        cur.execute("SELECT id, AuthorId FROM Series")
        for sid, aid in cur.fetchall():
            disc_series_author[disc_code][str(sid).strip()] = str(aid).strip()
    except Exception as e:
        pass
        
    try:
        cur.execute("SELECT id, name FROM Author")
        for aid, aname in cur.fetchall():
            aid_str = str(aid).strip()
            aname_str = aname.strip()
            disc_author_name[disc_code][aid_str] = aname_str
            all_db_authors[(disc_code, aid_str)] = aname_str
    except Exception as e:
        pass

def normalize_for_clustering(s):
    if not s:
        return ""
    # Remove control characters, ZWJ (\u200d), ZWNJ (\u200c), tatweel (\u0640)
    s = s.replace('\u200d', '').replace('\u200c', ' ').replace('\u0640', '')
    # Arabic to Persian standard
    s = s.replace('ي', 'ی').replace('ك', 'ک').replace('ة', 'ه')
    # Alef normalization
    s = re.sub(r'[إأآٱا]', 'ا', s)
    # Remove all diacritics / harakat
    s = re.sub(r'[\u064B-\u065F\u0670]', '', s)
    # Remove punctuation
    s = re.sub(r'[،,؛;:\-—\.\(\)\[\]\{\}\/\\«»"\'\?؟]', ' ', s)
    # Collapse whitespace
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def normalize_compact(s):
    # Aggressive: remove spaces completely for compound words like بنيان گذار vs بنيانگذار
    return normalize_for_clustering(s).replace(' ', '')

# 2. Collect author records from catalog.json
# Author string in catalog is what UI currently shows
authors_data = {}

for w in catalog:
    aname = w.get('author', '').strip()
    if not aname:
        aname = "نامشخص"
        
    uid = w.get('uid', '')
    title = w.get('title', '').strip()
    
    parts = uid.split('-')
    d_code = parts[1] if len(parts) >= 3 else ''
    s_id = parts[2] if len(parts) >= 3 else ''
    
    aid = disc_series_author.get(d_code, {}).get(s_id, '')
    
    if aname not in authors_data:
        authors_data[aname] = {
            'author_name': aname,
            'author_ids': set(),
            'discs': set(),
            'works': []
        }
    if aid:
        authors_data[aname]['author_ids'].add(aid)
    if d_code:
        authors_data[aname]['discs'].add(d_code)
    authors_data[aname]['works'].append({
        'uid': uid,
        'title': title
    })

print(f"Distinct author entries in catalog: {len(authors_data)}")

# 3. Find duplicate clusters
# Group by compact normalized string
compact_groups = defaultdict(list)
for aname in authors_data:
    key = normalize_compact(aname)
    compact_groups[key].append(aname)

# Group by ID (where same Noor ID has different spellings)
id_groups = defaultdict(list)
for aname, data in authors_data.items():
    for aid in data['author_ids']:
        id_groups[aid].append(aname)

# Also check core name token overlap (e.g. family name + first name)
# Assign cluster IDs
cluster_map = {}
cluster_counter = 1

# First pass: compact groups with > 1 author
for key, names in compact_groups.items():
    if len(names) > 1:
        c_id = f"GRP-{cluster_counter:03d}"
        cluster_counter += 1
        for n in names:
            cluster_map[n] = c_id

# Second pass: Noor Author IDs with > 1 distinct name
for aid, names in id_groups.items():
    distinct_names = list(set(names))
    if len(distinct_names) > 1:
        # Check if already assigned
        existing_c = None
        for n in distinct_names:
            if n in cluster_map:
                existing_c = cluster_map[n]
                break
        if not existing_c:
            existing_c = f"GRP-{cluster_counter:03d}"
            cluster_counter += 1
        for n in distinct_names:
            cluster_map[n] = existing_c

# Third pass: Token-based prefix/suffix matching for prominent names (e.g. مجلسی، محمدباقر)
# If author A's tokens are a subset of author B's tokens or startswith
token_groups = defaultdict(list)
for aname in authors_data:
    words = tuple(normalize_for_clustering(aname).split()[:3]) # first 3 words
    if len(words) >= 2:
        token_groups[words].append(aname)

for words, names in token_groups.items():
    distinct_names = list(set(names))
    if len(distinct_names) > 1:
        # Only group if not already grouped and words are specific enough
        pass

print(f"Total clustered duplicate groups found: {cluster_counter - 1}")

# 4. Prepare rows
rows = []

for aname, data in authors_data.items():
    clean_display = aname.replace('\u200d', '').replace('\u200c', ' ').strip()
    clean_display = re.sub(r'\s+', ' ', clean_display)
    
    aids = sorted(data['author_ids'])
    aid_str = ", ".join(aids) if aids else ""
    
    discs_str = ", ".join(sorted(data['discs']))
    works_count = len(data['works'])
    
    sample_titles = " ؛ ".join(w['title'] for w in data['works'][:3] if w['title'])
    all_work_uids = ", ".join(w['uid'] for w in data['works'])
    
    cluster_id = cluster_map.get(aname, "")
    
    # Note on duplicate reason
    notes = []
    if cluster_id:
        notes.append("دارای نگارش‌های مشابه")
    if len(aids) > 1:
        notes.append(f"دارای {len(aids)} شناسه در دیسک‌ها")
    if '\u200d' in aname:
        notes.append("حاوی نویسه پنهان ZWJ")
    
    rows.append({
        'author_id': aid_str,
        'author_name': aname,
        'clean_name': clean_display,
        'normalized_key': normalize_for_clustering(aname),
        'compact_key': normalize_compact(aname),
        'works_count': works_count,
        'duplicate_group': cluster_id,
        'sample_works': sample_titles,
        'work_uids': all_work_uids,
        'discs': discs_str,
        'notes': " | ".join(notes),
        'suggested_unified_name': ""
    })

# Sort rows:
# If in a duplicate_group, sort by duplicate_group first, then works_count DESC
# Otherwise sort by normalized_key
def sort_key(r):
    if r['duplicate_group']:
        return (0, r['duplicate_group'], -r['works_count'])
    return (1, r['normalized_key'], -r['works_count'])

rows.sort(key=sort_key)

# Add row numbers
for i, r in enumerate(rows, 1):
    r['row_num'] = i

# 5. Export to CSV (utf-8-sig for Excel compatibility)
csv_columns = [
    ('row_num', 'ردیف'),
    ('duplicate_group', 'گروه_مشابهت (جهت یکپارچه‌سازی)'),
    ('author_id', 'شناسه_مؤلف (Author ID)'),
    ('author_name', 'نام_فعلی_مؤلف'),
    ('clean_name', 'نام_خوانا (بدون کاراکتر مخفی)'),
    ('works_count', 'تعداد_آثار'),
    ('sample_works', 'نمونه_کتاب‌ها'),
    ('suggested_unified_name', 'نام_یکپارچه_پیشنهادی (خالی جهت ویرایش)'),
    ('notes', 'توضیحات'),
    ('discs', 'شناسه_دیسک‌ها'),
    ('work_uids', 'شناسه_تمام_آثار')
]

out_paths = [
    'D:/Noor/authors_catalog.csv',
    'D:/Noor/app_development/authors_catalog.csv'
]

for out_path in out_paths:
    with open(out_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f)
        # Header in Persian
        writer.writerow([col[1] for col in csv_columns])
        for r in rows:
            writer.writerow([r[col[0]] for col in csv_columns])
    print(f"Saved: {out_path} ({os.path.getsize(out_path):,} bytes)")

print("\nSummary of groups with potential duplicates:")
dup_rows = [r for r in rows if r['duplicate_group']]
print(f"Total entries in duplicate groups: {len(dup_rows)}")

# Export a dedicated duplicates review file
dup_out_paths = [
    'D:/Noor/authors_duplicates_to_unify.csv',
    'D:/Noor/app_development/authors_duplicates_to_unify.csv'
]
for dup_path in dup_out_paths:
    with open(dup_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f)
        writer.writerow([col[1] for col in csv_columns])
        for r in dup_rows:
            writer.writerow([r[col[0]] for col in csv_columns])
    print(f"Saved duplicates file: {dup_path} ({os.path.getsize(dup_path):,} bytes)")
