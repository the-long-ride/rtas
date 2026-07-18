param(
    [Parameter(Mandatory = $true)]
    [string]$Destination,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$source = Join-Path $PSScriptRoot "skills"

if (-not (Test-Path $source)) {
    throw "Skills directory not found: $source"
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null

Get-ChildItem -Path $source -Directory | ForEach-Object {
    $target = Join-Path $Destination $_.Name
    if ((Test-Path $target) -and -not $Force) {
        Write-Warning "Skipping existing skill: $($_.Name). Use -Force to replace it."
        return
    }
    if (Test-Path $target) {
        Remove-Item -Recurse -Force $target
    }
    Copy-Item -Recurse -Force $_.FullName $target
    Write-Host "Installed $($_.Name)"
}
