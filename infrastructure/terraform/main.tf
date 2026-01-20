data "azurerm_client_config" "current" {}
data "azuread_client_config" "current" {}

module "resource_group" {
  source   = "./modules/resource-group"
  name     = "${local.name_prefix}-rg"
  location = var.location
  tags     = local.tags
}

module "network" {
  source              = "./modules/network"
  name                = "${local.name_prefix}-vnet"
  location            = var.location
  resource_group_name = module.resource_group.name
  address_space       = var.address_space
  subnets             = var.subnets
  tags                = local.tags
}

module "monitoring" {
  source              = "./modules/monitoring"
  name_prefix         = local.name_prefix
  location            = var.location
  resource_group_name = module.resource_group.name
  tags                = local.tags
}

resource "random_string" "keyvault_suffix" {
  length  = 6
  upper   = false
  special = false
}

module "keyvault" {
  source              = "./modules/keyvault"
  name                = "${local.name_prefix}-kv-${random_string.keyvault_suffix.result}"
  location            = var.location
  resource_group_name = module.resource_group.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  object_id           = data.azurerm_client_config.current.object_id
  public_network_access_enabled = var.keyvault_public_network_access_enabled
  tags                = local.tags
}

module "identity" {
  source              = "./modules/identity"
  name_prefix         = local.name_prefix
  tenant_id           = data.azuread_client_config.current.tenant_id
  owner_object_id     = data.azuread_client_config.current.object_id
  # Include both localhost (for dev) and Azure URL (for production)
  frontend_redirect_uris = [
    var.frontend_localhost_redirect_uri,
    "https://${local.name_prefix}-frontend.azurewebsites.net/auth/callback"
  ]
}

module "data" {
  source              = "./modules/data"
  name_prefix         = local.name_prefix
  location            = var.location
  resource_group_name = module.resource_group.name
  cosmos_database_name          = var.cosmos_database_name
  cosmos_documents_container_name = var.cosmos_documents_container_name
  cosmos_audit_container_name     = var.cosmos_audit_container_name
  cosmos_gremlin_database_name    = var.cosmos_gremlin_database_name
  cosmos_gremlin_graph_name       = var.cosmos_gremlin_graph_name
  storage_documents_container_name = var.storage_documents_container_name
  storage_processed_container_name = var.storage_processed_container_name
  storage_public_network_access_enabled = var.storage_public_network_access_enabled
  cosmos_public_network_access_enabled  = var.cosmos_public_network_access_enabled
  search_public_network_access_enabled  = var.search_public_network_access_enabled
  tags                = local.tags
}

module "ai_foundry" {
  source                      = "./modules/ai-foundry"
  name_prefix                 = local.name_prefix
  location                    = var.location
  resource_group_name         = module.resource_group.name
  resource_group_id           = module.resource_group.id
  openai_model_name           = var.openai_model_name
  openai_embedding_deployment = var.openai_embedding_deployment
  create_foundry_hub          = var.create_foundry_hub
  aiservices_public_network_access_enabled = var.aiservices_public_network_access_enabled
  docint_public_network_access_enabled     = var.docint_public_network_access_enabled
  tags                        = local.tags
}

module "appservice_frontend" {
  source                   = "./modules/appservice-frontend"
  name_prefix              = local.name_prefix
  location                 = var.location
  resource_group_name      = module.resource_group.name
  app_insights_connection  = module.monitoring.app_insights_connection_string
  api_base_url             = "https://${module.appservice_backend.default_hostname}"
  subnet_id                = module.network.subnet_ids["app"]
  azure_ad_client_id       = module.identity.frontend_app_id
  azure_ad_tenant_id       = data.azuread_client_config.current.tenant_id
  azure_ad_redirect_uri    = "https://${local.name_prefix}-frontend.azurewebsites.net/auth/callback"
  api_scope                = var.frontend_api_scope == "" ? "${module.identity.backend_app_uri}/access_as_user" : var.frontend_api_scope
  sku_name                 = var.appservice_sku_name
  enable_vnet_integration  = var.appservice_vnet_integration_enabled
  node_version             = var.appservice_node_version
  tags                     = local.tags
}

module "appservice_backend" {
  source                   = "./modules/appservice-backend"
  name_prefix              = local.name_prefix
  location                 = var.location
  resource_group_name      = module.resource_group.name
  app_insights_connection  = module.monitoring.app_insights_connection_string
  key_vault_uri            = module.keyvault.vault_uri
  subnet_id                = module.network.subnet_ids["app"]

  # Cosmos DB SQL API
  cosmos_endpoint          = module.data.cosmos_endpoint
  cosmos_database_name     = module.data.cosmos_database_name
  cosmos_documents_container_name = module.data.cosmos_documents_container_name
  cosmos_audit_container_name     = module.data.cosmos_audit_container_name

  # Cosmos DB Gremlin API (Knowledge Graph)
  gremlin_endpoint         = module.data.gremlin_endpoint
  gremlin_database_name    = module.data.gremlin_database_name
  gremlin_graph_name       = module.data.gremlin_graph_name

  # Azure Storage
  storage_account_name     = module.data.storage_account_name
  storage_documents_container_name = module.data.storage_documents_container_name

  # Azure AI Search
  search_endpoint          = module.data.search_endpoint
  search_index_name        = var.search_index_name

  # Azure OpenAI
  openai_endpoint          = module.ai_foundry.openai_endpoint
  openai_deployment_name   = var.openai_model_name
  openai_embedding_deployment = var.openai_embedding_deployment
  openai_api_version       = var.openai_api_version

  # Azure Document Intelligence
  form_recognizer_endpoint = module.ai_foundry.docint_endpoint

  # Azure AD / Entra ID
  azure_ad_tenant_id       = data.azuread_client_config.current.tenant_id
  azure_ad_client_id       = module.identity.backend_app_id
  azure_ad_audience        = var.azure_ad_audience == "" ? module.identity.backend_app_uri : var.azure_ad_audience

  # Application settings
  port                     = var.backend_port
  log_level                = var.backend_log_level

  # Feature flags
  enable_pii_redaction     = var.enable_pii_redaction

  # Rate limiting
  rate_limit_window_ms     = var.rate_limit_window_ms
  rate_limit_max_requests  = var.rate_limit_max_requests
  openai_rpm_limit         = var.openai_rpm_limit
  openai_tpm_limit         = var.openai_tpm_limit

  sku_name                 = var.appservice_sku_name
  enable_vnet_integration  = var.appservice_vnet_integration_enabled
  node_version             = var.appservice_node_version
  tags                     = local.tags
}

module "functionapp" {
  source                   = "./modules/functionapp"
  name_prefix              = local.name_prefix
  location                 = var.location
  resource_group_name      = module.resource_group.name
  app_insights_connection  = module.monitoring.app_insights_connection_string
  key_vault_uri            = module.keyvault.vault_uri
  subnet_id                = module.network.subnet_ids["functions"]

  # Cosmos DB SQL API
  cosmos_endpoint          = module.data.cosmos_endpoint
  cosmos_database_name     = module.data.cosmos_database_name
  cosmos_documents_container_name = module.data.cosmos_documents_container_name
  cosmos_audit_container_name     = module.data.cosmos_audit_container_name

  # Cosmos DB Gremlin API (Knowledge Graph)
  gremlin_endpoint         = module.data.gremlin_endpoint
  gremlin_database_name    = module.data.gremlin_database_name
  gremlin_graph_name       = module.data.gremlin_graph_name

  # Azure Storage
  storage_account_name     = module.data.storage_account_name
  storage_documents_container_name = module.data.storage_documents_container_name

  # Azure AI Search
  search_endpoint          = module.data.search_endpoint
  search_index_name        = var.search_index_name

  # Azure OpenAI
  openai_endpoint          = module.ai_foundry.openai_endpoint
  openai_deployment_name   = var.openai_model_name
  openai_embedding_deployment = var.openai_embedding_deployment
  openai_api_version       = var.openai_api_version

  # Azure Document Intelligence
  form_recognizer_endpoint = module.ai_foundry.docint_endpoint

  # Azure AD / Entra ID
  azure_ad_tenant_id       = data.azuread_client_config.current.tenant_id
  azure_ad_client_id       = module.identity.backend_app_id
  azure_ad_audience        = var.azure_ad_audience == "" ? module.identity.backend_app_uri : var.azure_ad_audience

  # Feature flags
  enable_pii_redaction     = var.enable_pii_redaction

  # Rate limiting
  openai_rpm_limit         = var.openai_rpm_limit
  openai_tpm_limit         = var.openai_tpm_limit

  sku_name                 = var.function_sku_name
  os_type                  = var.function_os_type
  node_version_linux       = var.function_node_version_linux
  node_version_windows     = var.function_node_version_windows
  enable_vnet_integration  = var.function_vnet_integration_enabled
  tags                     = local.tags
}

module "private_endpoints" {
  count               = var.enable_private_endpoints ? 1 : 0
  source              = "./modules/private-endpoints"
  name_prefix         = local.name_prefix
  location            = var.location
  resource_group_name = module.resource_group.name
  subnet_id           = module.network.subnet_ids["private_endpoints"]
  vnet_id             = module.network.vnet_id
  storage_account_id  = module.data.storage_account_id
  cosmos_account_id   = module.data.cosmos_account_id
  gremlin_account_id  = module.data.gremlin_account_id
  search_service_id   = module.data.search_id
  key_vault_id        = module.keyvault.id
  openai_account_id   = module.ai_foundry.openai_account_id
  docint_account_id   = module.ai_foundry.docint_account_id
  tags                = local.tags
}

resource "azurerm_key_vault_access_policy" "backend_app" {
  key_vault_id = module.keyvault.id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = module.appservice_backend.principal_id

  key_permissions    = ["Get", "List"]
  secret_permissions = ["Get", "List"]
}

resource "azurerm_key_vault_access_policy" "function_app" {
  key_vault_id = module.keyvault.id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = module.functionapp.principal_id

  key_permissions    = ["Get", "List"]
  secret_permissions = ["Get", "List"]
}

resource "random_uuid" "backend_cosmos_role" {}

resource "random_uuid" "function_cosmos_role" {}

resource "azurerm_cosmosdb_sql_role_assignment" "backend_cosmos" {
  name                = random_uuid.backend_cosmos_role.result
  resource_group_name = module.resource_group.name
  account_name        = module.data.cosmos_account_name
  role_definition_id  = "${module.data.cosmos_account_id}/sqlRoleDefinitions/${var.cosmos_data_contributor_role_definition_id}"
  principal_id        = module.appservice_backend.principal_id
  scope               = module.data.cosmos_account_id
}

resource "azurerm_cosmosdb_sql_role_assignment" "function_cosmos" {
  name                = random_uuid.function_cosmos_role.result
  resource_group_name = module.resource_group.name
  account_name        = module.data.cosmos_account_name
  role_definition_id  = "${module.data.cosmos_account_id}/sqlRoleDefinitions/${var.cosmos_data_contributor_role_definition_id}"
  principal_id        = module.functionapp.principal_id
  scope               = module.data.cosmos_account_id
}

resource "azurerm_role_assignment" "backend_storage" {
  scope                = module.data.storage_account_id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = module.appservice_backend.principal_id
}

resource "azurerm_role_assignment" "function_storage" {
  scope                = module.data.storage_account_id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = module.functionapp.principal_id
}

resource "azurerm_role_assignment" "backend_search" {
  scope                = module.data.search_id
  role_definition_name = "Search Index Data Contributor"
  principal_id         = module.appservice_backend.principal_id
}

resource "azurerm_role_assignment" "function_search" {
  scope                = module.data.search_id
  role_definition_name = "Search Index Data Contributor"
  principal_id         = module.functionapp.principal_id
}

resource "azurerm_role_assignment" "backend_openai" {
  scope                = module.ai_foundry.openai_account_id
  role_definition_name = "Cognitive Services OpenAI User"
  principal_id         = module.appservice_backend.principal_id
}

resource "azurerm_role_assignment" "function_openai" {
  scope                = module.ai_foundry.openai_account_id
  role_definition_name = "Cognitive Services OpenAI User"
  principal_id         = module.functionapp.principal_id
}

resource "azurerm_role_assignment" "backend_docint" {
  scope                = module.ai_foundry.docint_account_id
  role_definition_name = "Cognitive Services User"
  principal_id         = module.appservice_backend.principal_id
}

resource "azurerm_role_assignment" "function_docint" {
  scope                = module.ai_foundry.docint_account_id
  role_definition_name = "Cognitive Services User"
  principal_id         = module.functionapp.principal_id
}

# Gremlin (Knowledge Graph) role assignments
resource "random_uuid" "backend_gremlin_role" {}

resource "random_uuid" "function_gremlin_role" {}

resource "azurerm_cosmosdb_sql_role_assignment" "backend_gremlin" {
  name                = random_uuid.backend_gremlin_role.result
  resource_group_name = module.resource_group.name
  account_name        = module.data.gremlin_account_name
  role_definition_id  = "${module.data.gremlin_account_id}/sqlRoleDefinitions/${var.cosmos_data_contributor_role_definition_id}"
  principal_id        = module.appservice_backend.principal_id
  scope               = module.data.gremlin_account_id
}

resource "azurerm_cosmosdb_sql_role_assignment" "function_gremlin" {
  name                = random_uuid.function_gremlin_role.result
  resource_group_name = module.resource_group.name
  account_name        = module.data.gremlin_account_name
  role_definition_id  = "${module.data.gremlin_account_id}/sqlRoleDefinitions/${var.cosmos_data_contributor_role_definition_id}"
  principal_id        = module.functionapp.principal_id
  scope               = module.data.gremlin_account_id
}

module "apim" {
  count               = var.enable_apim ? 1 : 0
  source              = "./modules/apim"
  name_prefix         = local.name_prefix
  location            = var.location
  resource_group_name = module.resource_group.name
  publisher_name      = var.apim_publisher_name
  publisher_email     = var.apim_publisher_email
  sku_name            = var.apim_sku
  backend_url         = "https://${module.appservice_backend.default_hostname}"
  frontend_url        = "https://${module.appservice_frontend.default_hostname}"
  azure_ad_tenant_id  = data.azuread_client_config.current.tenant_id
  azure_ad_client_id  = module.identity.frontend_app_id
  subnet_id           = null  # Set to module.network.subnet_ids["app"] for VNet integration
  tags                = local.tags
}
