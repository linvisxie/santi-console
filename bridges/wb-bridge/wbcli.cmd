@echo off
setlocal
rem WorkBuddy CLI launcher.
rem With no args (or login): start the official browser authorization flow.
"C:\Users\<user>\AppData\Local\Programs\nodejs\node.exe" "%~dp0cli.mjs" %*
