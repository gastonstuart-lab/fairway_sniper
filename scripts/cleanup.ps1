# scripts/cleanup.ps1
# Cleans all untracked and ignored files (like git clean -fdX), plus optional cache cleanup.
# NEVER deletes tracked source code. Prints before/after size summary.

Write-Host "[CLEANUP] Calculating repo size before cleanup..."
$before = (Get-ChildItem -Recurse -Force | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ("[CLEANUP] Size before: {0:N2} MB" -f $before)

Write-Host "[CLEANUP] Removing untracked and ignored files (git clean -fdX)..."
git clean -fdX

# Optional: Remove common local caches (uncomment if needed)
# Remove-Item -Recurse -Force .\.dart_tool, .\build, .\output, .\test-results, .\logs, .\agent\output, .\agent\logs -ErrorAction SilentlyContinue

Write-Host "[CLEANUP] Calculating repo size after cleanup..."
$after = (Get-ChildItem -Recurse -Force | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ("[CLEANUP] Size after: {0:N2} MB" -f $after)

Write-Host "[CLEANUP] Cleanup complete."
