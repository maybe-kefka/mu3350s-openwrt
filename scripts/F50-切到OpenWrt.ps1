#requires -version 5.1
# Switch the device from Android back to OpenWrt and make OpenWrt the lasting default.
# Requires: USB cable + adb + the root channel (Samba root preexec) prepared earlier, and the
# boot-state file written by F50-切到Android.ps1. See docs/06-dual-boot-switching.md.
$ErrorActionPreference = 'Continue'
$WorkDir = if ($env:F50_WORK_DIR) { $env:F50_WORK_DIR } else { 'C:\f50-work' }
$adb = if ($env:F50_ADB) { $env:F50_ADB } else { Join-Path $WorkDir 'platform-tools\adb.exe' }
$miscFile = Join-Path $WorkDir 'misc-linux.bin'
if (-not (Test-Path $miscFile)) { Write-Host "Missing $miscFile - run F50-切到Android.ps1 once while OpenWrt is running." -ForegroundColor Red; exit 1 }
$hex = (Get-Content $miscFile -Raw).Trim()
if ($hex.Length -ne 64) { Write-Host 'boot-state file is invalid' -ForegroundColor Red; exit 1 }
$oct = ''
for ($i = 0; $i -lt 64; $i += 2) { $b = [Convert]::ToInt32($hex.Substring($i, 2), 16); $oct += '\' + [Convert]::ToString($b, 8).PadLeft(3, '0') }
Write-Host 'Waiting for Android (USB network 192.168.0.1) ...'
$up = $false
for ($i = 0; $i -lt 60; $i++) {
  try { $r = Invoke-WebRequest -Uri 'http://192.168.0.1/' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { $up = $true; break } } catch {}
  Start-Sleep -Seconds 2
}
if (-not $up) { Write-Host 'Android not reachable - is the device booted in Android and the USB cable connected?' -ForegroundColor Red; exit 1 }
Write-Host 'Triggering the root channel through SMB ...'
net use \\192.168.0.1\F50 /delete /y 2>$null | Out-Null
net use \\192.168.0.1\F50 /user:guest '' 2>$null | Out-Null
Start-Sleep -Seconds 2
$client = $null
try {
  $client = New-Object System.Net.Sockets.TcpClient
  $client.Connect('192.168.0.1', 4444)
  $stream = $client.GetStream()
  $cmd = "printf '$oct' > /data/local/tmp/misc-linux.bin; dd if=/data/local/tmp/misc-linux.bin of=/dev/block/by-name/misc bs=1 seek=2048 conv=notrunc 2>/dev/null; sync; reboot; echo DONE" + [char]10
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($cmd)
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush()
  Start-Sleep -Seconds 3
  Write-Host 'Boot state restored, rebooting into OpenWrt ...' -ForegroundColor Green
} catch { Write-Host ('root channel failed: ' + $_.Exception.Message) -ForegroundColor Red } finally { if ($client) { $client.Close() } }
Write-Host 'After ~60-90 s OpenWrt should be up (USB network 192.168.77.1).'
Start-Sleep -Seconds 5
