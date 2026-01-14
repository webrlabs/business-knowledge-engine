# =============================================================================
# Generate Local Development .env Files from Terraform Outputs
# =============================================================================
# This script generates .env files for frontend and backend from Terraform
# outputs, ensuring configuration stays in sync across all environments.
#
# Usage:
#   .\scripts\generate-env.ps1
#   .\scripts\generate-env.ps1 -TerraformDir "infrastructure/terraform"
# =============================================================================

param(
    [string]$TerraformDir = "infrastructure/terraform",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host " Generate Local Development .env Files from Terraform" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host ""

# Check if Terraform directory exists
$TerraformPath = Join-Path $ProjectRoot $TerraformDir
if (-not (Test-Path $TerraformPath)) {
    Write-Host "[ERROR] Terraform directory not found: $TerraformPath" -ForegroundColor Red
    exit 1
}

# Check if Terraform state exists
$TerraformStatePath = Join-Path $TerraformPath "terraform.tfstate"
if (-not (Test-Path $TerraformStatePath)) {
    Write-Host "[WARNING] No Terraform state found. Have you deployed infrastructure?" -ForegroundColor Yellow
    Write-Host "Run 'terraform apply' in $TerraformPath first." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "For local development without Azure infrastructure, copy and edit:" -ForegroundColor Cyan
    Write-Host "  - backend/.env.example -> backend/.env" -ForegroundColor Gray
    Write-Host "  - frontend/.env.example -> frontend/.env.local" -ForegroundColor Gray
    exit 1
}

# Get Terraform outputs
Write-Host "[1/3] Reading Terraform outputs..." -ForegroundColor Yellow
Push-Location $TerraformPath
try {
    $outputs = terraform output -json | ConvertFrom-Json
} catch {
    Write-Host "[ERROR] Failed to read Terraform outputs: $_" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

Write-Host "[OK] Terraform outputs loaded successfully." -ForegroundColor Green
Write-Host ""

# =============================================================================
# Generate Backend .env
# =============================================================================
Write-Host "[2/3] Generating backend/.env..." -ForegroundColor Yellow

$backendEnvPath = Join-Path $ProjectRoot "backend/.env"
if ((Test-Path $backendEnvPath) -and -not $Force) {
    Write-Host "[WARNING] backend/.env already exists. Use -Force to overwrite." -ForegroundColor Yellow
} else {
    $backendEnv = @"
# =============================================================================
# Business Knowledge Engine - Backend Environment Configuration
# =============================================================================
# Generated from Terraform outputs on $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
# Re-run scripts/generate-env.ps1 to sync with Terraform changes.
# =============================================================================

# -----------------------------------------------------------------------------
# Application Settings
# -----------------------------------------------------------------------------
NODE_ENV=development
PORT=$($outputs.backend_port.value)
LOG_LEVEL=$($outputs.backend_log_level.value)

# -----------------------------------------------------------------------------
# Azure AD / Entra ID Authentication
# -----------------------------------------------------------------------------
AZURE_AD_TENANT_ID=$($outputs.azure_ad_tenant_id.value)
AZURE_AD_CLIENT_ID=$($outputs.backend_client_id.value)
AZURE_AD_AUDIENCE=$($outputs.backend_app_uri.value)

# -----------------------------------------------------------------------------
# Azure AI Foundry / OpenAI Service
# -----------------------------------------------------------------------------
AZURE_OPENAI_ENDPOINT=$($outputs.openai_endpoint.value)
AZURE_OPENAI_DEPLOYMENT_NAME=$($outputs.openai_deployment_name.value)
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=$($outputs.openai_embedding_deployment.value)
AZURE_OPENAI_API_VERSION=$($outputs.openai_api_version.value)

# -----------------------------------------------------------------------------
# Azure Document Intelligence (Form Recognizer)
# -----------------------------------------------------------------------------
AZURE_FORM_RECOGNIZER_ENDPOINT=$($outputs.form_recognizer_endpoint.value)

# -----------------------------------------------------------------------------
# Azure AI Search
# -----------------------------------------------------------------------------
AZURE_SEARCH_ENDPOINT=$($outputs.search_endpoint.value)
AZURE_SEARCH_INDEX_NAME=$($outputs.search_index_name.value)

# -----------------------------------------------------------------------------
# Azure Cosmos DB - SQL API
# -----------------------------------------------------------------------------
COSMOS_DB_ENDPOINT=$($outputs.cosmos_endpoint.value)
COSMOS_DB_DATABASE=$($outputs.cosmos_database_name.value)
COSMOS_DB_DOCUMENTS_CONTAINER=$($outputs.cosmos_documents_container_name.value)
COSMOS_DB_AUDIT_CONTAINER=$($outputs.cosmos_audit_container_name.value)

# -----------------------------------------------------------------------------
# Azure Cosmos DB - Gremlin API (Knowledge Graph)
# -----------------------------------------------------------------------------
COSMOS_GREMLIN_ENDPOINT=$($outputs.gremlin_endpoint.value)
COSMOS_GREMLIN_DATABASE=$($outputs.gremlin_database_name.value)
COSMOS_GREMLIN_GRAPH=$($outputs.gremlin_graph_name.value)

# -----------------------------------------------------------------------------
# Azure Blob Storage
# -----------------------------------------------------------------------------
AZURE_STORAGE_ACCOUNT_NAME=$($outputs.storage_account_name.value)
AZURE_STORAGE_CONTAINER_DOCUMENTS=$($outputs.storage_documents_container_name.value)

# -----------------------------------------------------------------------------
# Azure Key Vault
# -----------------------------------------------------------------------------
KEYVAULT_URI=$($outputs.key_vault_uri.value)

# -----------------------------------------------------------------------------
# Feature Flags
# -----------------------------------------------------------------------------
ENABLE_PII_REDACTION=$($outputs.enable_pii_redaction.value.ToString().ToLower())

# -----------------------------------------------------------------------------
# Rate Limiting
# -----------------------------------------------------------------------------
RATE_LIMIT_WINDOW_MS=$($outputs.rate_limit_window_ms.value)
RATE_LIMIT_MAX_REQUESTS=$($outputs.rate_limit_max_requests.value)
OPENAI_RPM_LIMIT=$($outputs.openai_rpm_limit.value)
OPENAI_TPM_LIMIT=$($outputs.openai_tpm_limit.value)
"@

    Set-Content -Path $backendEnvPath -Value $backendEnv -Encoding UTF8
    Write-Host "[OK] Generated backend/.env" -ForegroundColor Green
}

# =============================================================================
# Generate Frontend .env.local
# =============================================================================
Write-Host "[3/3] Generating frontend/.env.local..." -ForegroundColor Yellow

$frontendEnvPath = Join-Path $ProjectRoot "frontend/.env.local"
if ((Test-Path $frontendEnvPath) -and -not $Force) {
    Write-Host "[WARNING] frontend/.env.local already exists. Use -Force to overwrite." -ForegroundColor Yellow
} else {
    $frontendEnv = @"
# =============================================================================
# Business Knowledge Engine - Frontend Environment Configuration
# =============================================================================
# Generated from Terraform outputs on $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
# Re-run scripts/generate-env.ps1 to sync with Terraform changes.
# =============================================================================

# Backend API URL (use deployed backend or localhost for local dev)
NEXT_PUBLIC_API_URL=$($outputs.backend_url.value)

# Azure AD / Entra ID Authentication
NEXT_PUBLIC_AZURE_AD_CLIENT_ID=$($outputs.frontend_client_id.value)
NEXT_PUBLIC_AZURE_AD_TENANT_ID=$($outputs.azure_ad_tenant_id.value)
NEXT_PUBLIC_AZURE_AD_REDIRECT_URI=$($outputs.frontend_redirect_uri.value)
NEXT_PUBLIC_API_SCOPE=$($outputs.backend_app_uri.value)/access_as_user
"@

    Set-Content -Path $frontendEnvPath -Value $frontendEnv -Encoding UTF8
    Write-Host "[OK] Generated frontend/.env.local" -ForegroundColor Green
}

Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host " Configuration Generation Complete!" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host " Generated files:" -ForegroundColor White
Write-Host "   - backend/.env" -ForegroundColor Gray
Write-Host "   - frontend/.env.local" -ForegroundColor Gray
Write-Host ""
Write-Host " For local development with localhost backend:" -ForegroundColor Yellow
Write-Host "   Edit frontend/.env.local and set:" -ForegroundColor Yellow
Write-Host "   NEXT_PUBLIC_API_URL=http://localhost:$($outputs.backend_port.value)" -ForegroundColor Gray
Write-Host ""
Write-Host " To regenerate (overwrite existing):" -ForegroundColor Yellow
Write-Host "   .\scripts\generate-env.ps1 -Force" -ForegroundColor Gray
Write-Host ""
