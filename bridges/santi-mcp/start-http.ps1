param([int]$Port = 7790)
$ErrorActionPreference = 'Stop'
$mcpEntry = Join-Path $PSScriptRoot 'server.mjs'
$mcpNode = (Get-Command node.exe -ErrorAction Stop).Source
$mcpLogs = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force -Path $mcpLogs | Out-Null
$env:SANTI_MCP_PORT = [string]$Port
if (-not $env:SANTI_MCP_HOST) { $env:SANTI_MCP_HOST = '127.0.0.1' }
$mcpListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($mcpListener) { throw "端口 $Port 已被占用。请检查现有服务，或使用 -Port 指定新端口。" }
$mcpProcess = Start-Process -FilePath $mcpNode -ArgumentList @("`"$mcpEntry`"", '--http') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $mcpLogs 'http.stdout.log') -RedirectStandardError (Join-Path $mcpLogs 'http.stderr.log')
Start-Sleep -Milliseconds 700
if ($mcpProcess.HasExited) { throw "MCP 未能启动，请查看 $mcpLogs\http.stderr.log" }
@{pid=$mcpProcess.Id;entry=$mcpEntry;startedAt=(Get-Date).ToUniversalTime().ToString('o');port=$Port} | ConvertTo-Json | Set-Content (Join-Path $mcpLogs 'http-process.json')
Write-Output "MCP 已启动：端口 $Port，PID $($mcpProcess.Id)。凭证保存在 runtime/resources/app/.mcp/token，不会在终端输出。"
