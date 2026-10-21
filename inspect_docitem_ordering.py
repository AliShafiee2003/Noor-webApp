import sys
sys.stdout.reconfigure(encoding='utf-8')
import sqlite3

conn = sqlite3.connect('D:/Noor/00166/Data/books/01314/01314_001.db')
c = conn.cursor()

# Check DocItem table: Id vs ItemNo
dis = c.execute("SELECT Id, ItemNo, StoryId FROM DocItem WHERE StoryId = 1 ORDER BY ItemNo LIMIT 20").fetchall()
print("First 20 DocItems in Story 1 ordered by ItemNo:")
for di in dis:
    print(f"  ItemNo={di[1]}, Id={di[0]}")

# Notice earlier: First DocItem in Story 1 had ItemNo=1422, Id=1!
# Wait! Look at that: ItemNo was 1422?!
# Let's check min and max ItemNo and Id in Story 1:
stats = c.execute("SELECT MIN(Id), MAX(Id), MIN(ItemNo), MAX(ItemNo) FROM DocItem WHERE StoryId = 1").fetchone()
print(f"Story 1 DocItem stats: MinId={stats[0]}, MaxId={stats[1]}, MinItemNo={stats[2]}, MaxItemNo={stats[3]}")

# How does PageBreak relate to DocItemId?
# Are DocItemIds in PageBreak the DocItem.Id or DocItem.ItemNo?
pb_stats = c.execute("SELECT MIN(DocItemId), MAX(DocItemId), MIN(PageId), MAX(PageId) FROM PageBreak").fetchone()
print(f"PageBreak stats: MinDocItemId={pb_stats[0]}, MaxDocItemId={pb_stats[1]}, MinPageId={pb_stats[2]}, MaxPageId={pb_stats[3]}")

# Check TableOfContent DocItemId:
toc_stats = c.execute("SELECT MIN(DocItemId), MAX(DocItemId) FROM TableOfContent").fetchone()
print(f"TableOfContent stats: MinDocItemId={toc_stats[0]}, MaxDocItemId={toc_stats[1]}")

conn.close()
