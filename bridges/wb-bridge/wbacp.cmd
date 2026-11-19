@echo off
setlocal
rem ACP (Agent Client Protocol) entry point for WorkBuddy.
rem Use it from any ACP client: the client spawns this and talks ndJson over stdio.
rem Node is looked up from PATH first, then the two usual Windows install dirs.
set "NODE_BIN="
for %%I in (node.exe) do if not defined NODE_BIN set "NODE_BIN=%%~$PATH:I"
if not defined NODE_BIN if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_BIN=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_BIN if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_BIN=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_BIN (
  echo [!] node.exe not found. Install Node.js or add it to PATH.
  exit /b 9009
)
"%NODE_BIN%" "%~dp0cli.mjs" --acp %*
