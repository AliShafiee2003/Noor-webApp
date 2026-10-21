import sys
import json
import csv
import re

sys.stdout.reconfigure(encoding='utf-8')

CATALOG_PATH = 'D:/Noor/app_development/mini-services/noor-api/data/sources/catalog.json'
MERGE_CSV_PATH = 'D:/Noor/authors_merge_groups_with_ids.csv'

with open(CATALOG_PATH, 'r', encoding='utf-8') as f:
    catalog = json.load(f)

# Read merge pairs
merge_rules = [] # (group, src1, src2, target)

with open(MERGE_CSV_PATH, 'r', encoding='utf-8-sig') as f:
    reader = csv.reader(f)
    header = next(reader)
    for r in reader:
        if not r or not r[0].strip():
            continue
        grp = r[0].strip()
        src1 = r[1].strip()
        src2 = r[4].strip()
        target = r[7].strip()
        merge_rules.append((grp, src1, src2, target))

print(f"Loaded {len(merge_rules)} merge rules.")

def strip_invisible(s):
    if not s:
        return ""
    # remove ZWJ and normalize ZWNJ to standard
    return s.replace('\u200d', '').replace('\u200c\u200c', '\u200c').strip()

# Build mapping from both exact and stripped forms
# Also keep track of matches
mapping = {} # source_string -> target_string

for grp, s1, s2, target in merge_rules:
    mapping[s1] = target
    mapping[s2] = target
    mapping[strip_invisible(s1)] = target
    mapping[strip_invisible(s2)] = target

# Check matches in catalog.json
counts_before = {}
for w in catalog:
    a = w.get('author', '').strip()
    counts_before[a] = counts_before.get(a, 0) + 1

print("\n--- Detailed impact analysis per rule ---")
total_works_affected = 0

for grp, s1, s2, target in merge_rules:
    c1 = counts_before.get(s1, 0)
    c2 = counts_before.get(s2, 0)
    
    # Also check if there's any work whose stripped author matches
    s1_stripped = strip_invisible(s1)
    s2_stripped = strip_invisible(s2)
    
    matched_works = []
    for w in catalog:
        wa = w.get('author', '').strip()
        if wa == s1 or wa == s2 or strip_invisible(wa) == s1_stripped or strip_invisible(wa) == s2_stripped:
            matched_works.append(w)
            
    print(f"[{grp}] Target: '{target}'")
    print(f"   Src 1: '{s1}' (direct match: {c1})")
    print(f"   Src 2: '{s2}' (direct match: {c2})")
    print(f"   Total works merged into target: {len(matched_works)}")
    total_works_affected += len(matched_works)

print(f"\nTotal works that will be updated across all 32 rules: {total_works_affected}")
