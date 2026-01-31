# agent/scripts/cleanup.ps1
# Safe cleanup for Windows: dry run, confirm, then clean

Write-Host "[CLEANUP] DRY RUN: Files/folders that would be removed:"
git clean -ndx

$confirmation = Read-Host "[CLEANUP] Proceed with actual cleanup? (Y/N)"
if ($confirmation -ne 'Y' -and $confirmation -ne 'y') {
    Write-Host "[CLEANUP] Aborted by user."
    exit 0
}

Write-Host "[CLEANUP] Removing untracked and ignored files..."
git clean -fdx
Write-Host "[CLEANUP] Cleanup complete."
