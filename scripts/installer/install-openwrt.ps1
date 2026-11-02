# F50-MU3350S-OpenWRT: run the patched mu300-linux installer (OpenWrt on the SD card).
#
# Prerequisites:
#   * mu300-linux sources patched:  node scripts/patch-mu300-installer.mjs --installer <src>\install.ps1
#   * device in Android, reachable over the USB network (192.168.0.1), root channel up
#     (node scripts/setup-device-root.mjs)
#   * Python 3.8+ (the installer installs lz4 itself when missing)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File install-openwrt.ps1 -SrcDir C:\path\to\mu300-src
#   powershell -ExecutionPolicy Bypass -File install-openwrt.ps1 -SrcDir ... -Check
param(
  [switch]$Check,
  [string]$SrcDir = "",
  [string]$AnswersFile = "",
  [string]$AdbDir = "C:\f50-work\platform-tools",
  [string]$Serial = ""
)
$ErrorActionPreference = "Stop"
if (-not $SrcDir) { $SrcDir = if ($env:F50_MU300_SRC) { $env:F50_MU300_SRC } else { "C:\f50-work\mu300-src" } }
if (-not (Test-Path (Join-Path $SrcDir "install.ps1"))) { throw "install.ps1 not found in $SrcDir" }
if (-not $AnswersFile) { $AnswersFile = Join-Path $PSScriptRoot "..\answers\mu300-answers.txt" }
$env:PATH = "$AdbDir;$env:PATH"
$env:MU300_USB_ADB_ONLY = "0"    # keep the USB network (root channel + adb-over-TCP live on it)
$env:MU300_NO_SELF_UPDATE = "1"  # do not replace the patched installer
$env:MU300_LANG = "zh"
if (-not $Serial) {
  & adb connect 192.168.0.1:5555 | Out-Null
  $Serial = "192.168.0.1:5555"
}
$env:ANDROID_SERIAL = $Serial
Write-Host ("device: " + $Serial + "   answers: " + $AnswersFile)
Push-Location (Split-Path $SrcDir -Parent)
try {
  if ($Check) { & (Join-Path $SrcDir "install.ps1") -Check -AnswersFile $AnswersFile -Lang zh }
  else { & (Join-Path $SrcDir "install.ps1") -AnswersFile $AnswersFile -Lang zh }
} finally { Pop-Location }
