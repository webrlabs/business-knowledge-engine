resource "azurerm_service_plan" "this" {
  name                = "${var.name_prefix}-be-plan"
  location            = var.location
  resource_group_name = var.resource_group_name
  os_type             = "Linux"
  sku_name            = var.sku_name
  tags                = var.tags
}

resource "azurerm_linux_web_app" "this" {
  name                = "${var.name_prefix}-backend"
  location            = var.location
  resource_group_name = var.resource_group_name
  service_plan_id     = azurerm_service_plan.this.id

  site_config {
    always_on = true
    application_stack {
      node_version = var.node_version
    }
  }

  identity {
    type = "SystemAssigned"
  }

  app_settings = {
    # Application
    NODE_ENV                              = "production"
    PORT                                  = tostring(var.port)
    LOG_LEVEL                             = var.log_level
    KEYVAULT_URI                          = var.key_vault_uri
    APPLICATIONINSIGHTS_CONNECTION_STRING = var.app_insights_connection

    # Cosmos DB SQL API
    COSMOS_DB_ENDPOINT                    = var.cosmos_endpoint
    COSMOS_DB_DATABASE                    = var.cosmos_database_name
    COSMOS_DB_DOCUMENTS_CONTAINER         = var.cosmos_documents_container_name
    COSMOS_DB_AUDIT_CONTAINER             = var.cosmos_audit_container_name

    # Cosmos DB Gremlin API (Knowledge Graph)
    COSMOS_GREMLIN_ENDPOINT               = var.gremlin_endpoint
    COSMOS_GREMLIN_DATABASE               = var.gremlin_database_name
    COSMOS_GREMLIN_GRAPH                  = var.gremlin_graph_name

    # Azure Storage
    AZURE_STORAGE_ACCOUNT_NAME            = var.storage_account_name
    AZURE_STORAGE_CONTAINER_DOCUMENTS     = var.storage_documents_container_name

    # Azure AI Search
    AZURE_SEARCH_ENDPOINT                 = var.search_endpoint
    AZURE_SEARCH_INDEX_NAME               = var.search_index_name

    # Azure OpenAI
    AZURE_OPENAI_ENDPOINT                 = var.openai_endpoint
    AZURE_OPENAI_DEPLOYMENT_NAME          = var.openai_deployment_name
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT     = var.openai_embedding_deployment
    AZURE_OPENAI_API_VERSION              = var.openai_api_version

    # Azure Document Intelligence
    AZURE_FORM_RECOGNIZER_ENDPOINT        = var.form_recognizer_endpoint

    # Azure AD / Entra ID
    AZURE_AD_TENANT_ID                    = var.azure_ad_tenant_id
    AZURE_AD_CLIENT_ID                    = var.azure_ad_client_id
    AZURE_AD_AUDIENCE                     = var.azure_ad_audience

    # Feature flags
    ENABLE_PII_REDACTION                  = tostring(var.enable_pii_redaction)

    # Rate limiting
    RATE_LIMIT_WINDOW_MS                  = tostring(var.rate_limit_window_ms)
    RATE_LIMIT_MAX_REQUESTS               = tostring(var.rate_limit_max_requests)
    OPENAI_RPM_LIMIT                      = tostring(var.openai_rpm_limit)
    OPENAI_TPM_LIMIT                      = tostring(var.openai_tpm_limit)
  }

  tags = var.tags
}

resource "azurerm_app_service_virtual_network_swift_connection" "this" {
  count          = var.enable_vnet_integration ? 1 : 0
  app_service_id = azurerm_linux_web_app.this.id
  subnet_id      = var.subnet_id
}
