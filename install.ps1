<#
.SYNOPSIS
    Thin wrapper so the installer works from a clone on Windows.

.EXAMPLE
    ./install.ps1 -Target C:\path\to\project

.EXAMPLE
    ./install.ps1 update -Target C:\path\to\project
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Command = 'init',

    [string]$Target,

    [string]$Harness,

    [switch]$DryRun,

    [switch]$Force,

    [switch]$Quiet,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

$ErrorActionPreference = 'Stop'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    [Console]::Error.WriteLine('error: Node.js 18+ is required for the installer.')
    [Console]::Error.WriteLine("       Install it from https://nodejs.org, or see docs/INSTALL.md")
    exit 2
}

$cli = Join-Path $PSScriptRoot 'install/cli.mjs'
$arguments = @($Command)
if ($Target)  { $arguments += @('--target', $Target) }
if ($Harness) { $arguments += @('--harness', $Harness) }
if ($DryRun)  { $arguments += '--dry-run' }
if ($Force)   { $arguments += '--force' }
if ($Quiet)   { $arguments += '--quiet' }
if ($Rest)    { $arguments += $Rest }

& $node.Source $cli @arguments
exit $LASTEXITCODE
