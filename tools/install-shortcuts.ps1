# Creates the Countryside Ledger shortcuts (Desktop + Start Menu) for this PC.
# Safe to re-run; paths are derived from wherever this project folder lives.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$proj = Split-Path -Parent $here
$vbs  = Join-Path $here 'ledger-pc.vbs'
$ico  = Join-Path $proj 'icons\icon.ico'

$ws = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
    $lnk = Join-Path $dir 'Countryside Ledger.lnk'
    $s = $ws.CreateShortcut($lnk)
    $s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
    $s.Arguments = '"' + $vbs + '"'
    if (Test-Path $ico) { $s.IconLocation = "$ico,0" }
    $s.WorkingDirectory = $here
    $s.Description = "Countryside Market's price book"
    $s.Save()
    Write-Host "created: $lnk"
}
Write-Host ""
Write-Host "Done. Open the Ledger from the Start Menu or Desktop icon."
