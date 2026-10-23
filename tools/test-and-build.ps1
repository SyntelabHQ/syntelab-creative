# Runs every test and builds the Windows installer, writing all it prints to
# build.log in the project folder. Run it from PowerShell, in the project folder:
#
#   powershell -ExecutionPolicy Bypass -File tools\test-and-build.ps1
#
# It reads only the public half of the update key (syntelab-creative.key.pub).
# The installer is built without update signatures (tauri.test-build.conf.json):
# a release is built as remote/README.md says, with the secret key given.

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$log = Join-Path $root 'build.log'
Set-Content -Path $log -Value "Started $(Get-Date -Format s)" -Encoding UTF8

function Step([string] $name, [scriptblock] $work) {
  $line = "===== $name"
  Write-Host $line -ForegroundColor Cyan
  Add-Content -Path $log -Value $line -Encoding UTF8
  & $work 2>&1 | ForEach-Object {
    $text = "$_"
    Write-Host $text
    Add-Content -Path $log -Value $text -Encoding UTF8
  }
  $end = "===== $name ended with code $LASTEXITCODE"
  Write-Host $end -ForegroundColor Cyan
  Add-Content -Path $log -Value $end -Encoding UTF8
}

# The public half of the update key goes into tauri.conf.json, once.
$conf = Join-Path $root 'shell\src-tauri\tauri.conf.json'
$pub = Join-Path $env:USERPROFILE '.tauri\syntelab-creative.key.pub'
$text = [IO.File]::ReadAllText($conf)
if ($text.Contains('PUBLIC_KEY_FROM_syntelab-creative.key.pub')) {
  if (Test-Path $pub) {
    $key = ([IO.File]::ReadAllText($pub)).Trim()
    [IO.File]::WriteAllText($conf, $text.Replace('PUBLIC_KEY_FROM_syntelab-creative.key.pub', $key))
    Add-Content -Path $log -Value 'Public update key written into tauri.conf.json.' -Encoding UTF8
  } else {
    Add-Content -Path $log -Value "No public update key at $pub." -Encoding UTF8
  }
}

Step 'npm install' { npm install }
Step 'cargo test' { cargo test --workspace }
Step 'vitest' { npm test }
Step 'typecheck' { npm run typecheck }
Step 'installer' { npm run build -- --config src-tauri/tauri.test-build.conf.json }
# The same installer under a name without the version, for a download link that never changes.
Step 'installer without version' {
  $nsis = Join-Path $root 'target\release\bundle\nsis'
  $built = Get-ChildItem $nsis -Filter '*_x64-setup.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($built) { Copy-Item $built.FullName (Join-Path $nsis 'syntelab-creative-setup.exe') -Force; "Copied $($built.Name) to syntelab-creative-setup.exe" }
  else { 'No installer was built.' }
}
Step 'installer files' { Get-ChildItem (Join-Path $root 'target\release\bundle\nsis') | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize | Out-String }
Step 'update.json online' { curl.exe -sS -i https://syntelab.com/creative/check/update.json }

Add-Content -Path $log -Value "Ended $(Get-Date -Format s)" -Encoding UTF8
Write-Host "Done. Everything is in $log" -ForegroundColor Green
