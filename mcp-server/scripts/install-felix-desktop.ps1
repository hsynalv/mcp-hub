# Felix Desktop — Windows Scheduled Task kurulumu (oturum acilisi + PC acilisi)
# Kullanım: powershell -ExecutionPolicy Bypass -File scripts/install-felix-desktop.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$McpServerDir = Resolve-Path (Join-Path $ScriptDir "..")
$WrapperScript = Join-Path $ScriptDir "run-felix-desktop-sidecar.ps1"
$ConfigDir = if ($env:FELIX_DESKTOP_CONFIG) { $env:FELIX_DESKTOP_CONFIG } else { Join-Path $env:USERPROFILE ".config\felix-desktop" }
$EnvFile = Join-Path $ConfigDir "env"
$TaskName = "FelixDesktopSidecar"
$NodeBin = (Get-Command node -ErrorAction SilentlyContinue).Source

if (-not $NodeBin) {
  Write-Error "Node.js bulunamadi. https://nodejs.org kurun (18+)."
}

if (-not (Test-Path $WrapperScript)) {
  Write-Error "Wrapper script bulunamadi: $WrapperScript"
}

New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

if (-not (Test-Path $EnvFile)) {
  @"
# Felix Desktop — duzenleyin ve gorevi yeniden baslatin
SIDECAR_PORT=9477
SIDECAR_AUTH_TOKEN=
# Hub production'da LOCAL_FS_ON_SERVER=false olmali
"@ | Set-Content -Path $EnvFile -Encoding UTF8
  Write-Host "Olusturuldu: $EnvFile"
  Write-Host "Eslestirmeden aldiginiz SIDECAR_AUTH_TOKEN degerini bu dosyaya yazin."
}

Get-Content $EnvFile | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  $parts = $_ -split '=', 2
  if ($parts.Length -eq 2) {
    $key = $parts[0].Trim()
    $val = $parts[1].Trim()
    Set-Item -Path "env:$key" -Value $val
  }
}

if (-not $env:SIDECAR_AUTH_TOKEN) {
  Write-Host ""
  Write-Host "SIDECAR_AUTH_TOKEN bos. Once hub'da eslestirin:"
  Write-Host "  1. Web panel -> Felix Desktop -> Eslestirme kodu (admin)"
  Write-Host "  2. Pair sonrasi authToken'i $EnvFile icine yapistirin"
  Write-Host "  3. Bu scripti tekrar calistirin"
  exit 1
}

$HealthPort = if ($env:SIDECAR_PORT) { $env:SIDECAR_PORT } else { "9477" }

$Action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$WrapperScript`"" `
  -WorkingDirectory $McpServerDir

# Oturum acilisi (ana tetikleyici — masaustu otomasyonu icin kullanici oturumu gerekir)
$TriggerLogon = New-ScheduledTaskTrigger -AtLogOn

# PC acilisi (otomatik oturum acan makineler icin; 2 dk gecikme)
$TriggerStartup = New-ScheduledTaskTrigger -AtStartup
$TriggerStartup.Delay = "PT2M"

$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$Existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Existing) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

Register-ScheduledTask `
  -TaskName $TaskName `
  -Description "Felix Desktop sidecar — oturum acilisi ve PC acilisinda otomatik baslar" `
  -Action $Action `
  -Trigger @($TriggerLogon, $TriggerStartup) `
  -Settings $Settings `
  -Principal $Principal `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "Felix Desktop gorevi kaydedildi ve baslatildi: $TaskName"
Write-Host "  Tetikleyiciler: oturum acilisi + PC acilisi (2 dk gecikme)"
Write-Host "  Cokme sonrasi: otomatik yeniden baslatma (1 dk aralik)"
Write-Host "  Config: $EnvFile"
Write-Host "  Log:    $ConfigDir\stdout.log / stderr.log"
Write-Host "  Health: http://127.0.0.1:${HealthPort}/health"
Write-Host "  Manuel: Start-ScheduledTask -TaskName $TaskName"
Write-Host "  Durdur: Stop-ScheduledTask -TaskName $TaskName"
Write-Host "  Kaldir: Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
