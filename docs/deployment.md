# Deployment Guide

## Prerequisites

- Azure subscription with appropriate permissions
- Azure CLI installed and authenticated
- Terraform >= 1.5.0 installed
- Node.js >= 18.x installed
- Git

## Infrastructure Deployment

### 1. Configure Variables

Create a `terraform.tfvars` file in the `infrastructure/terraform` directory:

```hcl
project     = "bke"
environment = "dev"
location    = "East US"

# Azure AD Configuration
frontend_redirect_uri = "https://your-frontend-domain.azurewebsites.net/auth/callback"

# API Management
apim_publisher_name  = "Your Organization"
apim_publisher_email = "admin@your-org.com"

# Optional overrides
openai_model_name = "gpt-4"
apim_sku          = "Developer_1"  # Use Basic_1 or Standard_1 for production
```

### 2. Initialize Terraform

```bash
cd infrastructure/terraform
terraform init
```

### 3. Review the Plan

```bash
terraform plan -out=tfplan
```

### 4. Apply Infrastructure

```bash
terraform apply tfplan
```

### 5. Note Outputs

Save the outputs for application configuration:

```bash
terraform output -json > ../outputs.json
```

## Application Deployment

### Backend Deployment

#### Option A: Azure App Service Deployment

1. Build the application:
```bash
cd backend
npm ci --production
```

2. Create a ZIP package:
```bash
zip -r deploy.zip . -x "node_modules/*" -x ".git/*"
```

3. Deploy using Azure CLI:
```bash
az webapp deployment source config-zip \
  --resource-group bke-dev-rg \
  --name bke-dev-backend \
  --src deploy.zip
```

#### Option B: Docker Deployment

1. Build the Docker image:
```bash
docker build -t bke-backend:latest .
```

2. Push to Azure Container Registry:
```bash
az acr login --name bkedevacr
docker tag bke-backend:latest bkedevacr.azurecr.io/bke-backend:latest
docker push bkedevacr.azurecr.io/bke-backend:latest
```

### Frontend Deployment

1. Configure environment variables:
```bash
cd frontend
cp .env.example .env.local
# Edit .env.local with values from Terraform outputs
```

2. Build the application:
```bash
npm ci
npm run build
```

3. Deploy to Azure App Service:
```bash
zip -r deploy.zip .next package.json public
az webapp deployment source config-zip \
  --resource-group bke-dev-rg \
  --name bke-dev-frontend \
  --src deploy.zip
```

## Post-Deployment Configuration

### 1. Configure Azure AD App Registrations

After deployment, update the Azure AD app registrations:

1. Go to Azure Portal > Azure Active Directory > App registrations
2. Find the backend app registration
3. Update the Redirect URIs with the actual deployed URLs
4. Configure API permissions if not automatically set

### 2. Verify Key Vault Secrets

Ensure all required secrets are in Key Vault:

```bash
az keyvault secret list --vault-name bke-dev-kv
```

Required secrets:
- Any API keys for external services

### 3. Configure CORS

If not using APIM, configure CORS on the backend App Service:

```bash
az webapp cors add \
  --resource-group bke-dev-rg \
  --name bke-dev-backend \
  --allowed-origins https://bke-dev-frontend.azurewebsites.net
```

### 4. Verify Health Endpoints

```bash
# Backend health check
curl https://bke-dev-backend.azurewebsites.net/health

# Frontend (should return HTML)
curl https://bke-dev-frontend.azurewebsites.net
```

## Environment-Specific Configurations

### Development

- Use `Developer_1` SKU for APIM
- Enable detailed logging
- Use lower tier compute (S1 for App Service)

### Staging

- Mirror production configuration
- Use separate Azure AD tenant or app registrations
- Enable Application Insights sampling

### Production

- Use `Standard_1` or `Premium_1` for APIM
- Enable VNet integration for all services
- Configure auto-scaling
- Enable backup for Cosmos DB and Storage
- Enable diagnostic logging to Log Analytics

## Monitoring

### Application Insights

View application telemetry:
```bash
az monitor app-insights component show \
  --resource-group bke-dev-rg \
  --app bke-dev-appinsights
```

### Log Analytics Queries

Common queries for troubleshooting:

```kusto
// Failed requests
requests
| where success == false
| summarize count() by resultCode, name
| order by count_ desc

// Slow requests
requests
| where duration > 5000
| project timestamp, name, duration, resultCode
| order by duration desc

// Exceptions
exceptions
| project timestamp, type, method, outerMessage
| order by timestamp desc
```

## Rollback Procedure

### Application Rollback

1. Find previous deployment:
```bash
az webapp deployment list \
  --resource-group bke-dev-rg \
  --name bke-dev-backend
```

2. Rollback to previous slot (if using slots):
```bash
az webapp deployment slot swap \
  --resource-group bke-dev-rg \
  --name bke-dev-backend \
  --slot staging \
  --target-slot production
```

### Infrastructure Rollback

1. Use Terraform state to identify changes:
```bash
terraform show
```

2. Apply previous version:
```bash
git checkout <previous-commit>
terraform apply
```

## Troubleshooting

### Common Issues

1. **502 Bad Gateway**: Check App Service logs
   ```bash
   az webapp log tail --resource-group bke-dev-rg --name bke-dev-backend
   ```

2. **Authentication failures**: Verify Azure AD configuration
   - Check token audience matches backend configuration
   - Verify redirect URIs are correct

3. **Cosmos DB connection issues**: Check VNet integration
   - Ensure private endpoints are configured
   - Verify firewall rules

4. **Rate limiting**: Check APIM policies
   - Review rate limit configurations
   - Check if IP is being rate limited
