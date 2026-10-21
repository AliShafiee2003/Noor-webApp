import sys
sys.stdout.reconfigure(encoding='utf-8')
import sqlite3
import os

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

total_subjects = 0
total_series_subjects = 0
total_domain_nodes = 0
total_domain_mappings = 0
langs_dist = {}

all_subjects_set = set()
all_domains_list = []

for disc_id, lib_db in discs:
    if not os.path.exists(lib_db):
        continue
    conn = sqlite3.connect(lib_db)
    c = conn.cursor()
    
    # Check Subject
    try:
        subs = c.execute("SELECT id, name FROM Subject").fetchall()
        total_subjects += len(subs)
        for _, sname in subs:
            all_subjects_set.add(sname)
    except Exception as e:
        subs = []
        
    # Check SeriesSubject
    try:
        ss = c.execute("SELECT seriesId, subjectId FROM SeriesSubject").fetchall()
        total_series_subjects += len(ss)
    except:
        ss = []

    # Check Series_languages
    try:
        sl = c.execute("SELECT id, value FROM Series_languages").fetchall()
        for _, lval in sl:
            langs_dist[lval] = langs_dist.get(lval, 0) + 1
    except:
        pass

    # Check Domain
    try:
        doms = c.execute("SELECT id, title, parent, levelNo FROM Domain").fetchall()
        total_domain_nodes += len(doms)
        if len(doms) > 0 and len(all_domains_list) < 15:
            all_domains_list.extend([(disc_id, d) for d in doms[:5]])
    except:
        doms = []

    # Check Domain_ids
    try:
        d_ids = c.execute("SELECT object_id, value FROM Domain_ids").fetchall()
        total_domain_mappings += len(d_ids)
    except:
        d_ids = []

    conn.close()

print(f"=== SUMMARY ACROSS ALL 21 DISCS ===")
print(f"Total Subject records across discs: {total_subjects}")
print(f"Unique Subject names: {len(all_subjects_set)}")
print(f"Total SeriesSubject links: {total_series_subjects}")
print(f"Languages distribution: {langs_dist}")
print(f"Total Domain tree nodes: {total_domain_nodes}")
print(f"Total Domain_ids book mappings: {total_domain_mappings}")
print("\nSample Subjects (first 20):")
for s in list(sorted(all_subjects_set))[:20]:
    print(f"  - {s}")
print("\nSample Domain nodes:")
for disc_id, d in all_domains_list[:10]:
    print(f"  [{disc_id}] ID={d[0]}, Title='{d[1]}', Parent={d[2]}, Level={d[3]}")
