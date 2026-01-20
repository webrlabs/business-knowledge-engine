resource "azurerm_service_plan" "this" {
  name                = "${var.name_prefix}-fe-plan"
  location            = var.location
  resource_group_name = var.resource_group_name
  os_type             = "Linux"
  sku_name            = var.sku_name
  tags                = var.tags
}

resource "azurerm_linux_web_app" "this" {
  name                = "${var.name_prefix}-frontend"
  location            = var.location
  resource_group_name = var.resource_group_name
  service_plan_id     = azurerm_service_plan.this.id

  site_config {
    always_on        = true
    app_command_line = "npx next start -p $PORT"
    application_stack {
      node_version = var.node_version
    }
  }

  identity {
    type = "SystemAssigned"
  }

  app_settings = {
    NEXT_PUBLIC_API_URL                   = var.api_base_url
    NEXT_PUBLIC_AZURE_AD_CLIENT_ID        = var.azure_ad_client_id
    NEXT_PUBLIC_AZURE_AD_TENANT_ID        = var.azure_ad_tenant_id
    NEXT_PUBLIC_AZURE_AD_REDIRECT_URI     = var.azure_ad_redirect_uri
    NEXT_PUBLIC_API_SCOPE                 = var.api_scope
    APPLICATIONINSIGHTS_CONNECTION_STRING = var.app_insights_connection
  }

  tags = var.tags
}

resource "azurerm_app_service_virtual_network_swift_connection" "this" {
  count          = var.enable_vnet_integration ? 1 : 0
  app_service_id = azurerm_linux_web_app.this.id
  subnet_id      = var.subnet_id
}
