# Terraform Deployment (Azure Dev / East US)

This folder contains a Terraform scaffold for the Business Knowledge Engine dev deployment in East US.

## Quick start

```powershell
cd infrastructure/terraform
terraform init
terraform plan -var-file=terraform.tfvars.example
```

## Notes
- App Service and Functions are configured with system-assigned managed identity and VNet integration.
- Private endpoints and private DNS zones are provisioned for data and AI services.
- Azure AI Foundry Hub support is modeled as a stub module; the exact resource type may change.
- Entra ID app registrations are created via the `azuread` provider.

## Next steps
- Confirm Entra ID app registrations and API scopes/redirect URIs match your tenant.
- Provide API keys via `terraform.tfvars` for services that do not yet use managed identity in code.
