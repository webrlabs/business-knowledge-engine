# Restart Backend Server to Load PowerPoint Processing Feature
# This script stops the backend and restarts it to activate Feature #7

Write-Host "Stopping backend server on port 8080..." -ForegroundColor Yellow

# Find and stop the process on port 8080
$process = Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
if ($process) {
    Write-Host "Found process $process on port 8080" -ForegroundColor Cyan
    Stop-Process -Id $process -Force
    Write-Host "Process stopped" -ForegroundColor Green
} else {
    Write-Host "No process found on port 8080" -ForegroundColor Yellow
}

Start-Sleep -Seconds 2

# Start the backend server
Write-Host "Starting backend server..." -ForegroundColor Yellow
Set-Location backend
Start-Process -NoNewWindow -FilePath "node" -ArgumentList "src/index.js"
Set-Location ..

Start-Sleep -Seconds 3

# Test the server
Write-Host "Testing server health..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "http://localhost:8080/health" -Method Get
    Write-Host "Backend server is healthy!" -ForegroundColor Green
    Write-Host "Response: $($response | ConvertTo-Json)" -ForegroundColor Cyan
} catch {
    Write-Host "Server health check failed: $_" -ForegroundColor Red
}

Write-Host "`nBackend restart complete!" -ForegroundColor Green
Write-Host "PowerPoint processing feature (Feature #7) is now active." -ForegroundColor Cyan
