# =============================================================================
# Infrastructure Outputs
# =============================================================================

output "resource_group_name" {
  value = module.resource_group.name
}

# =============================================================================
# Application URLs
# =============================================================================

output "frontend_url" {
  value = "https://${module.appservice_frontend.default_hostname}"
}

output "backend_url" {
  value = "https://${module.appservice_backend.default_hostname}"
}

output "functionapp_name" {
  value = module.functionapp.name
}

# =============================================================================
# Azure AD / Entra ID
# =============================================================================

output "azure_ad_tenant_id" {
  value = data.azuread_client_config.current.tenant_id
}

output "frontend_client_id" {
  value = module.identity.frontend_app_id
}

output "backend_client_id" {
  value = module.identity.backend_app_id
}

output "backend_app_uri" {
  value = module.identity.backend_app_uri
}

# =============================================================================
# Key Vault
# =============================================================================

output "key_vault_uri" {
  value = module.keyvault.vault_uri
}

# =============================================================================
# Cosmos DB (SQL API)
# =============================================================================

output "cosmos_account_name" {
  value = module.data.cosmos_account_name
}

output "cosmos_endpoint" {
  value = module.data.cosmos_endpoint
}

output "cosmos_database_name" {
  value = module.data.cosmos_database_name
}

output "cosmos_documents_container_name" {
  value = module.data.cosmos_documents_container_name
}

output "cosmos_audit_container_name" {
  value = module.data.cosmos_audit_container_name
}

# =============================================================================
# Cosmos DB (Gremlin API - Knowledge Graph)
# =============================================================================

output "gremlin_account_name" {
  value = module.data.gremlin_account_name
}

output "gremlin_endpoint" {
  value = module.data.gremlin_endpoint
}

output "gremlin_database_name" {
  value = module.data.gremlin_database_name
}

output "gremlin_graph_name" {
  value = module.data.gremlin_graph_name
}

# =============================================================================
# Azure Storage
# =============================================================================

output "storage_account_name" {
  value = module.data.storage_account_name
}

output "storage_documents_container_name" {
  value = module.data.storage_documents_container_name
}

# =============================================================================
# Azure AI Search
# =============================================================================

output "ai_search_name" {
  value = module.data.search_name
}

output "search_endpoint" {
  value = module.data.search_endpoint
}

output "search_index_name" {
  value = var.search_index_name
}

# =============================================================================
# Azure AI Services
# =============================================================================

output "openai_account_name" {
  value = module.ai_foundry.openai_account_name
}

output "openai_endpoint" {
  value = module.ai_foundry.openai_endpoint
}

output "openai_deployment_name" {
  value = var.openai_model_name
}

output "openai_embedding_deployment" {
  value = var.openai_embedding_deployment
}

output "openai_api_version" {
  value = var.openai_api_version
}

output "form_recognizer_endpoint" {
  value = module.ai_foundry.docint_endpoint
}

# =============================================================================
# Application Settings (for local development sync)
# =============================================================================

output "backend_port" {
  value = var.backend_port
}

output "backend_log_level" {
  value = var.backend_log_level
}

output "enable_pii_redaction" {
  value = var.enable_pii_redaction
}

output "rate_limit_window_ms" {
  value = var.rate_limit_window_ms
}

output "rate_limit_max_requests" {
  value = var.rate_limit_max_requests
}

output "openai_rpm_limit" {
  value = var.openai_rpm_limit
}

output "openai_tpm_limit" {
  value = var.openai_tpm_limit
}

output "frontend_redirect_uri" {
  value = var.frontend_redirect_uri
}
