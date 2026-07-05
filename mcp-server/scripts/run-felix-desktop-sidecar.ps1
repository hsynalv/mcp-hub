# Felix Desktop sidecar — Windows görev sarmalayıcısı (env + log)
$ErrorActionPreference = "Stop"

$ConfigDir = if ($env:FELIX_DESKTOP_CONFIG) { $env:FELIX_DESKTOP_CONFIG } else { Join-Path $env:USERPROFILE ".config\felix-desktop" }
$EnvFile = Join-Path $ConfigDir "env"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$McpServerDir = Resolve-Path (Join-Path $ScriptDir "..")
$DaemonPath = Join-Path $McpServerDir "bin\sidecar-daemon.js"
$StdoutLog = Join-Path $ConfigDir "stdout.log"
$StderrLog = Join-Path $ConfigDir "stderr.log"

New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

$NodeBin = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeBin) {
  Add-Content -Path $StderrLog -Value "[$(Get-Date -Format o)] Node.js bulunamadi."
  exit 1
}

if (Test-Path $EnvFile) {
  Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    $parts = $_ -split '=', 2
    if ($parts.Length -eq 2) {
      $key = $parts[0].Trim()
      $val = $parts[1].Trim()
      if ($val.StartsWith('"') -and $val.EndsWith('"')) { $val = $val.Substring(1, $val.Length - 2) }
      elseif ($val.StartsWith("'") -and $val.EndsWith("'")) { $val = $val.Substring(1, $val.Length - 2) }
      Set-Item -Path "env:$key" -Value $val
    }
  }
}

$env:FELIX_DESKTOP_CONFIG = $ConfigDir

if (-not $env:SIDECAR_AUTH_TOKEN) {
  Add-Content -Path $StderrLog -Value "[$(Get-Date -Format o)] SIDECAR_AUTH_TOKEN bos - $EnvFile"
  exit 1
}

$HealthPort = if ($env:SIDECAR_PORT) { $env:SIDECAR_PORT } else { "9477" }
Add-Content -Path $StdoutLog -Value "[$(Get-Date -Format o)] Felix Desktop sidecar baslatiliyor (port $HealthPort)"

Set-Location $McpServerDir
& $NodeBin $DaemonPath 2>> $StderrLog 1>> $StdoutLog
