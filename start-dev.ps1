# برپا آوردن ظرف توسعهٔ میزکار نور روی ویندوز (پورت‌ها: وب 3200، API 8080)
# کاربرد:  powershell -ExecutionPolicy Bypass -File start-dev.ps1
# یادداشت:
# - پردازش‌ها با Start-Process مستقل بالا می‌آیند (با بسته‌شدن این شل نمی‌میرند) و لاگ‌ها در data/*-YYYYMMDD.log ریخته می‌شود.
# - اگر پورت اشغال است همان پردازش حفظ می‌شود (ری‌استارت نمی‌کند)؛ برای اجبار، اول خودتان توقف کنید.
# - باینری‌ها اگر موجود نباشند از سورس ساخته می‌شوند؛ اگر بیلد در دسترس نبود پیام روشن می‌دهد.

$ErrorActionPreference = "Stop"
$root = "D:\Noor\app_development"
$apiDir = Join-Path $root "mini-services\noor-api"
$stamp = Get-Date -Format "yyyyMMdd"

function Test-Port([int]$Port) {
  [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

# ---- Go API + worker ----
$env:NOOR_HTTP_PORT = "8080"
$env:NOOR_DATA_DIR = "$apiDir\data"
$env:NOOR_SOURCES_DIR = "$apiDir\data\sources"
$env:NOOR_SERVICE_TOKEN = "dev-internal-token"
$env:NOOR_COOKIE_SECURE = "false"
$env:NOOR_LOGIN_RATE_MAX = "60"

if (-not (Test-Port 8080)) {
  if (-not (Test-Path "$apiDir\bin\api.exe")) {
    Push-Location $apiDir
    go build -o bin\api.exe ./cmd/api
    go build -o bin\worker.exe ./cmd/worker
    Pop-Location
  }
  Start-Process -FilePath "$apiDir\bin\api.exe" -WorkingDirectory $apiDir -WindowStyle Hidden `
    -RedirectStandardOutput "$apiDir\data\api-stdout-$stamp.log" -RedirectStandardError "$apiDir\data\api-stderr-$stamp.log"
  Start-Sleep -Seconds 2
  Start-Process -FilePath "$apiDir\bin\worker.exe" -WorkingDirectory $apiDir -WindowStyle Hidden `
    -RedirectStandardOutput "$apiDir\data\worker-stdout-$stamp.log" -RedirectStandardError "$apiDir\data\worker-stderr-$stamp.log"
  Write-Host "API روی :8080 و worker برپا شد؛ لاگ: data\api-stderr-$stamp.log"
}
else { Write-Host "پورت 8080 از قبل فعال است — دست کاری نمی‌زند." }

# ---- Next.js dev :3200 ----
$env:NEXT_TELEMETRY_DISABLED = "1"
if (-not (Test-Port 3200)) {
  if (Test-Path "$root\.next") { Remove-Item "$root\.next" -Recurse -Force -ErrorAction SilentlyContinue } # جلوگیری از کشِ دیرین (کرش chunk قدیمی)
  Start-Process -FilePath "node" -ArgumentList "node_modules\next\dist\bin\next", "dev", "-p", "3200" -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput "$root\dev-3200-$stamp.log" -RedirectStandardError "$root\dev-3200-$stamp.err.log"
  Write-Host "وب روی :3200 برپا شد؛ لاگ: dev-3200-$stamp.log / .err.log (اولین کامپایل ۱۰–۳۰ ثانیه)"
}
else { Write-Host "پورت 3200 از قبل فعال است — دست کاری نمی‌زند." }

Start-Sleep -Seconds 5
foreach ($p in 3200, 8080) {
  if (Test-Port $p) { Write-Host "✅ :$p UP" } else { Write-Host "❌ :$p DOWN" }
}

# ---- پروب واقعی HTTP (پورت باز ≠ سرویس سالم) ----
# تلاش تا ۶۰ ثانیه؛ 4xx هم «سالم» است (مثلاً نشست بدون کوکی) — فقط 5xx/اتصال ناموفق شکست است.
function Wait-Http([string]$Name, [string]$Url, [int]$Attempts = 30) {
  $last = "بدون تلاش"
  for ($i = 1; $i -le $Attempts; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
      Write-Host "✅ $Name — HTTP $($r.StatusCode)"
      return $true
    }
    catch {
      $resp = $_.Exception.Response
      if ($resp) {
        $code = [int]$resp.StatusCode
        if ($code -lt 500) { Write-Host "✅ $Name — HTTP $code"; return $true }
        $last = "HTTP $code"
      }
      else { $last = $_.Exception.Message }
    }
    Start-Sleep -Seconds 2
  }
  Write-Host "❌ $Name ناموفق — $Attempts تلاش × ۲ ثانیه؛ آخرین خطا: $last"
  return $false
}

Write-Host "— بررسی تناسب سرویس‌ها —"
$apiOk = Wait-Http "API /healthz (8080)" "http://127.0.0.1:8080/healthz"
$webOk = Wait-Http "وب /api/v1/auth/session (3200)" "http://127.0.0.1:3200/api/v1/auth/session"
if (-not ($apiOk -and $webOk)) {
  Write-Host "⚠️ یکی از سرویس‌ها پاسخ نداد؛ لاگ‌های data\api-stderr-$stamp.log و dev-3200-$stamp.err.log را ببینید."
  exit 1
}
Write-Host "🚀 محیط توسعه آماده است: http://127.0.0.1:3200"

