#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""اعتبارسنج ایستای استقرار — deploy/docker-compose.yml و فایل‌های همراه (PRD §۵۲)

محدوده: هر آنچه به‌صورت ایستا قابل راستی‌آزمایی است:
  A) ساختار YAML و سرویس‌ها
  B) build.context / dockerfile
  C) فایل‌های ارجاع‌شده در Dockerfileها (COPY/ADD — شامل فرم JSON و glob) + .dockerignore
  D) volumeهای نام‌دار و bind-mountها و پرچم‌های mount
  E) متغیرهای الزامی ${VAR:?…} در برابر deploy/.env.example (بدون secret واقعی)
  F) depends_on و ports و الزام امنیتی SEC-07 (OpenSearch بدون پورت منتشرشده)
  G) سخت‌سازی: healthcheck، read_only، tmpfs
  H) تطبیق Caddyfile.prod با سرویس‌ها و پورت‌های داخلی
  I) هم‌خوانی env با کد (Go/Next) — متغیر خوانده‌نشده = هشدار، کمبود بدیهی = خطا
  J) معناشناسی اسکیمای compose (mem_limit، ulimits، tmpfs، restart، healthcheck)
     + مالکیت volume برای کاربر غیرریشه (وگرنه نوشتن در volume نام‌دار شکست می‌خورد)

تنها نکتهٔ خارج از توان این اعتبارسنج: اجرای واقعی کانتینرها (در سندباکس Docker نیست — بند د-۱۰).

اجرا:  python3 deploy/validate-compose.py
خروجی: یک خط PASS/FAIL/WARN/DEFER برای هر آزمون + جدول جمع‌بندی.
کد خروج: 0 = بدون FAIL، 1 = حداقل یک FAIL.
"""

import glob as globmod
import json
import re
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent          # /home/z/my-project
DEPLOY = REPO / "deploy"
COMPOSE = DEPLOY / "docker-compose.yml"
CADDYFILE = DEPLOY / "Caddyfile.prod"
ENV_EXAMPLE = DEPLOY / ".env.example"

# تصاویر شخص‌ثالث — پیکربندی داخلی‌شان (نظیر مالکیت مسیرها) با خود image است
THIRD_PARTY_SERVICES = {"proxy", "opensearch"}

STATUS_ICON = {"PASS": "PASS  ✓", "FAIL": "FAIL  ✗", "WARN": "WARN  ⚠", "DEFER": "DEFER ○"}

results = []  # (id, category, title, status, detail)


def add(cid, cat, title, status, detail=""):
    results.append((cid, cat, title, status, detail))
    line = f"[{STATUS_ICON[status]}] {cid:<4} {title}"
    if detail:
        line += f"\n            └ {detail}"
    print(line)
    return status


def has_fail(cid_prefix=""):
    return any(
        r[3] == "FAIL" and r[0].startswith(cid_prefix) for r in results
    )


# ─────────────────────────── ابزارهای عمومی ───────────────────────────

def env_map(env):
    """تبدیل environment به dict؛ هم فرم لیست ('K=V') و هم فرم dict."""
    out = {}
    if not env:
        return out
    if isinstance(env, dict):
        return {str(k): ("" if v is None else str(v)) for k, v in env.items()}
    if isinstance(env, list):
        for item in env:
            if isinstance(item, str):
                k, _, v = item.partition("=")
                out[k] = v
    return out


PLACEHOLDER = "\x00"


def protect_vars(s):
    """جای ${...} با جانگهدار تا split(':') محتوای داخلش را نشکند."""
    return re.sub(r"\$\{[^}]*\}", PLACEHOLDER, s)


def scan_interpolation(text):
    """اسکن ${VAR:?msg} (الزامی) و ${VAR:-def}/${VAR} (اختیاری) در متن خام."""
    required, optional = {}, {}
    for m in re.finditer(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[?\-][^}]*)?\}", text):
        var, tail = m.group(1), m.group(2) or ""
        if tail.startswith((":",)) and "?" in tail:
            required.setdefault(var, tail.lstrip(":?"))
        elif "?" in tail:
            required.setdefault(var, tail.lstrip("?"))
        else:
            optional.setdefault(var, "")
    return required, optional


def dockerfile_instructions(text):
    """خطوط ادامه‌دار با \\ یکی می‌شوند؛ کامنت‌ها حذف؛ خروجی (INSTR, args_str)."""
    joined = text.replace("\\\n", " ")
    instrs = []
    for line in joined.split("\n"):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        parts = s.split(None, 1)
        instrs.append((parts[0].upper(), parts[1] if len(parts) > 1 else ""))
    return instrs


def parse_copy_args(argstr):
    """ARGUMENTS دستور COPY/ADD → (flags, srcs, dest, is_json). src=None یعنی فرم JSON شکست خورد."""
    if argstr.strip().startswith("["):
        try:
            arr = json.loads(argstr.strip())
            return [], [str(x) for x in arr[:-1]], str(arr[-1]), True
        except Exception:
            return [], None, None, True
    toks = argstr.split()
    flags = [t for t in toks if t.startswith("--")]
    rest = [t for t in toks if not t.startswith("--")]
    if len(rest) < 2:
        return flags, [], None, False
    return flags, rest[:-1], rest[-1], False


def path_outside(base, candidate):
    try:
        candidate.resolve().relative_to(base.resolve())
        return False
    except ValueError:
        return True


def check_ctx_source(src, ctx_root, cid, where):
    """بررسی یک مسیر مبدأ COPY نسبت به context؛ glob باید حداقل یک تطبیق داشته باشد."""
    src = src.strip().strip('"').strip("'")
    if src in (".", "./"):
        add(cid, "Dockerfile", f"مبدأ COPY «{src}» در {where}", "PASS",
            "خود context است — مبدأ کل بیلد")
        return
    clean = src[:-1] if src.endswith("/") and len(src) > 1 else src
    p = ctx_root / clean
    if path_outside(ctx_root, p):
        add(cid, "Dockerfile", f"مبدأ COPY «{src}» در {where}", "FAIL",
            "از بیرون context خارج می‌شود")
        return
    if any(ch in clean for ch in "*?["):
        matches = list(ctx_root.glob(clean))
        if matches:
            add(cid, "Dockerfile", f"مبدأ COPY (glob) «{src}» در {where}", "PASS",
                f"{len(matches)} تطبیق، نمونه: {matches[0].name}")
        else:
            add(cid, "Dockerfile", f"مبدأ COPY (glob) «{src}» در {where}", "FAIL",
                "هیچ فایلی با الگو مطابقت نکرد")
        return
    if p.exists():
        kind = "پوشه" if p.is_dir() else "فایل"
        add(cid, "Dockerfile", f"مبدأ COPY «{src}» در {where}", "PASS", kind)
    else:
        add(cid, "Dockerfile", f"مبدأ COPY «{src}» در {where}", "FAIL",
            f"فایل/پوشه در context یافت نشد: {clean}")


def dockerfile_envs_and_expose(text):
    """ENVها و پورت‌های EXPOSE از Dockerfile (برای تطبیق با compose و Caddyfile)."""
    envs, ports = {}, []
    for instr, argstr in dockerfile_instructions(text):
        if instr == "EXPOSE":
            ports += [t.split("/")[0] for t in argstr.split() if t.split("/")[0].isdigit()]
        elif instr == "ENV" and argstr:
            toks = argstr.split()
            if "=" in toks[0]:
                for t in toks:
                    k, _, v = t.partition("=")
                    envs[k] = v
            elif len(toks) >= 2:
                envs[toks[0]] = toks[1]
    return envs, ports


def collect_code_vars():
    """متغیرهای NOOR_* که واقعاً در کد خوانده می‌شوند؛ نگاشت var → نخستین فایل."""
    go_vars, fe_vars = {}, {}
    api_dir = REPO / "mini-services" / "noor-api"
    if api_dir.exists():
        for p in sorted(api_dir.rglob("*.go")):
            if p.name.endswith("_test.go"):
                continue  # کد تولیدی/آزمون صرف، نه مصرف‌کنندهٔ پیکربندی
            txt = p.read_text(encoding="utf-8", errors="ignore")
            for var in set(re.findall(r"\bNOOR_[A-Z0-9_]+\b", txt)):
                go_vars.setdefault(var, str(p.relative_to(REPO)))
    src_dir = REPO / "src"
    if src_dir.exists():
        for p in sorted(src_dir.rglob("*")):
            if p.suffix not in (".ts", ".tsx"):
                continue
            txt = p.read_text(encoding="utf-8", errors="ignore")
            for var in set(re.findall(r"process\.env\.(\??\[?['\"]?)(NOOR_[A-Z0-9_]+)", txt)):
                fe_vars.setdefault(var[1], str(p.relative_to(REPO)))
    return go_vars, fe_vars


def dockerignore_covers(lines, token):
    """آیا الگویی در .dockerignore مسیر token را می‌پوشاند؟ (تطبیق سادهٔ سگمنتی)"""
    for raw in lines:
        pat = raw.strip()
        if not pat or pat.startswith("#") or pat.startswith("!"):
            continue
        pat = pat.lstrip("/")
        segs = pat.split("/")
        # الگوی بدون اسلش یا با /**: هر عمقی را می‌پوشاند اگر سگمنت نخست/هر سگمنتش خویشاوند باشد
        if pat.endswith("/**") and token.startswith(pat[:-3].rstrip("/") or "/"):
            return True
        if segs[0] == token or (len(segs) > 1 and "/".join(segs) == token):
            return True
        if "*" in pat and token.split("/")[0] == segs[0].replace("*", ""):
            return True
        # الگوهای زیرمسیری مثل mini-services/noor-api/data — token برابر یا زیرِ الگو
        if token == pat or token.startswith(pat + "/"):
            return True
    return False


def path_ignored_by(lines, target):
    """آیا مسیر target توسط الگوهای .dockerignore حذف می‌شود؟ (برای ورودی‌های لازمِ بیلد)"""
    for raw in lines:
        pat = raw.strip()
        if not pat or pat.startswith("#") or pat.startswith("!"):
            continue
        pat = pat.lstrip("/")
        if pat == target:
            return True
        if pat.endswith("/*") and target.startswith(pat[:-2].rstrip("/") + "/"):
            return True
        if pat.endswith("/**") and target.startswith(pat[:-3].rstrip("/") + "/"):
            return True
        if "/" not in pat and (target == pat or target.startswith(pat + "/")):
            return True
    return False


# ─────────────────────────── بارگذاری اولیه ───────────────────────────

def load_all():
    data = {"compose": None, "compose_text": "", "dockerfiles": {}, "caddy_text": ""}
    errs = []
    try:
        data["compose_text"] = COMPOSE.read_text(encoding="utf-8")
        data["compose"] = yaml.safe_load(data["compose_text"])
    except Exception as e:  # noqa: BLE001
        errs.append(f"YAML: {e}")
    for df in ("Dockerfile.api", "Dockerfile.web"):
        p = DEPLOY / df
        try:
            data["dockerfiles"][df] = p.read_text(encoding="utf-8")
        except Exception as e:  # noqa: BLE001
            errs.append(f"{df}: {e}")
    try:
        data["caddy_text"] = CADDYFILE.read_text(encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        errs.append(f"Caddyfile.prod: {e}")
    return data, errs


def main():
    print(f"اعتبارسنج ایستای compose — {COMPOSE}")
    print("محدوده: YAML + فایل‌های ارجاع‌شده + هم‌خوانی با کد (اجزای د-۹ تا د-۱۱)؛ اجرای واقعی کانتینر خارج از محدوده است.\n")

    data, load_errs = load_all()
    if data["compose"] is None:
        add("A1", "YAML", "تجزیهٔ deploy/docker-compose.yml", "FAIL", "; ".join(load_errs))
        summary()
        return 1
    compose = data["compose"]
    services = compose.get("services") or {}
    volumes = compose.get("volumes") or {}

    go_vars, fe_vars = collect_code_vars()
    req_vars, opt_vars = scan_interpolation(data["compose_text"])
    # ارجاع env در Caddyfile هم بخشی از قرارداد استقرار است: {$NOOR_DOMAIN:localhost}
    if data["caddy_text"]:
        for m in re.finditer(r"\{\$([A-Za-z_][A-Za-z0-9_]*)(?::([^}]*))?\}", data["caddy_text"]):
            opt_vars.setdefault(m.group(1), "")
            if m.group(2) is None:
                req_vars.setdefault(m.group(1), "Caddyfile بدون مقدار پیش‌فرض")

    dockerfile_of = {}
    img_env, img_expose, img_entry, img_cmd = {}, {}, {}, {}
    df_text = {}

    # ═══════════════════ A) ساختار YAML ═══════════════════
    if load_errs:
        add("A1", "YAML", "خواندن فایل‌های استقرار", "FAIL", "; ".join(load_errs))
    else:
        add("A1", "YAML", "تجزیهٔ YAML (docker-compose.yml + ۲ Dockerfile + Caddyfile.prod)", "PASS",
            "هر ۴ فایل خوانده و تجزیه شد")
    if isinstance(services, dict) and services:
        add("A2", "YAML", "کلیدهای سطح بالا services و volumes", "PASS",
            f"{len(services)} سرویس: {', '.join(services)}؛ {len(volumes)} volume نام‌دار")
    else:
        add("A2", "YAML", "کلیدهای سطح بالا services و volumes", "FAIL",
            "services غیرتهی الزامی است")
    for name, svc in sorted(services.items()):
        if not isinstance(svc, dict):
            add("A3", "YAML", f"سرویس {name} — ساختار", "FAIL", "نگاشت نیست")
            continue
        if svc.get("image") or svc.get("build"):
            src = svc.get("image") or f"build:{svc.get('build', {}).get('dockerfile', '?')}"
            add("A3", "YAML", f"سرویس {name} — image یا build", "PASS", str(src))
        else:
            add("A3", "YAML", f"سرویس {name} — image یا build", "FAIL",
                "نه image دارد و نه build")

    # ═══════════════════ B) build context / dockerfile ═══════════════════
    for name, svc in sorted(services.items()):
        build = (svc or {}).get("build")
        if not build:
            continue
        if isinstance(build, str):
            build = {"context": build}
        ctx = (build.get("context") or ".").strip()
        ctx_path = (DEPLOY / ctx).resolve()
        if ctx_path.is_dir() and not path_outside(REPO, ctx_path):
            add("B1", "Build", f"سرویس {name} — context «{ctx}»", "PASS", str(ctx_path))
        else:
            add("B1", "Build", f"سرویس {name} — context «{ctx}»", "FAIL",
                "پوشهٔ context وجود ندارد یا خارج از مخزن است")
            continue
        df = build.get("dockerfile")
        if not df:
            add("B2", "Build", f"سرویس {name} — dockerfile", "PASS", "پیش‌فرض Dockerfile در context")
            continue
        df_path = (ctx_path / df).resolve()
        if df_path.is_file() and not path_outside(ctx_path, df_path):
            add("B2", "Build", f"سرویس {name} — dockerfile «{df}»", "PASS", str(df_path))
            key = df_path.name
            dockerfile_of[name] = df_path
            if key not in df_text:
                df_text[key] = df_path.read_text(encoding="utf-8")
            envs, expose = dockerfile_envs_and_expose(df_text[key])
            img_env.setdefault(key, envs)
            img_expose.setdefault(key, expose)
            for instr, argstr in dockerfile_instructions(df_text[key]):
                if instr == "ENTRYPOINT" and argstr:
                    try:
                        img_entry[key] = json.loads(argstr)
                    except Exception:  # noqa: BLE001
                        img_entry[key] = argstr.split()
                elif instr == "CMD" and argstr:
                    try:
                        img_cmd[key] = json.loads(argstr)
                    except Exception:  # noqa: BLE001
                        img_cmd[key] = argstr.split()
        else:
            add("B2", "Build", f"سرویس {name} — dockerfile «{df}»", "FAIL",
                "فایل dockerfile نسبت به context یافت نشد")

    # ═══════════════════ C) فایل‌های ارجاع‌شده در Dockerfile ═══════════════════
    # هر Dockerfile متمایز یک‌بار بررسی می‌شود (api و worker مشترک‌اند)
    seen_df = set()
    for name, df_path in sorted(dockerfile_of.items()):
        if df_path.name in seen_df:
            continue
        seen_df.add(df_path.name)
        text = df_text[df_path.name]
        ctx_root = (DEPLOY / (services[name]["build"].get("context") or ".")).resolve()
        n_ok = n_skip = 0
        for instr, argstr in dockerfile_instructions(text):
            if instr not in ("COPY", "ADD"):
                continue
            flags, srcs, dest, is_json = parse_copy_args(argstr)
            if any(f.startswith("--from=") for f in flags):
                n_skip += 1  # مبدأ مرحلهٔ بیلد است، نه فایل context
                continue
            if srcs is None:
                add("C1", "Dockerfile", f"{df_path.name} — فرم JSON دستور {instr}", "FAIL",
                    "آرایهٔ JSON تجزیه نشد")
                continue
            for src in srcs:
                check_ctx_source(src, ctx_root, "C1", df_path.name)
                n_ok += 1
        add("C2", "Dockerfile", f"{df_path.name} — دستورهای COPY با ‎--from (مبدأ stage بیلد)", "PASS",
            f"{n_skip} مورد صرف‌نظر شد (مبدأ داخل image است، نه context)")

    # C3 — باینری‌های ساخته‌شده در Dockerfile.api در برابر نقش سرویس‌ها
    api_df = df_text.get("Dockerfile.api", "")
    built_bins = set(re.findall(r"-o\s+/out/([A-Za-z0-9_-]+)", api_df))
    need_bins = {"api"} | {n for n, svc in services.items() if n == "worker"}
    missing_bins = need_bins - built_bins
    if missing_bins:
        add("C3", "Dockerfile", "باینری‌های لازم در Dockerfile.api ساخته می‌شوند", "FAIL",
            f"ساخته‌نشده: {', '.join(sorted(missing_bins))}")
    else:
        add("C3", "Dockerfile", "باینری‌های لازم در Dockerfile.api ساخته می‌شوند", "PASS",
            f"/out/: {', '.join(sorted(built_bins))}")

    # C4 — COPY . . بدون .dockerignore = نشت secret/داده به context بیلد
    copy_all = set()
    for name in sorted(dockerfile_of):
        text = df_text[dockerfile_of[name].name]
        for instr, argstr in dockerfile_instructions(text):
            if instr != "COPY":
                continue
            flags, srcs, dest, _ = parse_copy_args(argstr)
            if srcs and any(s in (".", "./") for s in srcs):
                copy_all.add(name)
    di_path = ctx_root_of(compose, services) / ".dockerignore"
    if not copy_all:
        add("C4", "Dockerfile", "Dockerfile با COPY کل context", "PASS", "چنین دستوری وجود ندارد")
    elif di_path.is_file():
        add("C4", "Dockerfile", "وجود .dockerignore در ریشهٔ context (به‌دلیل COPY . .)", "PASS",
            str(di_path))
    else:
        add("C4", "Dockerfile", "وجود .dockerignore در ریشهٔ context (به‌دلیل COPY . .)", "FAIL",
            f"سرویس(های) {', '.join(sorted(copy_all))} کل context را کپی می‌کنند؛ بدون .dockerignore فایل‌های "
            ".env و mini-services/noor-api/data (پایگاه داده!) به stage بیلد می‌روند — نشت داده (DATA-01/SEC)")

    di_lines = []
    if di_path.is_file():
        di_lines = di_path.read_text(encoding="utf-8").splitlines()
        # C5 — پوشش موارد حساس
        sensitive = [".env", "data", "node_modules", ".git", ".next"]
        uncovered = [t for t in sensitive if not dockerignore_covers(di_lines, t)]
        if uncovered:
            add("C5", "Dockerfile", "پوشش مسیرهای حساس در .dockerignore", "FAIL",
                f"پوشش‌نشده: {', '.join(uncovered)}")
        else:
            add("C5", "Dockerfile", "پوشش مسیرهای حساس در .dockerignore", "PASS",
                ", ".join(sensitive))
        # C6 — ورودی‌های لازم بیلد نباید ignore شده باشند
        needed = ["package.json", "bun.lock", "src", "public", "next.config.ts",
                  "postcss.config.mjs", "tsconfig.json", "deploy"]
        wrongly = [t for t in needed if path_ignored_by(di_lines, t)]
        if wrongly:
            add("C6", "Dockerfile", "ورودی‌های لازم بیلد web در .dockerignore حذف نشده‌اند", "FAIL",
                f"حذف‌شده به‌اشتباه: {', '.join(wrongly)}")
        else:
            add("C6", "Dockerfile", "ورودی‌های لازم بیلد web در .dockerignore حذف نشده‌اند", "PASS",
                ", ".join(needed))
    else:
        add("C5", "Dockerfile", "پوشش مسیرهای حساس در .dockerignore", "DEFER",
            "فایل .dockerignore وجود ندارد (اگر C4 رفع شد باید پوشش داده شود)")
        add("C6", "Dockerfile", "ورودی‌های لازم بیلد web در .dockerignore حذف نشده‌اند", "DEFER",
            "فایل .dockerignore وجود ندارد")

    # C7 — فونت‌های woff2 که Dockerfile.web با cp از node_modules برمی‌دارد
    web_df = df_text.get("Dockerfile.web", "")
    font_refs = sorted(set(re.findall(r"node_modules/@fontsource/[^\s\\']+\.woff2", web_df)))
    if not font_refs:
        add("C7", "Dockerfile", "مسیرهای فونت داخل Dockerfile.web", "DEFER", "ارجاعی یافت نشد")
    else:
        missing = [f for f in font_refs if not (REPO / f).exists()]
        if missing:
            add("C7", "Dockerfile", f"{len(font_refs)} فایل فونت woff2 ارجاع‌شده در Dockerfile.web", "FAIL",
                "ناموجود: " + ", ".join(missing))
        else:
            add("C7", "Dockerfile", f"{len(font_refs)} فایل فونت woff2 ارجاع‌شده در Dockerfile.web", "PASS",
                "همه در node_modules موجودند (با bun.lock هم‌خوان)")

    # ═══════════════════ D) volumeها ═══════════════════
    allowed_flags = {"", "ro", "rw", "z", "Z", "consistent", "cached", "delegate", "nocopy", "no-copy"}
    declared = set(volumes.keys()) if isinstance(volumes, dict) else set()
    used_named, bind_ok, bind_defer, flag_bad, target_uncovered = set(), [], [], [], []
    code_text_all = ""
    for p in list((REPO / "mini-services" / "noor-api").rglob("*.go")) + list((REPO / "src").rglob("*")):
        try:
            if p.is_file():
                code_text_all += p.read_text(encoding="utf-8", errors="ignore")
        except Exception:  # noqa: BLE001
            pass

    for name, svc in sorted(services.items()):
        env = env_map((svc or {}).get("environment"))
        for mount in (svc or {}).get("volumes") or []:
            if isinstance(mount, dict):  # فرم بلند
                mtype, src, tgt = mount.get("type"), mount.get("source", ""), mount.get("target", "")
                if mtype == "volume" and src:
                    used_named.add(src)
                elif mtype == "bind":
                    if (DEPLOY / src).exists():
                        bind_ok.append(f"{name}:{src} → {tgt}")
                    else:
                        flag_bad.append(f"{name}: bind-mount «{src}» روی دیسک یافت نشد")
                if not tgt.startswith("/"):
                    flag_bad.append(f"{name}:{tgt} (مقصد مطلق نیست)")
                continue
            prot = protect_vars(mount)
            parts = [x.strip() for x in prot.split(":")]
            # بازگردانی جانگهدارها
            parts = [restore_var(mount, x) for x in parts]
            if len(parts) < 2:
                flag_bad.append(f"{name}: «{mount}» ساختار mount نامفهوم است")
                continue
            src, tgt = parts[0], parts[1]
            flags = parts[2] if len(parts) > 2 else ""
            for fl in flags.split(","):
                if fl not in allowed_flags:
                    flag_bad.append(f"{name}: پرچم «{fl}» در «{mount}» شناخته نشد")
            if src.startswith(PLACEHOLDER) or "${" in src:
                bind_defer.append(f"{name}:{src} → {tgt} (در زمان اجرا با :? سخت‌گیری شده)")
                continue
            if src.startswith((".", "/")):
                p = (DEPLOY / src).resolve() if not src.startswith("/") else Path(src)
                if p.exists():
                    bind_ok.append(f"{name}:{src} → {tgt}")
                else:
                    flag_bad.append(f"{name}: bind-mount «{src}» روی دیسک یافت نشد")
                continue
            # volume نام‌دار
            if src not in declared:
                flag_bad.append(f"{name}: volume نام‌دار «{src}» در volumes سطح بالا اعلان نشده")
            else:
                used_named.add(src)
                covered = any(v == tgt or v.startswith(tgt + "/") for v in env.values()) or (tgt in code_text_all)
                if not covered and name not in THIRD_PARTY_SERVICES:
                    target_uncovered.append(f"{name}: مقصد «{tgt}» در env یا کد ارجاع نمی‌گیرد")

    if flag_bad:
        add("D1", "Volume", "اعلان volumeهای نام‌دار و ساختار mountها", "FAIL", "؛ ".join(flag_bad))
    else:
        add("D1", "Volume", "اعلان volumeهای نام‌دار و ساختار mountها", "PASS",
            f"استفاده‌شده: {', '.join(sorted(used_named))}")
    unused = declared - used_named
    if unused:
        add("D2", "Volume", "volumeهای اعلان‌شده ولی بلااستفاده", "WARN",
            "مصرف نمی‌شوند: " + ", ".join(sorted(unused)))
    else:
        add("D2", "Volume", "volumeهای اعلان‌شده ولی بلااستفاده", "PASS",
            "همهٔ volumeهای اعلان‌شده مصرف می‌شوند")
    if bind_ok:
        add("D3", "Volume", "وجود bind-mountهای نسبی روی دیسک", "PASS",
            "؛ ".join(bind_ok))
    else:
        add("D3", "Volume", "وجود bind-mountهای نسبی روی دیسک", "WARN", "bind-mount ایستا یافت نشد")
    if bind_defer:
        add("D4", "Volume", "bind-mount مبتنی بر متغیر میزبان", "DEFER",
            "مسیر میزبان در زمان اجرا مقدار می‌گیرد — " + "؛ ".join(bind_defer))
    if flag_bad:
        pass
    if target_uncovered:
        add("D5", "Volume", "مقصد volume در پیکربندی/کد ارجاع می‌گیرد", "WARN",
            "؛ ".join(target_uncovered) + " — یا mount زائد است یا مسیر مقصد در کد استفاده نمی‌شود")
    else:
        add("D5", "Volume", "مقصد volume در پیکربندی/کد ارجاع می‌گیرد", "PASS",
            "تمام مقاصد با env یا کد هم‌خوان‌اند")

    # ═══════════════════ E) متغیرهای محیطی و .env.example ═══════════════════
    if req_vars:
        add("E1", "Env", "متغیرهای الزامی ‎${VAR:?…} در compose/Caddyfile", "PASS",
            "؛ ".join(f"{k} ({(v or 'الزامی')[:40]})" for k, v in sorted(req_vars.items())))
    else:
        add("E1", "Env", "متغیرهای الزامی ‎${VAR:?…} در compose/Caddyfile", "WARN",
            "هیچ سخت‌گیری الزامی تعریف نشده")
    if ENV_EXAMPLE.is_file():
        ex_lines = ENV_EXAMPLE.read_text(encoding="utf-8").splitlines()
        active, commented = {}, {}
        for raw in ex_lines:
            s = raw.strip()
            if not s or s.startswith("#"):
                m = re.match(r"#\s*([A-Z_][A-Z0-9_]*)=", s)
                if m:
                    commented[m.group(1)] = ""
                continue
            k, _, v = s.partition("=")
            if re.match(r"^[A-Z_][A-Z0-9_]*$", k):
                active[k] = v
        missing_req = [k for k in req_vars if k not in active]
        if missing_req:
            add("E2", "Env", "متغیرهای الزامی در deploy/.env.example (فعال و بدون کامنت)", "FAIL",
                "غایب: " + ", ".join(sorted(missing_req)))
        else:
            add("E2", "Env", "متغیرهای الزامی در deploy/.env.example (فعال و بدون کامنت)", "PASS",
                ", ".join(sorted(req_vars)))
        documented = set(active) | set(commented)
        recommended = set(opt_vars) | {
            "NOOR_MAX_RESULTS", "NOOR_SEARCH_SESSION_TTL", "NOOR_OS_INDEX",
            "NOOR_SESSION_MAX_AGE", "NOOR_SESSION_IDLE", "NOOR_SEARCH_TIMEOUT",
            "NOOR_MAX_VERIFY", "NOOR_INDEX_VERSION", "NOOR_LOGIN_RATE_MAX", "NOOR_LOGIN_RATE_WINDOW",
        }
        missing_opt = sorted(recommended - documented)
        if missing_opt:
            add("E3", "Env", "متغیرهای اختیاری/توصیه‌شده در .env.example مستند شده‌اند", "WARN",
                "مستندنشده: " + ", ".join(missing_opt))
        else:
            add("E3", "Env", "متغیرهای اختیاری/توصیه‌شده در .env.example مستند شده‌اند", "PASS",
                f"{len(recommended)} متغیر اختیاری پوشش داده شد")
        # E4 — هیچ secret واقعی در نمونه نباشد (فقط placeholder)
        real_secrets = []
        for k, v in active.items():
            if len(v) >= 32 and re.fullmatch(r"[A-Za-z0-9+/=_\-]+", v) and any(c.isdigit() for c in v) and any(c.isalpha() for c in v):
                real_secrets.append(k)
        if real_secrets:
            add("E4", "Env", "بدون secret واقعی در .env.example", "FAIL",
                f"مقدار این کلیدها شبیه secret واقعی است: {', '.join(real_secrets)}")
        else:
            add("E4", "Env", "بدون secret واقعی در .env.example", "PASS",
                "همهٔ مقادیر placeholder هستند")
        gi = (REPO / ".gitignore").read_text(encoding="utf-8", errors="ignore") if (REPO / ".gitignore").is_file() else ""
        if re.search(r"(?m)^\.env", gi):
            add("E5", "Env", "‎.env واقعی از git مستثناست (‎.gitignore)", "PASS", "الگوی .env* یافت شد")
        else:
            add("E5", "Env", "‎.env واقعی از git مستثناست (‎.gitignore)", "FAIL", "الگوی .env* در .gitignore نیست")
    else:
        add("E2", "Env", "deploy/.env.example", "FAIL", "فایل وجود ندارد — الگوی متغیرهای الزامی مستند نشده")
        add("E3", "Env", "متغیرهای اختیاری مستند", "DEFER", "به‌همان دلیل")
        add("E4", "Env", "بدون secret واقعی", "DEFER", "به‌همان دلیل")
        add("E5", "Env", "‎.gitignore", "DEFER", "بررسی با نبود .env.example بی‌معنا نیست ولی اینجا نادیده گرفته شد")

    # ═══════════════════ F) depends_on و ports و SEC-07 ═══════════════════
    bad_dep = []
    for name, svc in sorted(services.items()):
        deps = (svc or {}).get("depends_on") or []
        if isinstance(deps, dict):
            deps = list(deps.keys())
        for d in deps:
            if d not in services:
                bad_dep.append(f"{name} → {d}")
    if bad_dep:
        add("F1", "Compose", "مقصدهای depends_on سرویس موجودند", "FAIL", "؛ ".join(bad_dep))
    else:
        deps_txt = "; ".join(
            f"{n} → {','.join(services[n].get('depends_on') or [])}" for n in sorted(services)
            if services[n].get("depends_on"))
        add("F1", "Compose", "مقصدهای depends_on سرویس موجودند", "PASS", deps_txt)

    port_bad = []
    for name, svc in sorted(services.items()):
        for p in (svc or {}).get("ports") or []:
            ps = str(p)
            if isinstance(p, dict):
                ps = f"{p.get('published', '')}:{p.get('target', '')}"
            for side in ps.split(":"):
                if side and not re.fullmatch(r"\d+(-\d+)?(/tcp|/udp)?", side):
                    port_bad.append(f"{name}: «{p}»")
                elif side and "-" in side:
                    a, b = side.split("-")
                    if not (1 <= int(a) <= int(b) <= 65535):
                        port_bad.append(f"{name}: بازهٔ نامعتبر «{p}»")
                elif side and not (1 <= int(side.split('/')[0]) <= 65535):
                    port_bad.append(f"{name}: پورت خارج از بازه «{p}»")
    if port_bad:
        add("F2", "Compose", "قالب نگاشت پورت‌ها (میزبان:کانتینر)", "FAIL", "؛ ".join(port_bad))
    else:
        pub = "; ".join(f"{n}: {services[n].get('ports')}" for n in sorted(services) if services[n].get("ports"))
        add("F2", "Compose", "قالب نگاشت پورت‌ها (میزبان:کانتینر)", "PASS",
            pub or "هیچ سرویسی پورت منتشر نمی‌کند")

    os_svc = services.get("opensearch") or {}
    if "opensearch" in services:
        if os_svc.get("ports"):
            add("F3", "SEC-07", "سرویس opensearch هیچ ports: ندارد", "FAIL",
                f"پورت منتشرشده: {os_svc['ports']} — OpenSearch نباید به اینترنت منتشر شود")
        else:
            add("F3", "SEC-07", "سرویس opensearch هیچ ports: ندارد", "PASS",
                "فقط شبکهٔ داخلی compose — الزام SEC-07 برقرار است")
        leaked = [n for n, svc in services.items() for p in map(str, svc.get("ports") or [])
                  if "9200" in str(p) or "9300" in str(p)]
        if leaked:
            add("F4", "SEC-07", "هیچ سرویسی 9200/9300 منتشر نمی‌کند", "FAIL", f"توسط {', '.join(leaked)}")
        else:
            add("F4", "SEC-07", "هیچ سرویسی 9200/9300 منتشر نمی‌کند", "PASS", "پورت‌های OS فقط داخلی")

    # ═══════════════════ G) سخت‌سازی ═══════════════════
    hc = os_svc.get("healthcheck") or {}
    if hc.get("test"):
        add("G1", "Harden", "healthcheck برای opensearch", "PASS", f"test={hc['test']}؛ interval={hc.get('interval')}")
    else:
        add("G1", "Harden", "healthcheck برای opensearch", "FAIL", "بدون healthcheck آماده‌شدن api قابل‌اتکا نیست")

    def ro_check(name, need):
        svc = services.get(name) or {}
        ro = svc.get("read_only") is True
        tmpfs = svc.get("tmpfs")
        if need:
            ok = ro and bool(tmpfs)
            add("G2" if name == "web" else "G3", "Harden",
                f"سرویس {name} — read_only: true" + (" و tmpfs" if need else ""), "PASS" if ok else "FAIL",
                f"read_only={svc.get('read_only')}؛ tmpfs={tmpfs}")
        else:
            add("G4", "Harden", f"سرویس {name} — read_only و tmpfs (توصیه‌شده)",
                "PASS" if (ro and tmpfs) else "WARN",
                f"read_only={svc.get('read_only')}؛ tmpfs={tmpfs}")

    ro_check("web", True)
    ro_check("api", True)
    ro_check("worker", False)

    for name, df_path in sorted(dockerfile_of.items()):
        text = df_text[df_path.name]
        has_hc = "HEALTHCHECK" in text
        svc = services.get(name) or {}
        disabled = isinstance(svc.get("healthcheck"), dict) and svc["healthcheck"].get("disable") is True
        if has_hc and not disabled:
            add("G5", "Harden", f"سرویس {name} — healthcheck image فعال یا خاموش‌شدهٔ آگاهانه", "PASS",
                "healthcheck در Dockerfile تعریف شده")
        elif has_hc and disabled:
            add("G5", "Harden", f"سرویس {name} — healthcheck image فعال یا خاموش‌شدهٔ آگاهانه", "PASS",
                "healthcheck image برای این نقش به‌صورت صریح خاموش شده (disable: true)")
        elif disabled:
            add("G5", "Harden", f"سرویس {name} — healthcheck image فعال یا خاموش‌شدهٔ آگاهانه", "PASS",
                "بدون healthcheck در image و با disable: true")
        else:
            add("G5", "Harden", f"سرویس {name} — healthcheck image فعال یا خاموش‌شدهٔ آگاهانه", "WARN",
                "نه در Dockerfile هست و نه خاموش شده — وابسته به سیاست عملیاتی")

    # ═══════════════════ H) Caddyfile در برابر compose ═══════════════════
    if data["caddy_text"]:
        upstreams = re.findall(r"(?m)^\s*reverse_proxy\s+([^\s{]+)", data["caddy_text"])
        add("H1", "Caddy", "تجزیهٔ Caddyfile.prod", "PASS",
            f"{len(upstreams)} ارجاع reverse_proxy: {', '.join(sorted(set(upstreams)))}")
        # پورت داخلی هر سرویس: EXPOSE در Dockerfile + NOOR_HTTP_PORT
        internal = {}
        for n in services:
            ports = set()
            dfp = dockerfile_of.get(n)
            if dfp:
                ports |= set(img_expose.get(dfp.name, []))
            env = env_map((services[n] or {}).get("environment"))
            if env.get("NOOR_HTTP_PORT", "").isdigit():
                ports.add(env["NOOR_HTTP_PORT"])
            if services[n].get("image") and n in THIRD_PARTY_SERVICES:
                ports.add("*")  # تصویر ثالث — محدود نمی‌کنیم
            internal[n] = ports
        bad_up = []
        for up in sorted(set(upstreams)):
            host, _, port = up.partition(":")
            if host not in services:
                bad_up.append(f"«{up}» سرویسی به نام {host} در compose نیست")
            elif port and "*" not in internal[host] and port not in internal[host]:
                bad_up.append(f"«{up}» پورت {port} برای {host} اعلان نشده (EXPOSE/NOOR_HTTP_PORT={sorted(internal[host])})")
        if bad_up:
            add("H2", "Caddy", "تطبیق upstreamها با سرویس‌ها و پورت‌های داخلی", "FAIL", "؛ ".join(bad_up))
        else:
            add("H2", "Caddy", "تطبیق upstreamها با سرویس‌ها و پورت‌های داخلی", "PASS",
                "؛ ".join(sorted(set(upstreams))) + " همگی معتبرند")
    else:
        add("H1", "Caddy", "تجزیهٔ Caddyfile.prod", "FAIL", "فایل خوانده نشد")

    # ═══════════════════ I) هم‌خوانی env با کد ═══════════════════
    std_env = {"NODE_ENV"}
    warn_unread, ok_read = [], []
    for name in sorted(services):
        if name in THIRD_PARTY_SERVICES:
            continue  # env تصاویر ثالث (OPENSEARCH_*، discovery.type و…) با خود image تعریف می‌شود
        env = env_map((services[name] or {}).get("environment"))
        for k in sorted(env):
            if k in std_env:
                ok_read.append(f"{name}:{k} (استاندارد runtime)")
            elif k in go_vars:
                ok_read.append(f"{name}:{k} → {go_vars[k]}")
            elif k in fe_vars:
                ok_read.append(f"{name}:{k} → {fe_vars[k]}")
            else:
                warn_unread.append(f"{name}:{k}")
    if warn_unread:
        add("I1", "Code", "هر env تعریف‌شده در سرویس‌های خودی در کد خوانده می‌شود", "WARN",
            "بدون مصرف‌کننده: " + ", ".join(warn_unread))
    else:
        add("I1", "Code", "هر env تعریف‌شده در سرویس‌های خودی در کد خوانده می‌شود", "PASS",
            f"{len(ok_read)} متغیر همه دارای مصرف‌کننده‌اند")

    web_env = env_map((services.get("web") or {}).get("environment"))
    web_must = ["NOOR_API_INTERNAL_URL", "NOOR_SERVICE_TOKEN", "NOOR_PDF_EXPORT_DIR"]
    web_miss = [k for k in web_must if k not in web_env]
    if web_miss:
        add("I2", "Code", "envهای لازم وب (runner PDF/BFF) در compose", "FAIL",
            f"غایب: {', '.join(web_miss)} — fallback کد مسیر سندباکس است و در کانتینر کار نمی‌کند")
    else:
        add("I2", "Code", "envهای لازم وب (runner PDF/BFF) در compose", "PASS", ", ".join(web_must))
    web_opt = [k for k in ("NOOR_CHROME_PATH", "NOOR_FONT_DIR") if k not in web_env]
    add("I3", "Code", "envهای دارای پیش‌فرض image (CHROME_PATH/FONT_DIR) در وب", "PASS" if not web_opt else "WARN",
        "همه تنظیم شده‌اند و با ENV تصویر برابرند" if not web_opt
        else f"تنظیم نشده (پیش‌فرض image استفاده می‌شود): {', '.join(web_opt)}")

    api_env = env_map((services.get("api") or {}).get("environment"))
    if api_env.get("NOOR_ENGINE") == "opensearch":
        trio = ["NOOR_OPENSEARCH_URL", "NOOR_OPENSEARCH_USER", "NOOR_OPENSEARCH_PASSWORD"]
        miss = [k for k in trio if k not in api_env]
        if miss:
            add("I4", "Code", "حالت opensearch در api — envهای لازم", "FAIL", "غایب: " + ", ".join(miss))
        else:
            add("I4", "Code", "حالت opensearch در api — envهای لازم", "PASS",
                f"URL={api_env['NOOR_OPENSEARCH_URL']} user={api_env['NOOR_OPENSEARCH_USER']}")
    else:
        add("I4", "Code", "حالت opensearch در api — envهای لازم", "PASS",
            f"NOOR_ENGINE={api_env.get('NOOR_ENGINE', 'پیش‌فرض local')}")

    # I5 — هم‌ترازی موتور api و worker (worker تنها نویسندهٔ نمایه است)
    wk_env = env_map((services.get("worker") or {}).get("environment"))
    if "worker" in services and api_env.get("NOOR_ENGINE") == "opensearch":
        if wk_env.get("NOOR_ENGINE") != "opensearch":
            add("I5", "Code", "هم‌ترازی NOOR_ENGINE میان api و worker", "FAIL",
                f"api=opensearch ولی worker={wk_env.get('NOOR_ENGINE', 'تنظیم‌نشده → local')} — "
                "worker هرگز bulk را به OpenSearch نمی‌زند و نمایهٔ OS هرگز به‌روز نمی‌شود")
        else:
            trio = ["NOOR_OPENSEARCH_URL", "NOOR_OPENSEARCH_USER", "NOOR_OPENSEARCH_PASSWORD"]
            miss = [k for k in trio if k not in wk_env]
            if miss:
                add("I5", "Code", "هم‌ترازی NOOR_ENGINE میان api و worker", "FAIL",
                    "worker بدون " + ", ".join(miss) + " نمی‌تواند bulk بزند")
            else:
                add("I5", "Code", "هم‌ترازی NOOR_ENGINE میان api و worker", "PASS",
                    "هر دو opensearch؛ worker envهای اتصال را هم دارد")
    else:
        add("I5", "Code", "هم‌ترازی NOOR_ENGINE میان api و worker", "PASS", "api روی opensearch نیست")

    # I6 — دسترس‌پذیری api از کانتینر worker (127.0.0.1 در شبکهٔ compose کار نمی‌کند)
    wk_code = (REPO / "mini-services/noor-api/cmd/worker/main.go")
    wk_src = wk_code.read_text(encoding="utf-8", errors="ignore") if wk_code.is_file() else ""
    if "worker" in services:
        if "NOOR_API_INTERNAL_URL" not in wk_src:
            add("I6", "Code", "نشانی api از کانتینر worker قابل‌تنظیم است", "FAIL",
                "cmd/worker به‌صورت هاردکد http://127.0.0.1:<port> را صدا می‌زند؛ در کانتینر جدا "
                "127.0.0.1 به خود worker می‌رسد نه api — صف هرگز claim نمی‌شود")
        elif not wk_env.get("NOOR_API_INTERNAL_URL"):
            add("I6", "Code", "نشانی api از کانتینر worker قابل‌تنظیم است", "FAIL",
                "کد NOOR_API_INTERNAL_URL را می‌خواند ولی compose برای worker ست نکرده — "
                "پیش‌فرض 127.0.0.1 در شبکهٔ compose به api نمی‌رسد")
        else:
            host = re.match(r"[a-z]+://([^:/]+)", wk_env["NOOR_API_INTERNAL_URL"])
            ok = bool(host and host.group(1) in services)
            add("I6", "Code", "نشانی api از کانتینر worker قابل‌تنظیم است", "PASS" if ok else "FAIL",
                f"NOOR_API_INTERNAL_URL={wk_env['NOOR_API_INTERNAL_URL']}"
                + (f" (سرویس {host.group(1)})" if ok else " (میزبانِ ناشناخته)"))

    # I7 — OPENSEARCH_INITIAL_ADMIN_PASSWORD روی سرویس opensearch
    if "opensearch" in services:
        os_env = env_map(os_svc.get("environment"))
        if os_env.get("OPENSEARCH_INITIAL_ADMIN_PASSWORD"):
            add("I7", "SEC", "OPENSEARCH_INITIAL_ADMIN_PASSWORD روی opensearch ست شده", "PASS",
                "از NOOR_OS_ADMIN_PASSWORD با :? — بدون آن بالا نمی‌آید")
        else:
            add("I7", "SEC", "OPENSEARCH_INITIAL_ADMIN_PASSWORD روی opensearch ست شده", "FAIL",
                "نسخهٔ 2.12+ بدون گذرواژهٔ اولیه استارت نمی‌شود")
        # I8 — هم‌خوانی https با SSL داخلی OS
        url = api_env.get("NOOR_OPENSEARCH_URL", "")
        ssl_on = str(os_env.get("plugins.security.ssl.http.enabled", "")).lower() == "true"
        if url.startswith("https://") and ssl_on:
            add("I8", "SEC", "اسکیمای NOOR_OPENSEARCH_URL با SSL داخلی OS هم‌خوان است", "PASS",
                f"{url} ↔ plugins.security.ssl.http.enabled=true")
        elif url.startswith("http://") and not ssl_on:
            add("I8", "SEC", "اسکیمای NOOR_OPENSEARCH_URL با SSL داخلی OS هم‌خوان است", "PASS",
                "هر دو بدون TLS داخلی")
        else:
            add("I8", "SEC", "اسکیمای NOOR_OPENSEARCH_URL با SSL داخلی OS هم‌خوان است", "FAIL",
                f"URL={url} ولی ssl.http.enabled={os_env.get('plugins.security.ssl.http.enabled')}")
        # I9 — کاربر NOOR_OPENSEARCH_USER باید در OS ایجاد شده باشد (ایستا فقط هشدار)
        if api_env.get("NOOR_OPENSEARCH_USER"):
            has_user_cfg = any("internal_users" in str(m) for m in (os_svc.get("volumes") or []))
            if has_user_cfg:
                add("I9", "SEC", "پیکربندی کاربر سرویس OS (NOOR_OPENSEARCH_USER)", "PASS",
                    "internal_users.yml به کانتینر OS mount شده")
            else:
                add("I9", "SEC", "پیکربندی کاربر سرویس OS (NOOR_OPENSEARCH_USER)", "WARN",
                    f"کاربر «{api_env['NOOR_OPENSEARCH_USER']}» در compose ایجاد نمی‌شود (تصویر OS فقط کاربر admin "
                    "اولیه دارد) — باید روی میزبان با securityadmin ایجاد شود؛ در غیر این صورت api در استارت شکست می‌خورد")

    # ═══════════════════ J) معناشناسی اسکیما + مالکیت volume ═══════════════════
    mem_bad = [f"{n}: {services[n].get('mem_limit')}" for n in services
               if services[n].get("mem_limit") and not re.fullmatch(
                   r"\d+(\.\d+)?(b|k|m|g|kb|mb|gb)?", str(services[n]["mem_limit"]))]
    if mem_bad:
        add("J1", "Schema", "قالب mem_limit همهٔ سرویس‌ها", "FAIL", "؛ ".join(mem_bad))
    else:
        mems = "; ".join(f"{n}={services[n]['mem_limit']}" for n in sorted(services) if services[n].get("mem_limit"))
        add("J1", "Schema", "قالب mem_limit همهٔ سرویس‌ها", "PASS", mems)

    ul = (os_svc.get("ulimits") or {})
    ul_ok = all(
        (isinstance(v, int)) or
        (isinstance(v, dict) and {"soft", "hard"} <= set(v) and all(isinstance(x, int) for x in v.values()))
        for v in ul.values())
    add("J2", "Schema", "ساختار ulimits (soft/hard عددی)", "PASS" if ul_ok else "FAIL",
        "; ".join(f"{k}={v}" for k, v in ul.items()) or "بدون ulimits")

    tmp_bad = []
    for n, svc in services.items():
        t = svc.get("tmpfs")
        if t is None:
            continue
        if isinstance(t, str):
            t = [t]
        if not isinstance(t, list):
            tmp_bad.append(f"{n}: نوع tmpfs نامعتبر")
            continue
        for item in t:
            path, _, opt = str(item).partition(":")
            if not path.startswith("/"):
                tmp_bad.append(f"{n}: مسیر tmpfs مطلق نیست «{item}»")
            elif opt and not re.fullmatch(r"([a-z]+=[^,:]+(,[a-z]+=[^,:]+)*)?", opt):
                tmp_bad.append(f"{n}: گزینه‌های tmpfs نامعتبر «{opt}»")
    add("J3", "Schema", "قالب tmpfs (مسیر مطلق + گزینه‌ها)", "PASS" if not tmp_bad else "FAIL",
        "؛ ".join(tmp_bad) or "tmpfsهای /tmp سرویس‌های خودی معتبرند")

    rs_bad = [f"{n}: {services[n].get('restart')}" for n in services
              if services[n].get("restart") and not (
                  str(services[n]["restart"]) in ("no", "always", "unless-stopped")
                  or str(services[n]["restart"]).startswith("on-failure"))]
    rs_txt = "؛ ".join(f"{n}={services[n]['restart']}" for n in sorted(services) if services[n].get("restart"))
    add("J4", "Schema", "مقادیر restart مجاز", "PASS" if not rs_bad else "FAIL",
        "؛ ".join(rs_bad) or (rs_txt or "بدون restart"))

    # J5 — volume نوشتنی برای کاربر غیرریشه: مقصد باید در image ساخته و chown شده باشد
    own_bad, own_ok = [], []
    for name in sorted(services):
        if name in THIRD_PARTY_SERVICES or name not in dockerfile_of:
            continue
        text = df_text[dockerfile_of[name].name]
        user_m = re.search(r"(?m)^USER\s+(\S+)", text)
        non_root = bool(user_m) and user_m.group(1) not in ("root", "0")
        mkdirs = set()
        for instr, argstr in dockerfile_instructions(text):
            if instr == "RUN":
                m = re.search(r"mkdir\s+(?:-p\s+)?([^\n;&|]+)", argstr)
                if m:
                    mkdirs |= {t for t in m.group(1).split() if t.startswith("/")}
        chowned = bool(re.search(r"chown[^\n]*noor", text))
        for mount in services[name].get("volumes") or []:
            if isinstance(mount, dict):
                mtype, tgt, ro = mount.get("type"), mount.get("target", ""), str(mount.get("read_only", False)).lower() == "true"
                src_named = mtype == "volume"
            else:
                prot = protect_vars(mount)
                parts = [restore_var(mount, x.strip()) for x in prot.split(":")]
                src_named = not parts[0].startswith((".", "/", PLACEHOLDER)) and "${" not in parts[0]
                tgt = parts[1] if len(parts) > 1 else ""
                ro = len(parts) > 2 and "ro" in parts[2].split(",")
            if not (non_root and src_named and tgt and not ro):
                continue
            cover = tgt in mkdirs or any(tgt.startswith(m + "/") for m in mkdirs)
            if cover and chowned:
                own_ok.append(f"{name}:{tgt}")
            else:
                own_bad.append(f"{name}: volume نوشتنی روی «{tgt}» با کاربر غیرریشه — مسیر در {dockerfile_of[name].name} "
                               "mkdir/chown نشده؛ docker volume تازه را root-owned می‌سازد و نوشتن شکست می‌خورد")
    if own_bad:
        add("J5", "Schema", "مالکیت volumeهای نوشتنی برای کاربر غیرریشه", "FAIL", "؛ ".join(own_bad))
    else:
        add("J5", "Schema", "مالکیت volumeهای نوشتنی برای کاربر غیرریشه", "PASS",
            "؛ ".join(own_ok) if own_ok else "volume نوشتنیِ متعلق به سرویس غیرریشه وجود ندارد")

    # J6 — باینریِ نقش سرویس‌های Go (ENTRYPOINT/CMD تصویر × command/entrypoint compose)
    bin_bad, bin_ok = [], []
    for name in sorted(dockerfile_of):
        if name not in ("api", "worker"):
            continue  # وب CMD ["node", "server.js"] دارد — نقشش از نوع image می‌آید
        dfp = dockerfile_of[name]
        img_e, img_c = img_entry.get(dfp.name), img_cmd.get(dfp.name)
        svc_e, svc_c = services[name].get("entrypoint"), services[name].get("command")
        if isinstance(svc_e, str):
            svc_e = [svc_e]
        if isinstance(svc_c, str):
            svc_c = [svc_c]
        eff = (svc_e or img_e or svc_c or img_c or [None])[0]
        binary = Path(str(eff)).name if eff else None
        expected = "worker" if name == "worker" else "api"
        if binary == expected and binary in built_bins:
            bin_ok.append(f"{name} → {binary}")
        elif binary is None:
            bin_bad.append(f"{name}: نه ENTRYPOINT دارد نه CMD و نه command — باینری نامشخص")
        else:
            bin_bad.append(f"{name}: باینری مؤثر «{binary}» است ولی نقش این سرویس «{expected}» است "
                           f"(ENTRYPOINT image={img_e}، command compose={svc_c})")
    if bin_bad:
        add("J6", "Schema", "باینریِ مؤثر هر سرویس با نقش آن هم‌خوان است", "FAIL", "؛ ".join(bin_bad))
    else:
        add("J6", "Schema", "باینریِ مؤثر هر سرویس با نقش آن هم‌خوان است", "PASS",
            "؛ ".join(bin_ok) + " — command: [worker] واقعاً باینری worker را اجرا می‌کند")

    summary()
    return 1 if has_fail() else 0


def ctx_root_of(compose, services):
    """ریشهٔ context بیلد (برای .dockerignore) — همهٔ بیلدها context یکسانی دارند."""
    for svc in services.values():
        b = (svc or {}).get("build")
        if b:
            ctx = (b.get("context") or ".") if isinstance(b, dict) else b
            return (DEPLOY / ctx).resolve()
    return REPO


def restore_var(original_token, part):
    """بازگردانی ${...} از رشتهٔ محافظت‌شده با ترتیب اصلی."""
    out, i = [], 0
    vars_iter = list(re.finditer(r"\$\{[^}]*\}", original_token))
    # ساده: اگر جانگهدار در part است، اولین ${...} نساخته‌نشده را برگردان
    for ch in part:
        if ch == PLACEHOLDER:
            out.append(vars_iter[i].group(0) if i < len(vars_iter) else "${?}")
            i += 1
        else:
            out.append(ch)
    return "".join(out)


def summary():
    print("\n" + "═" * 78)
    print("جدول جمع‌بندی اعتبارسنجی ایستای استقرار (deploy/docker-compose.yml)")
    print("═" * 78)
    print(f"{'ID':<5}{'دسته':<12}{'آزمون':<58}{'نتیجه'}")
    print("-" * 78)
    for cid, cat, title, status, _ in results:
        print(f"{cid:<5}{cat:<12}{title[:56]:<58}{STATUS_ICON[status].split()[0]}")
    print("-" * 78)
    counts = {s: sum(1 for r in results if r[3] == s) for s in ("PASS", "FAIL", "WARN", "DEFER")}
    total = len(results)
    print(f"شمار آزمون‌ها: {total} = {counts['PASS']} PASS / {counts['FAIL']} FAIL / "
          f"{counts['WARN']} WARN / {counts['DEFER']} DEFER")
    if counts["FAIL"] == 0:
        print("نتیجهٔ کل: PASS — اعتبارسنجی ایستا کامل گذشت.")
        print("تنها نکتهٔ باز (بیرون از توان این سندباکس): اجرای واقعی docker compose (بند د-۱۰ گزارش ممیزی).")
        for cid, cat, title, status, det in results:
            if status == "WARN":
                print(f"  • WARN {cid}: {title} — {det[:90]}")
            if status == "DEFER":
                print(f"  • DEFER {cid}: {title} — {det[:90]}")
    else:
        print("نتیجهٔ کل: FAIL — موارد زیر باید در فایل‌های استقرار رفع شوند:")
        for cid, cat, title, status, det in results:
            if status == "FAIL":
                print(f"  • FAIL {cid}: {title} — {det[:120]}")


if __name__ == "__main__":
    sys.exit(main())
