param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Destination,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$cli = Join-Path $PSScriptRoot "dist\cli.js"
if (-not (Test-Path $cli)) {
    throw "dist/cli.js not found. Run 'npm install; npm run build' first, or install the npm package '@the-long-ride/rust-tauri-agent-skills' globally and use the 'rtas' command."
}

$arguments = @("install", "--dest", $Destination, "--all")
if ($Force) { $arguments += "--force" }
& node $cli @arguments
exit $LASTEXITCODE
