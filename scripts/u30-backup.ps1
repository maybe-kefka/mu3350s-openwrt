# U30 Air (U30AirV1.0.0B33) full-partition backup over the BROM/FDL2 download mode.
# READ-ONLY: runs "r all" then "reset" - no write to the device.
# Needs spd_dump.exe + fdl1-dl.bin + fdl2-dl.bin (spreadtrum_flash / the F50 toolkit build).
# Edit $PT below if yours are elsewhere (default: C:\f50-work\part-tool).
#$ErrorActionPreference = 'Continue'
$PT   = 'C:\f50-work\part-tool'
$SPD  = Join-Path $PT 'bin\spd_dump.exe'
$FDL1 = Join-Path $PT 'bin\fdl1-dl.bin'
$FDL2 = Join-Path $PT 'bin\fdl2-dl.bin'
$BK   = 'C:\Users\kefka\f50-work\u30-backup'
$LOG  = 'C:\f50-work\u30-backup.log'

function Show-Title {
  Clear-Host
  Write-Host ''
  Write-Host '========================================================='
  Write-Host '  ZTE U30 Air - 分区备份（只读，不写入设备）  v2'
  Write-Host '========================================================='
  Write-Host ''
}

function Snapshot {
  $items = @()
  try {
    $devs = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match 'VID_(1782|19D2)' }
    foreach ($d in $devs) {
      $id = $d.InstanceId
      if ($id -match 'VID_1782') { $items += 'BROM/SPRD(1782:4D00)' }
      elseif ($id -match 'VID_19D2&PID_0246') { $items += 'Android RNDIS(19D2:0246)' }
      elseif ($id -match 'VID_19D2&PID_1353') { $items += 'Android ECM(19D2:1353)' }
      elseif ($id -match 'VID_19D2') { $items += ('ZTE(19D2:' + ($id -replace '.*PID_([0-9A-Fa-f]{4}).*','$1') + ')') }
    }
    $coms = [System.IO.Ports.SerialPort]::GetPortNames() -join ','
    if ($coms) { $items += ('COM:' + $coms) }
  } catch {}
  if ($items.Count -eq 0) { return '(无)' }
  return (($items | Select-Object -Unique) -join ' | ')
}

function Run-SpdAttempt {
  param([string[]]$spdArgs, [string]$label)
  Write-Host ''
  Write-Host ("---- {0} ----" -f $label)
  $outF = Join-Path $env:TEMP 'u30_spd_out.txt'
  $errF = Join-Path $env:TEMP 'u30_spd_err.txt'
  Remove-Item $outF,$errF -Force -ErrorAction SilentlyContinue
  $p = Start-Process -FilePath $SPD -ArgumentList $spdArgs -WorkingDirectory $PT -NoNewWindow -PassThru -RedirectStandardOutput $outF -RedirectStandardError $errF
  $last = ''
  $lastDev = ''
  $start = Get-Date
  while (-not $p.HasExited) {
    $dev = Snapshot
    if ($dev -ne $lastDev) {
      $t = (Get-Date).ToString('HH:mm:ss')
      Write-Host ("  [{0}] 设备状态: {1}" -f $t, $dev)
      $lastDev = $dev
    }
    if (((Get-Date) - $start).TotalSeconds -gt 600) { break }
    Start-Sleep -Milliseconds 600
  }
  Start-Sleep -Milliseconds 400
  if (-not $p.HasExited) { try { $p.Kill() } catch {} }
  foreach ($f in @($outF,$errF)) { if (Test-Path $f) { Get-Content $f -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ } } }
  $files = @(Get-ChildItem $BK -File -ErrorAction SilentlyContinue)
  return $files.Count
}

Show-Title
Write-Host '说明：'
Write-Host '  1) 本脚本只读取分区做备份，不会写入或修改设备内容。'
Write-Host '  2) 设备需要先关机（LED 全灭）。'
Write-Host '  3) 脚本会先尝试“直接插线”方式，失败后自动立即用 BROM 方式重试；'
Write-Host '     多次失败会自动换 kick 模式并提示你重新插线。'
Write-Host ''
[void](Read-Host '按回车开始')
$round = 0
$ok = $false
$modes = @('2','2','0','1','2')
$totalRounds = 4
while ($round -lt $totalRounds -and -not $ok) {
  $round++
  $mode = $modes[[Math]::Min($round-1, $modes.Count-1)]
  Show-Title
  Write-Host ("第 {0}/{1} 轮（kick 模式 {2}）" -f $round, $totalRounds, $mode)
  Write-Host ''
  if ($round -eq 1) {
    Write-Host '步骤：'
    Write-Host '  1. 拔掉设备 USB 线'
    Write-Host '  2. 长按电源键约 10 秒，确认设备完全关机（LED 全灭）'
    Write-Host '  3. 回车开始监听，然后立刻把 USB-C 线插到电脑（直插，不经 hub）'
  } else {
    Write-Host '步骤：'
    Write-Host '  1. 拔掉设备 USB 线'
    Write-Host '  2. 长按电源键约 10 秒，确认设备完全关机（LED 全灭）'
    Write-Host '  3. 回车开始监听，然后立刻插线'
  }
  Write-Host ''
  [void](Read-Host '准备好后按回车开始监听')
  Remove-Item $BK -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $BK | Out-Null
  Write-Host ''
  Write-Host '*** 现在开始监听，请插线 ***'

  $n1 = Run-SpdAttempt -spdArgs @('--wait','60','--verbose','1','--kickto',$mode,'exec_addr','0x65012f48','fdl',$FDL1,'0x65000800','fdl',$FDL2,'0xb4fffe00','exec','path',$BK,'r','all','reset') -label ("kickto {0} + FDL 直载" -f $mode)
  if ($n1 -gt 10) { $ok = $true; break }

  Write-Host ''
  Write-Host 'kick 未成功，立即尝试 BROM 直连回退（请保持设备连接、不要拔线）...'
  $n2 = Run-SpdAttempt -spdArgs @('--wait','25','--verbose','1','exec_addr','0x65012f48','fdl',$FDL1,'0x65000800','fdl',$FDL2,'0xb4fffe00','exec','path',$BK,'r','all','reset') -label 'BROM 直连回退'
  if ($n2 -gt 10) { $ok = $true; break }

  Write-Host ''
  Write-Host '本轮未成功。'
  if ($round -lt $totalRounds) {
    Write-Host '请再试一次（按回车继续下一轮）。'
    [void](Read-Host)
  }
}

Show-Title
$files = @(Get-ChildItem $BK -File -ErrorAction SilentlyContinue)
$sum = ($files | Measure-Object -Property Length -Sum).Sum
if ($ok -and $files.Count -gt 10) {
  Write-Host ("[OK] 备份完成：{0} 个文件，共 {1} GB" -f $files.Count, [math]::Round($sum/1GB,2))
  Write-Host ("     目录：{0}" -f $BK)
  Write-Host '     请回到对话框告诉 AI：备份已完成'
} else {
  Write-Host '[X] 本次没有抓到设备。'
  Write-Host ''
  Write-Host '排查建议：'
  Write-Host '  - 换一个 USB 口（优先主板后置口，不要用前面板/hub）'
  Write-Host '  - 如果有 USB-C 对 USB-C 的线，尽量用它'
  Write-Host '  - 确认设备真的关机了（LED 全灭），再插线'
  Write-Host '  - 再运行一次本脚本，多试几轮'
}
Write-Host ''
[void](Read-Host '按回车退出')
