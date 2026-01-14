param(
  [Parameter(Mandatory = $false)]
  [string]$ResourceGroup = "bke-dev-rg",
  [Parameter(Mandatory = $false)]
  [string]$FrontendApp = "bke-dev-frontend",
  [Parameter(Mandatory = $false)]
  [string]$BackendApp = "bke-dev-backend",
  [Parameter(Mandatory = $false)]
  [string]$FunctionApp = "bke-dev-functions",
  [Parameter(Mandatory = $false)]
  [string]$SubscriptionId = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $root
$deployDir = Join-Path $repo ".deploy"
$frontendStage = Join-Path $deployDir "frontend"
$backendStage = Join-Path $deployDir "backend"
$frontendZip = Join-Path $deployDir "frontend.zip"
$backendZip = Join-Path $deployDir "backend.zip"

Write-Host "Preparing deploy artifacts..." -ForegroundColor Cyan

if (Test-Path $deployDir) {
  Remove-Item $deployDir -Recurse -Force
}
New-Item -ItemType Directory -Path $deployDir | Out-Null

$excludeDirs = @("node_modules", ".next", ".git", ".deploy", "tests", "scripts")
$excludeFiles = @(".env", ".env.local", ".env.*.local")

New-Item -ItemType Directory -Path $frontendStage | Out-Null
New-Item -ItemType Directory -Path $backendStage | Out-Null

robocopy (Join-Path $repo "frontend") $frontendStage /E /XD $excludeDirs /XF $excludeFiles | Out-Null
robocopy (Join-Path $repo "backend") $backendStage /E /XD $excludeDirs /XF $excludeFiles | Out-Null

if (Test-Path $frontendZip) { Remove-Item $frontendZip -Force }
if (Test-Path $backendZip) { Remove-Item $backendZip -Force }

Compress-Archive -Path (Join-Path $frontendStage "*") -DestinationPath $frontendZip
Compress-Archive -Path (Join-Path $backendStage "*") -DestinationPath $backendZip

if ($SubscriptionId -ne "") {
  az account set --subscription $SubscriptionId | Out-Null
}

Write-Host "Configuring app settings..." -ForegroundColor Cyan
$backendUrl = "https://$BackendApp.azurewebsites.net"

az webapp config appsettings set --resource-group $ResourceGroup --name $FrontendApp --settings `
  NEXT_PUBLIC_API_URL=$backendUrl `
  NEXT_PUBLIC_AZURE_AD_REDIRECT_URI=https://$FrontendApp.azurewebsites.net/auth/callback `
  SCM_DO_BUILD_DURING_DEPLOYMENT=true | Out-Null

az webapp config appsettings set --resource-group $ResourceGroup --name $BackendApp --settings `
  SCM_DO_BUILD_DURING_DEPLOYMENT=true | Out-Null

Write-Host "Deploying frontend..." -ForegroundColor Cyan
az webapp deploy --resource-group $ResourceGroup --name $FrontendApp --src-path $frontendZip --type zip | Out-Null

Write-Host "Deploying backend..." -ForegroundColor Cyan
az webapp deploy --resource-group $ResourceGroup --name $BackendApp --src-path $backendZip --type zip | Out-Null

Write-Host "Deploying functions..." -ForegroundColor Cyan
Push-Location (Join-Path $repo "functions")
func azure functionapp publish $FunctionApp
Pop-Location

Write-Host "Deploy complete." -ForegroundColor Green
Write-Host "Frontend: https://$FrontendApp.azurewebsites.net" -ForegroundColor Green
Write-Host "Backend:  https://$BackendApp.azurewebsites.net" -ForegroundColor Green
Write-Host "Functions: https://$FunctionApp.azurewebsites.net/api/health" -ForegroundColor Green
