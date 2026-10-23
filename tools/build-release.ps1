# Builds the Windows installer signed for updates: beside the installer comes
# its .sig, whose text goes into update.json (see remote/README.md). Run it
# from PowerShell, in the project folder:
#
#   powershell -ExecutionPolicy Bypass -File tools\build-release.ps1
#
# The secret update key is read from your user folder and its password is
# asked here. Both stay in this window only: nothing is written to disk or
# to the log, and they are cleared when the build ends.

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$log = Join-Path $root 'build.log'
$key = Join-Path $env:USERPROFILE '.tauri\syntelab-creative.key'

if (-not (Test-Path $key)) {
  Write-Host "The update key is not at $key." -ForegroundColor Red
  exit 1
}

$secure = Read-Host 'Password of the update key' -AsSecureString
$env:TAURI_SIGNING_PRIVATE_KEY = [IO.File]::ReadAllText($key)
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

Set-Content -Path $log -Value "Release build started $(Get-Date -Format s)" -Encoding UTF8
try {
  npm run build 2>&1 | ForEach-Object {
    $text = "$_"
    Write-Host $text
    Add-Content -Path $log -Value $text -Encoding UTF8
  }
  $code = $LASTEXITCODE
} finally {
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}

$folder = Join-Path $root 'target\release\bundle\nsis'
# The same installer, and its .sig, under a name without the version, for a download link that never changes.
if ($code -eq 0) {
  $built = Get-ChildItem $folder -Filter '*_x64-setup.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($built) {
    Copy-Item $built.FullName (Join-Path $folder 'syntelab-creative-setup.exe') -Force
    if (Test-Path "$($built.FullName).sig") { Copy-Item "$($built.FullName).sig" (Join-Path $folder 'syntelab-creative-setup.exe.sig') -Force }
  }
}
$files = Get-ChildItem $folder | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize | Out-String
Add-Content -Path $log -Value "===== build ended with code $code" -Encoding UTF8
Add-Content -Path $log -Value $files -Encoding UTF8
Write-Host $files
if ($code -eq 0) { Write-Host "Done. The installer and its .sig are in $folder" -ForegroundColor Green }
elseif (Select-String -Path $log -Pattern 'Wrong password for that key' -Quiet) {
  Write-Host ''
  Write-Host 'WRONG PASSWORD for the update key. Nothing was signed: run the script again.' -ForegroundColor Red
}
else { Write-Host "The build failed. Everything is in $log" -ForegroundColor Red }
