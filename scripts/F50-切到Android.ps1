#requires -version 5.1
# Switch the device from OpenWrt to Android (one boot), saving the current boot state.
# Requires: USB cable + adb (platform-tools). Set F50_WORK_DIR if not C:\f50-work.
$ErrorActionPreference = 'Stop'
$WorkDir = if ($env:F50_WORK_DIR) { $env:F50_WORK_DIR } else { 'C:\f50-work' }
$adb = if ($env:F50_ADB) { $env:F50_ADB } else { Join-Path $WorkDir 'platform-tools\adb.exe' }
$miscFile = Join-Path $WorkDir 'misc-linux.bin'
if (-not (Test-Path $adb)) { Write-Host "adb not found: $adb  (set F50_ADB or F50_WORK_DIR)" -ForegroundColor Red; exit 1 }
Write-Host 'Looking for the OpenWrt device on USB ...'
$devs = & $adb devices 2>$null
$line = @($devs | Where-Object { $_ -match '^MU300LINUX\S+\s+device' }) | Select-Object -First 1
if (-not $line) { Write-Host 'OpenWrt device not found. Check the USB cable and retry.' -ForegroundColor Red; exit 1 }
$serial = ($line -split '\s+')[0]
Write-Host "device: $serial"
& $adb -s $serial shell 'mu300-next-boot linux' | Out-Null
$hex = (& $adb -s $serial shell "dd if=/dev/block/by-name/misc bs=1 skip=2048 count=32 2>/dev/null | od -An -tx1 | tr -d ' \n'") -join ''
$hex = ($hex -replace '[^0-9a-fA-F]','').ToLower()
if ($hex.Length -eq 64) { Set-Content -Path $miscFile -Value $hex -NoNewline; Write-Host "boot state saved: $miscFile" }
else { Write-Host "could not read boot state: $hex" -ForegroundColor Yellow }
& $adb -s $serial shell 'mu300-next-boot android' | Out-Null
& $adb -s $serial shell 'reboot' | Out-Null
Write-Host 'Switching to Android, the device is rebooting ...' -ForegroundColor Green
Write-Host 'After ~60-90 s Android boots (USB network 192.168.0.1).'
Start-Sleep -Seconds 5
