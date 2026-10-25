<#
.SYNOPSIS
    Windows entry point for the review preflight.

.DESCRIPTION
    The preflight is implemented once, in Node, so that it behaves identically on Windows,
    macOS and Linux. This shim exists only so the documented PowerShell invocation keeps
    working. All arguments are forwarded unchanged.

.EXAMPLE
    ./tools/preflight-review.ps1 docs/learning/features/001-upload.md

.EXAMPLE
    ./tools/preflight-review.ps1 -GuidePath docs/learning/features/001-upload.md -ReviewReport docs/learning/reviews/001-upload.review.md
#>
[CmdletBinding()]
param(
    # Positional guide path, or the -GuidePath named form.
    [Parameter(Position = 0)]
    [string]$GuidePath,

    [string]$RepoRoot,

    [string]$ReviewReport,

    [string]$OutFile,

    # Anything else is forwarded verbatim to the Node implementation.
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

$ErrorActionPreference = 'Stop'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    [Console]::Error.WriteLine('preflight: Node.js 18+ is required. Install it from https://nodejs.org and re-run.')
    exit 2
}

$target = Join-Path $PSScriptRoot 'preflight-review.mjs'
if (-not (Test-Path -LiteralPath $target)) {
    [Console]::Error.WriteLine("preflight: missing implementation at $target")
    exit 2
}

$forward = @()
if ($GuidePath) { $forward += $GuidePath }
if ($RepoRoot) { $forward += @('--repo-root', $RepoRoot) }
if ($ReviewReport) { $forward += @('--review-report', $ReviewReport) }
if ($OutFile) { $forward += @('--out', $OutFile) }
if ($Rest) { $forward += $Rest }

& $node.Source $target @forward
exit $LASTEXITCODE
