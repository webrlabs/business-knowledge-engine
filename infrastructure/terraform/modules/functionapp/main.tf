resource "random_string" "suffix" {
  length  = 6
  upper   = false
  special = false
}

resource "azurerm_storage_account" "this" {
  name                     = "${replace(var.name_prefix, "-", "")}func${random_string.suffix.result}"
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  tags                     = var.tags
}

resource "azurerm_service_plan" "this" {
  name                = "${var.name_prefix}-func-plan"
  location            = var.location
  resource_group_name = var.resource_group_name
  os_type             = var.os_type
  sku_name            = var.sku_name
  tags                = var.tags
}

locals {
  is_linux = lower(var.os_type) == "linux"
  app_settings = {
    WEBSITE_RUN_FROM_PACKAGE             = "1"
    APPLICATIONINSIGHTS_CONNECTION_STRING = var.app_insights_connection
    KEYVAULT_URI                          = var.key_vault_uri
    COSMOS_DB_ENDPOINT                    = var.cosmos_endpoint
    COSMOS_DB_DATABASE                    = var.cosmos_database_name
    COSMOS_DB_DOCUMENTS_CONTAINER         = var.cosmos_documents_container_name
    COSMOS_DB_AUDIT_CONTAINER             = var.cosmos_audit_container_name
    AZURE_STORAGE_ACCOUNT_NAME            = var.storage_account_name
    AZURE_STORAGE_CONTAINER_DOCUMENTS     = var.storage_documents_container_name
    AZURE_SEARCH_ENDPOINT                 = var.search_endpoint
    AZURE_SEARCH_INDEX_NAME               = var.search_index_name
    AZURE_OPENAI_ENDPOINT                 = var.openai_endpoint
    AZURE_OPENAI_DEPLOYMENT_NAME          = var.openai_deployment_name
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT     = var.openai_embedding_deployment
    AZURE_OPENAI_API_VERSION              = var.openai_api_version
    AZURE_FORM_RECOGNIZER_ENDPOINT        = var.form_recognizer_endpoint
    AZURE_AD_TENANT_ID                    = var.azure_ad_tenant_id
    AZURE_AD_CLIENT_ID                    = var.azure_ad_client_id
    AZURE_AD_AUDIENCE                     = var.azure_ad_audience
  }
}

resource "azurerm_linux_function_app" "this" {
  count               = local.is_linux ? 1 : 0
  name                = "${var.name_prefix}-functions"
  location            = var.location
  resource_group_name = var.resource_group_name
  service_plan_id     = azurerm_service_plan.this.id
  storage_account_name       = azurerm_storage_account.this.name
  storage_account_access_key = azurerm_storage_account.this.primary_access_key

  site_config {
    application_stack {
      node_version = "18"
    }
  }

  identity {
    type = "SystemAssigned"
  }

  app_settings = local.app_settings

  tags = var.tags
}

resource "azurerm_windows_function_app" "this" {
  count               = local.is_linux ? 0 : 1
  name                = "${var.name_prefix}-functions"
  location            = var.location
  resource_group_name = var.resource_group_name
  service_plan_id     = azurerm_service_plan.this.id
  storage_account_name       = azurerm_storage_account.this.name
  storage_account_access_key = azurerm_storage_account.this.primary_access_key

  site_config {
    application_stack {
      node_version = "~18"
    }
  }

  identity {
    type = "SystemAssigned"
  }

  app_settings = local.app_settings

  tags = var.tags
}

resource "azurerm_app_service_virtual_network_swift_connection" "this" {
  count          = var.enable_vnet_integration ? 1 : 0
  app_service_id = local.is_linux ? azurerm_linux_function_app.this[0].id : azurerm_windows_function_app.this[0].id
  subnet_id      = var.subnet_id
}
