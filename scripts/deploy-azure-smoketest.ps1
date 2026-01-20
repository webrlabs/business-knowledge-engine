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
  [string]$SubscriptionId = "",
  [Parameter(Mandatory = $false)]
  [switch]$Clean
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $root
$deployDir = Join-Path $repo ".deploy"
$frontendStage = Join-Path $deployDir "frontend"
$backendStage = Join-Path $deployDir "backend"
$frontendZip = Join-Path $deployDir "frontend.zip"
$backendZip = Join-Path $deployDir "backend.zip"

# Clean previous builds if requested
if ($Clean) {
  Write-Host "Cleaning previous builds..." -ForegroundColor Yellow
  $cleanPaths = @(
    (Join-Path $repo ".deploy"),
    (Join-Path $repo "frontend\node_modules"),
    (Join-Path $repo "frontend\.next"),
    (Join-Path $repo "backend\node_modules"),
    (Join-Path $repo "functions\node_modules")
  )
  foreach ($path in $cleanPaths) {
    if (Test-Path $path) {
      Write-Host "  Removing $path" -ForegroundColor Gray
      cmd /c "rd /s /q `"$path`"" 2>$null
    }
  }
  Write-Host "Clean complete." -ForegroundColor Yellow
}

Write-Host "Preparing deploy artifacts..." -ForegroundColor Cyan

# Set Azure subscription early (needed for fetching settings)
if ($SubscriptionId -ne "") {
  az account set --subscription $SubscriptionId | Out-Null
}

if (Test-Path $deployDir) {
  cmd /c "rd /s /q `"$deployDir`"" 2>$null
}
New-Item -ItemType Directory -Path $deployDir | Out-Null
New-Item -ItemType Directory -Path $frontendStage | Out-Null
New-Item -ItemType Directory -Path $backendStage | Out-Null

# ============================================
# FRONTEND: Build Next.js standalone locally
# ============================================
Write-Host "Building frontend (Next.js standalone)..." -ForegroundColor Cyan

# Fetch NEXT_PUBLIC_* settings from Azure (Next.js bakes these at build time)
Write-Host "  Fetching build-time env vars from Azure..." -ForegroundColor Gray
$frontendSettings = az webapp config appsettings list --resource-group $ResourceGroup --name $FrontendApp --output json 2>$null | ConvertFrom-Json

# Set each NEXT_PUBLIC_* variable for the build
$buildEnvVars = @{}
foreach ($setting in $frontendSettings) {
  if ($setting.name -like "NEXT_PUBLIC_*") {
    $buildEnvVars[$setting.name] = $setting.value
    Set-Item -Path "Env:\$($setting.name)" -Value $setting.value
    Write-Host "    $($setting.name) = $($setting.value)" -ForegroundColor Gray
  }
}

Push-Location (Join-Path $repo "frontend")
npm install
npm run build
Pop-Location

# Clean up env vars
foreach ($varName in $buildEnvVars.Keys) {
  Remove-Item "Env:\$varName" -ErrorAction SilentlyContinue
}

$frontendSource = Join-Path $repo "frontend"
$standaloneRoot = Join-Path $frontendSource ".next\standalone"

# Verify standalone build exists
if (-not (Test-Path $standaloneRoot)) {
  Write-Host "ERROR: Standalone build not found at $standaloneRoot" -ForegroundColor Red
  Write-Host "Make sure next.config.js has output: 'standalone'" -ForegroundColor Yellow
  exit 1
}

# Find server.js in the standalone build (Next.js preserves project path structure)
$standaloneServerJs = Get-ChildItem -Path $standaloneRoot -Recurse -Filter "server.js" | Select-Object -First 1
if (-not $standaloneServerJs) {
  Write-Host "ERROR: server.js not found in standalone build!" -ForegroundColor Red
  exit 1
}
$standaloneAppDir = $standaloneServerJs.DirectoryName
Write-Host "  Found standalone app at: $standaloneAppDir" -ForegroundColor Gray

# Copy standalone build to staging
robocopy $standaloneAppDir $frontendStage /E /NFL /NDL /NJH /NJS /NC /NS
if ($LASTEXITCODE -ge 8) { Write-Host "Error staging frontend" -ForegroundColor Red; exit 1 }

# Copy static files into .next/static (required for standalone)
$staticSource = Join-Path $frontendSource ".next\static"
$staticDest = Join-Path $frontendStage ".next\static"
if (Test-Path $staticSource) {
  robocopy $staticSource $staticDest /E /NFL /NDL /NJH /NJS /NC /NS
  if ($LASTEXITCODE -ge 8) { Write-Host "Error staging static files" -ForegroundColor Red; exit 1 }
}

# Copy public folder (required for standalone)
$publicSource = Join-Path $frontendSource "public"
$publicDest = Join-Path $frontendStage "public"
if (Test-Path $publicSource) {
  robocopy $publicSource $publicDest /E /NFL /NDL /NJH /NJS /NC /NS
  if ($LASTEXITCODE -ge 8) { Write-Host "Error staging public files" -ForegroundColor Red; exit 1 }
}

Write-Host "  Frontend staged successfully" -ForegroundColor Gray

# ============================================
# BACKEND: Build with dependencies included
# ============================================
Write-Host "Staging backend files..." -ForegroundColor Cyan
$backendSource = Join-Path $repo "backend"

# Copy source files (exclude node_modules, we'll install fresh)
robocopy $backendSource $backendStage /E /XD .git node_modules .deploy tests __tests__ /XF .env .env.local *.test.js *.spec.js /NFL /NDL /NJH /NJS /NC /NS
if ($LASTEXITCODE -ge 8) { Write-Host "Error staging backend" -ForegroundColor Red; exit 1 }

# Verify essential files
if (-not (Test-Path (Join-Path $backendStage "src\index.js"))) {
  Write-Host "ERROR: Backend src/index.js not found!" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path (Join-Path $backendStage "package.json"))) {
  Write-Host "ERROR: Backend package.json not found!" -ForegroundColor Red
  exit 1
}

# Install production dependencies in staging folder
Write-Host "  Installing backend dependencies..." -ForegroundColor Gray
Push-Location $backendStage
npm install --omit=dev
Pop-Location

Write-Host "  Backend staged successfully" -ForegroundColor Gray

# ============================================
# CREATE ZIP FILES (Linux-compatible with forward slashes)
# ============================================
Write-Host "Creating zip archives (Linux-compatible)..." -ForegroundColor Cyan
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Function to create zip with forward slashes (required for Linux/Azure)
function New-LinuxCompatibleZip {
  param([string]$SourceDir, [string]$ZipPath)

  if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }

  $zip = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)

  try {
    $files = Get-ChildItem -Path $SourceDir -Recurse -File
    foreach ($file in $files) {
      $relativePath = $file.FullName.Substring($SourceDir.Length + 1)
      # Convert backslashes to forward slashes for Linux compatibility
      $entryName = $relativePath.Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  }
  finally {
    $zip.Dispose()
  }
}

if (Test-Path $frontendZip) { Remove-Item $frontendZip -Force }
if (Test-Path $backendZip) { Remove-Item $backendZip -Force }

Write-Host "  Creating frontend zip..." -ForegroundColor Gray
New-LinuxCompatibleZip -SourceDir $frontendStage -ZipPath $frontendZip

Write-Host "  Creating backend zip..." -ForegroundColor Gray
New-LinuxCompatibleZip -SourceDir $backendStage -ZipPath $backendZip

$frontendSize = [math]::Round((Get-Item $frontendZip).Length / 1MB, 2)
$backendSize = [math]::Round((Get-Item $backendZip).Length / 1MB, 2)
Write-Host "  Frontend zip: $frontendSize MB" -ForegroundColor Gray
Write-Host "  Backend zip: $backendSize MB" -ForegroundColor Gray

# ============================================
# CONFIGURE AZURE
# ============================================
if ($SubscriptionId -ne "") {
  az account set --subscription $SubscriptionId | Out-Null
}

Write-Host "Configuring Azure App Service settings..." -ForegroundColor Cyan
$backendUrl = "https://$BackendApp.azurewebsites.net"

# Remove WEBSITE_RUN_FROM_PACKAGE if it exists (check first, don't blindly delete)
Write-Host "  Checking for WEBSITE_RUN_FROM_PACKAGE settings..." -ForegroundColor Gray
$frontendSettings = az webapp config appsettings list --resource-group $ResourceGroup --name $FrontendApp --output json 2>$null | ConvertFrom-Json
$backendSettings = az webapp config appsettings list --resource-group $ResourceGroup --name $BackendApp --output json 2>$null | ConvertFrom-Json

if ($frontendSettings | Where-Object { $_.name -eq "WEBSITE_RUN_FROM_PACKAGE" }) {
  Write-Host "    Removing WEBSITE_RUN_FROM_PACKAGE from frontend..." -ForegroundColor Gray
  az webapp config appsettings delete --resource-group $ResourceGroup --name $FrontendApp --setting-names WEBSITE_RUN_FROM_PACKAGE --output none 2>$null
}
if ($backendSettings | Where-Object { $_.name -eq "WEBSITE_RUN_FROM_PACKAGE" }) {
  Write-Host "    Removing WEBSITE_RUN_FROM_PACKAGE from backend..." -ForegroundColor Gray
  az webapp config appsettings delete --resource-group $ResourceGroup --name $BackendApp --setting-names WEBSITE_RUN_FROM_PACKAGE --output none 2>$null
}

# Frontend: Pre-built, no Azure build needed
Write-Host "  Setting frontend app settings..." -ForegroundColor Gray
az webapp config appsettings set --resource-group $ResourceGroup --name $FrontendApp --output none --settings `
  NEXT_PUBLIC_API_URL=$backendUrl `
  NEXT_PUBLIC_AZURE_AD_REDIRECT_URI="https://$FrontendApp.azurewebsites.net/auth/callback" `
  SCM_DO_BUILD_DURING_DEPLOYMENT=false

# Frontend startup command for Next.js standalone
az webapp config set --resource-group $ResourceGroup --name $FrontendApp --startup-file "node server.js" --output none

# Backend: Pre-built with dependencies included
Write-Host "  Setting backend app settings..." -ForegroundColor Gray
az webapp config appsettings set --resource-group $ResourceGroup --name $BackendApp --output none --settings `
  SCM_DO_BUILD_DURING_DEPLOYMENT=false

Write-Host "  Settings configured" -ForegroundColor Gray

# ============================================
# DEPLOY
# ============================================
# Temporarily allow errors for az commands (they write warnings to stderr)
$ErrorActionPreference = "Continue"

Write-Host "Deploying frontend..." -ForegroundColor Cyan
az webapp deploy --resource-group $ResourceGroup --name $FrontendApp --src-path $frontendZip --type zip --async true --output none
if ($LASTEXITCODE -eq 0) {
  Write-Host "  Frontend deployment initiated" -ForegroundColor Gray
} else {
  Write-Host "  Frontend deployment may have issues - check Azure portal" -ForegroundColor Yellow
}

Write-Host "Deploying backend (Azure will run npm install)..." -ForegroundColor Cyan
az webapp deploy --resource-group $ResourceGroup --name $BackendApp --src-path $backendZip --type zip --async true --output none
if ($LASTEXITCODE -eq 0) {
  Write-Host "  Backend deployment initiated" -ForegroundColor Gray
} else {
  Write-Host "  Backend deployment may have issues - check Azure portal" -ForegroundColor Yellow
}

# Restore error handling
$ErrorActionPreference = "Stop"

# Wait for deployments to complete
Write-Host "Waiting for deployments to complete..." -ForegroundColor Cyan
Start-Sleep -Seconds 60

# Restart apps to ensure clean state
Write-Host "Restarting apps..." -ForegroundColor Cyan
az webapp restart --resource-group $ResourceGroup --name $FrontendApp --output none 2>$null
az webapp restart --resource-group $ResourceGroup --name $BackendApp --output none 2>$null

# ============================================
# FUNCTIONS
# ============================================
Write-Host "Deploying functions..." -ForegroundColor Cyan
$funcCmd = Get-Command func -ErrorAction SilentlyContinue
if ($funcCmd) {
  Push-Location (Join-Path $repo "functions")
  func azure functionapp publish $FunctionApp
  Pop-Location
} else {
  $functionsStage = Join-Path $deployDir "functions"
  $functionsZip = Join-Path $deployDir "functions.zip"
  New-Item -ItemType Directory -Path $functionsStage | Out-Null
  $functionsSource = Join-Path $repo "functions"
  robocopy $functionsSource $functionsStage /E /XD .git node_modules /XF .env .env.local *.test.js *.spec.js /NFL /NDL /NJH /NJS /NC /NS
  if (Test-Path $functionsZip) { Remove-Item $functionsZip -Force }
  [System.IO.Compression.ZipFile]::CreateFromDirectory($functionsStage, $functionsZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
  az functionapp deployment source config-zip --resource-group $ResourceGroup --name $FunctionApp --src $functionsZip | Out-Null
}

# ============================================
# DONE
# ============================================
Write-Host ""
Write-Host "Deploy complete." -ForegroundColor Green
Write-Host "Frontend: https://$FrontendApp.azurewebsites.net" -ForegroundColor Green
Write-Host "Backend:  https://$BackendApp.azurewebsites.net" -ForegroundColor Green
Write-Host "Backend Health: https://$BackendApp.azurewebsites.net/health" -ForegroundColor Green
Write-Host "Functions: https://$FunctionApp.azurewebsites.net/api/health" -ForegroundColor Green
Write-Host ""
Write-Host "Note: Backend may take a few minutes to start (Azure is running npm install)." -ForegroundColor Yellow
Write-Host "Check deployment logs: az webapp log deployment show -g $ResourceGroup -n $BackendApp" -ForegroundColor Yellow
