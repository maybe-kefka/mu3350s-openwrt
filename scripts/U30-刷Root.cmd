@echo off
chcp 65001 >nul
set HERE=%~dp0
REM edit the four paths to match your spd_dump / fdl1 / fdl2 / root-package folder
node "%HERE%u30-flash-root.mjs" --spd "C:\f50-work\part-tool\bin\spd_dump.exe" --fdl1 "C:\f50-work\part-tool\bin\fdl1-dl.bin" --fdl2 "C:\f50-work\part-tool\bin\fdl2-dl.bin" --pkg "C:\f50-work\part-tool\data" --work "%HERE%..\work\u30-flash-tmp"
pause
