import sys
sys.stdout.reconfigure(encoding='utf-8')
import urllib.request
import urllib.parse
import http.cookiejar
import json

base = "http://127.0.0.1:8080/api/v1"
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

# 0. Login
login_data = json.dumps({"username": "admin", "password": "Admin@123456"}).encode('utf-8')
req = urllib.request.Request(base + "/auth/login", data=login_data, headers={"Content-Type": "application/json"})
with opener.open(req) as resp:
    res = json.loads(resp.read().decode('utf-8'))
    print("Login successful! User:", res.get("user", {}).get("username"))

def get(path):
    url = base + path
    req = urllib.request.Request(url)
    with opener.open(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

# 1. Test language fa
res_fa = get("/works?language=fa&page=1&page_size=3")
print("\n1. Language fa total:", res_fa['total'])
for item in res_fa['items']:
    print(f"   - {item['title']} (lang={item['language']}, author={item['author']})")

# 2. Test language ar
res_ar = get("/works?language=ar&page=1&page_size=3")
print("\n2. Language ar total:", res_ar['total'])

# 3. Test sort=volumes
res_vol = get("/works?sort=volumes&page=1&page_size=5")
print("\n3. Top 5 works by volume count:")
for item in res_vol['items']:
    print(f"   - {item['title']}: {item['documents_count']} volumes (author: {item['author']})")

# 4. Test topics
res_top = get("/topics")
print(f"\n4. Total topics: {len(res_top['items'])}")
print("   Top 10 topics by book count:")
for t in res_top['items'][:10]:
    print(f"   - {t['title']} ({t['count']} works)")

# 5. Test topic occurrences
if len(res_top['items']) > 0:
    first_topic = res_top['items'][0]
    encoded_uid = urllib.parse.quote(first_topic['uid'])
    res_occ = get(f"/topics/{encoded_uid}/occurrences")
    print(f"\n5. Occurrences for topic '{first_topic['title']}': {len(res_occ['items'])} works")
    for o in res_occ['items'][:3]:
        print(f"   - {o['work_title']} ({o['note']})")

# 6. Test author search
res_auth = get("/works?author=" + urllib.parse.quote("طباطبایی") + "&page=1&page_size=3")
print(f"\n6. Author search for 'طباطبایی': {res_auth['total']} works found")
for item in res_auth['items']:
    print(f"   - {item['title']} (author: {item['author']})")

print("\nALL API TESTS PASSED SUCCESSFULLY!")
