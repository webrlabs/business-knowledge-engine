@echo off
REM Intelligent Business Process Knowledge Platform - Windows Setup Script
REM Enterprise Azure Edition - Initialization Script for Command Prompt

echo ====================================================================
echo  Intelligent Business Process Knowledge Platform
echo  Enterprise Azure Edition - Development Environment Setup
echo ====================================================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed. Please install Node.js 18+ from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM Check if .NET SDK is installed (for Azure Functions)
where dotnet >nul 2>nul
if %errorlevel% neq 0 (
    echo [WARNING] .NET SDK is not installed. Required for Azure Functions development.
    echo Download from: https://dotnet.microsoft.com/download
    echo.
)

REM Check if Azure CLI is installed
where az >nul 2>nul
if %errorlevel% neq 0 (
    echo [WARNING] Azure CLI is not installed. Required for Azure service deployment.
    echo Download from: https://aka.ms/installazurecliwindows
    echo.
)

echo [1/6] Checking environment...
echo Node.js version:
node --version
echo.

echo [2/6] Installing frontend dependencies...
if exist "frontend\package.json" (
    call npm install --prefix frontend
    if %errorlevel% neq 0 (
        echo [ERROR] Frontend dependency installation failed.
        pause
        exit /b 1
    )
) else (
    echo [INFO] No frontend directory found. Will be created during project setup.
)
echo.

echo [3/6] Installing backend dependencies...
if exist "backend\requirements.txt" (
    echo Installing Python dependencies...
    python -m pip install -r backend\requirements.txt
) else if exist "backend\package.json" (
    call npm install --prefix backend
) else (
    echo [INFO] No backend directory found. Will be created during project setup.
)
echo.

echo [4/6] Setting up Azure Functions...
if exist "functions\host.json" (
    call npm install --prefix functions
) else (
    echo [INFO] No Azure Functions directory found. Will be created during project setup.
)
echo.

echo [5/6] Checking Azure configuration...
if exist ".env.local" (
    echo [INFO] Local environment configuration found.
) else (
    echo [WARNING] No .env.local file found. You'll need to configure Azure service connections.
    echo Copy .env.example to .env.local and update with your Azure credentials.
)
echo.

echo [6/6] Setup complete!
echo.
echo ====================================================================
echo  NEXT STEPS:
echo ====================================================================
echo  1. Configure Azure services (see README.md for details):
echo     - Azure OpenAI Service
echo     - Cosmos DB (Gremlin API)
echo     - Azure AI Search
echo     - Azure Blob Storage
echo     - Azure Key Vault
echo.
echo  2. Update .env.local with your Azure service endpoints
echo.
echo  3. Start development servers:
echo     - Frontend: npm run dev --prefix frontend
echo     - Backend: npm run start --prefix backend
echo     - Functions: func start --prefix functions
echo.
echo  4. Access the application at http://localhost:3000
echo.
echo  For detailed setup instructions, see README.md
echo ====================================================================
echo.
pause
