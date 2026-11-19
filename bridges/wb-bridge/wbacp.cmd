@echo off
setlocal
rem ACP (Agent Client Protocol) entry point for WorkBuddy.
rem Use it from any ACP client: the client spawns this and talks ndJson over stdio.
"C:\Users\<user>\AppData\Local\Programs\nodejs\node.exe" "%~dp0cli.mjs" --acp %*
