@echo off
setlocal
rem WorkBuddy CLI launcher.
rem First run: execute "wbcli" then type /login to authorize once in the browser.
"C:\Users\<user>\AppData\Local\Programs\nodejs\node.exe" "%~dp0cli.mjs" %*
