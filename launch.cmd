@echo off
rem Santi Console launcher (GBK + CRLF, do not re-save as UTF-8).
set ELECTRON_RUN_AS_NODE=
set NODE_OPTIONS=
cd /d "D:\santi-console\runtime"
start "" ".\三体控制台.exe"
timeout /t 8 /nobreak >nul
netstat -an | find "127.0.0.1:7788" | find "LISTENING" >nul
if errorlevel 1 (
  echo.
  echo [!] Service on port 7788 did not come up. Running in foreground for details...
  echo.
  ".\三体控制台.exe"
)
exit
