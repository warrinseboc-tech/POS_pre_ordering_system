$ErrorActionPreference = 'Stop'
$pythonPath = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if (!(Test-Path -LiteralPath $pythonPath)) {
    throw 'Create the virtual environment and install backend/requirements.txt first. See README.md.'
}
Set-Location -LiteralPath $PSScriptRoot
& $pythonPath 'backend/app.py'
