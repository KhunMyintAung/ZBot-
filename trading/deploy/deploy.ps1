# zBOT: copy the bot to your VPS and install it, from Windows.
#
#   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Server root@1.2.3.4
#   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Server root@1.2.3.4 -Domain bot.example.com
#
# Needs the OpenSSH client that comes with Windows 10/11 (ssh, scp) and tar.
# Run it again any time to update the bot; settings, positions and the journal on the VPS are kept.
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [string]$Domain = ''
)
$ErrorActionPreference = 'Stop'

foreach ($tool in 'ssh', 'scp', 'tar', 'robocopy') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool not found. Install 'OpenSSH Client' in Windows Settings > Optional features." }
}
if ($Domain -and $Domain -notmatch '^[A-Za-z0-9.-]+$') { throw "Domain looks wrong: $Domain" }

$trading = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $env:TEMP ('zbot-stage-' + [guid]::NewGuid().ToString('N'))
$tgz = Join-Path $env:TEMP 'zbot-upload.tgz'

Write-Host '==> Packing the bot (without state, data and backups)' -ForegroundColor Cyan
robocopy $trading $stage /E /NFL /NDL /NJH /NJS /NP /XD state data node_modules .claude /XF .env.prev .env.backup *.tgz | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
if (Test-Path $tgz) { Remove-Item $tgz -Force }
tar -czf $tgz -C $stage .
if ($LASTEXITCODE -ne 0) { throw 'tar failed' }
Remove-Item $stage -Recurse -Force
'{0:N0} KB' -f ((Get-Item $tgz).Length / 1KB) | Write-Host

Write-Host "==> Uploading to $Server" -ForegroundColor Cyan
scp $tgz "${Server}:/tmp/zbot-upload.tgz"
if ($LASTEXITCODE -ne 0) { throw 'Upload failed. Check the server address and password/SSH key.' }
Remove-Item $tgz -Force

Write-Host '==> Installing on the server (it will ask you to choose a dashboard password)' -ForegroundColor Cyan
$remote = "set -e; rm -rf /tmp/zbot-upload; mkdir -p /tmp/zbot-upload; tar -xzf /tmp/zbot-upload.tgz -C /tmp/zbot-upload; " +
  "sed -i 's/\r$//' /tmp/zbot-upload/deploy/setup.sh; " +
  "sudo bash /tmp/zbot-upload/deploy/setup.sh $Domain; rm -rf /tmp/zbot-upload /tmp/zbot-upload.tgz"
ssh -t $Server $remote
if ($LASTEXITCODE -ne 0) { throw 'Setup on the server failed (see the messages above).' }
Write-Host '==> Done.' -ForegroundColor Green
