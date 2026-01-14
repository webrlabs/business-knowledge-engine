# Intelligent Business Process Knowledge Platform - Windows Setup Script
# Enterprise Azure Edition - Initialization Script for PowerShell

Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host " Intelligent Business Process Knowledge Platform" -ForegroundColor Cyan
Write-Host " Enterprise Azure Edition - Development Environment Setup" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""

# Function to check if a command exists
function Test-CommandExists {
    param($command)
    $null = Get-Command $command -ErrorAction SilentlyContinue
    return $?
}

# Check prerequisites
Write-Host "[PREREQUISITES CHECK]" -ForegroundColor Yellow
Write-Host ""

# Check Node.js
if (Test-CommandExists "node") {
    $nodeVersion = node --version
    Write-Host "[OK] Node.js is installed: $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Node.js is not installed. Please install Node.js 18+ from https://nodejs.org/" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

# Check .NET SDK
if (Test-CommandExists "dotnet") {
    $dotnetVersion = dotnet --version
    Write-Host "[OK] .NET SDK is installed: $dotnetVersion" -ForegroundColor Green
} else {
    Write-Host "[WARNING] .NET SDK is not installed. Required for Azure Functions development." -ForegroundColor Yellow
    Write-Host "Download from: https://dotnet.microsoft.com/download" -ForegroundColor Yellow
}

# Check Azure CLI
if (Test-CommandExists "az") {
    $azVersion = az version --query '\"azure-cli\"' -o tsv
    Write-Host "[OK] Azure CLI is installed: $azVersion" -ForegroundColor Green
} else {
    Write-Host "[WARNING] Azure CLI is not installed. Required for Azure service deployment." -ForegroundColor Yellow
    Write-Host "Download from: https://aka.ms/installazurecliwindows" -ForegroundColor Yellow
}

# Check Python (optional, for backend)
if (Test-CommandExists "python") {
    $pythonVersion = python --version
    Write-Host "[OK] Python is installed: $pythonVersion" -ForegroundColor Green
}

Write-Host ""
Write-Host "-------------------------------------------------------------------" -ForegroundColor Cyan
Write-Host ""

# Install dependencies
Write-Host "[1/6] Installing frontend dependencies..." -ForegroundColor Yellow
if (Test-Path "frontend\package.json") {
    Set-Location frontend
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Frontend dependency installation failed." -ForegroundColor Red
        Set-Location ..
        Read-Host "Press Enter to exit"
        exit 1
    }
    Set-Location ..
    Write-Host "[OK] Frontend dependencies installed successfully." -ForegroundColor Green
} else {
    Write-Host "[INFO] No frontend directory found. Will be created during project setup." -ForegroundColor Cyan
}
Write-Host ""

Write-Host "[2/6] Installing backend dependencies..." -ForegroundColor Yellow
if (Test-Path "backend\requirements.txt") {
    Write-Host "Installing Python dependencies..." -ForegroundColor Cyan
    python -m pip install -r backend\requirements.txt
    Write-Host "[OK] Backend Python dependencies installed." -ForegroundColor Green
} elseif (Test-Path "backend\package.json") {
    Set-Location backend
    npm install
    Set-Location ..
    Write-Host "[OK] Backend Node.js dependencies installed." -ForegroundColor Green
} else {
    Write-Host "[INFO] No backend directory found. Will be created during project setup." -ForegroundColor Cyan
}
Write-Host ""

Write-Host "[3/6] Setting up Azure Functions..." -ForegroundColor Yellow
if (Test-Path "functions\host.json") {
    Set-Location functions
    npm install
    Set-Location ..
    Write-Host "[OK] Azure Functions dependencies installed." -ForegroundColor Green
} else {
    Write-Host "[INFO] No Azure Functions directory found. Will be created during project setup." -ForegroundColor Cyan
}
Write-Host ""

Write-Host "[4/6] Checking Azure configuration..." -ForegroundColor Yellow
if (Test-Path ".env.local") {
    Write-Host "[OK] Local environment configuration found." -ForegroundColor Green
} else {
    Write-Host "[WARNING] No .env.local file found." -ForegroundColor Yellow
    Write-Host "You'll need to configure Azure service connections." -ForegroundColor Yellow
    Write-Host "Copy .env.example to .env.local and update with your Azure credentials." -ForegroundColor Yellow
}
Write-Host ""

Write-Host "[5/6] Verifying project structure..." -ForegroundColor Yellow
$requiredDirs = @(".arcadia")
foreach ($dir in $requiredDirs) {
    if (!(Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "[CREATED] Directory: $dir" -ForegroundColor Green
    }
}
Write-Host ""

Write-Host "[6/6] Setup complete!" -ForegroundColor Green
Write-Host ""

# Display next steps
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host " NEXT STEPS:" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host " 1. Configure Azure services (see README.md for details):" -ForegroundColor White
Write-Host "    - Azure AI Foundry (OpenAI)" -ForegroundColor Gray
Write-Host "    - Cosmos DB (Gremlin API)" -ForegroundColor Gray
Write-Host "    - Azure AI Search" -ForegroundColor Gray
Write-Host "    - Azure Blob Storage (ADLS Gen2)" -ForegroundColor Gray
Write-Host "    - Azure Key Vault" -ForegroundColor Gray
Write-Host ""
Write-Host " 2. Update .env.local with your Azure service endpoints" -ForegroundColor White
Write-Host ""
Write-Host " 3. Start development servers:" -ForegroundColor White
Write-Host "    - Frontend:  npm run dev --prefix frontend" -ForegroundColor Gray
Write-Host "    - Backend:   npm run start --prefix backend" -ForegroundColor Gray
Write-Host "    - Functions: func start --prefix functions" -ForegroundColor Gray
Write-Host ""
Write-Host " 4. Access the application at http://localhost:3000" -ForegroundColor White
Write-Host ""
Write-Host " For detailed setup instructions, see README.md" -ForegroundColor Yellow
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Press any key to continue..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
