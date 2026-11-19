$ErrorActionPreference = 'Stop'
$mcpRecord = Join-Path $PSScriptRoot 'logs/http-process.json'
if (-not (Test-Path -LiteralPath $mcpRecord)) { Write-Output '没有本脚本启动的 MCP 记录。'; exit }
$mcpInfo = Get-Content -LiteralPath $mcpRecord -Raw | ConvertFrom-Json
$mcpProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$mcpInfo.pid)"
if ($mcpProcess) {
  if ($mcpProcess.Name -ne 'node.exe' -or -not $mcpProcess.CommandLine.Contains($mcpInfo.entry) -or -not $mcpProcess.CommandLine.Contains('--http')) { throw 'PID 身份已变化，拒绝停止。' }
  Stop-Process -Id $mcpProcess.ProcessId
}
Remove-Item -LiteralPath $mcpRecord
Write-Output '已停止 HTTP MCP；控制台及后台任务未停止。'
