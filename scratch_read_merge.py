import sys
import csv

sys.stdout.reconfigure(encoding='utf-8')

with open('D:/Noor/authors_merge_groups_with_ids.csv', 'r', encoding='utf-8-sig') as f:
    reader = csv.reader(f)
    header = next(reader)
    print('Header cols count:', len(header))
    print('Header:', header)
    rows = list(reader)
    print('Total rows:', len(rows))
    for i, r in enumerate(rows):
        src1 = r[1].strip() if len(r) > 1 else ""
        src2 = r[4].strip() if len(r) > 4 else ""
        dest = r[7].strip() if len(r) > 7 else ""
        print(f"[{r[0]}] '{src1}' + '{src2}'  ===>  '{dest}'")
