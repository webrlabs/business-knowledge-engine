resource "azurerm_api_management" "this" {
  name                = "${var.name_prefix}-apim"
  location            = var.location
  resource_group_name = var.resource_group_name
  publisher_name      = var.publisher_name
  publisher_email     = var.publisher_email
  sku_name            = var.sku_name
  tags                = var.tags

  identity {
    type = "SystemAssigned"
  }

  # VNet integration (internal mode for private access)
  dynamic "virtual_network_configuration" {
    for_each = var.subnet_id != null ? [1] : []
    content {
      subnet_id = var.subnet_id
    }
  }

  virtual_network_type = var.subnet_id != null ? "Internal" : "None"
}

# Backend configuration for the API service
resource "azurerm_api_management_backend" "backend_api" {
  name                = "backend-api"
  resource_group_name = var.resource_group_name
  api_management_name = azurerm_api_management.this.name
  protocol            = "http"
  url                 = var.backend_url

  tls {
    validate_certificate_chain = true
    validate_certificate_name  = true
  }

  credentials {
    header = {
      "X-Forwarded-From" = "APIM"
    }
  }
}

# API definition for Business Knowledge Platform
resource "azurerm_api_management_api" "knowledge_api" {
  name                  = "business-knowledge-api"
  resource_group_name   = var.resource_group_name
  api_management_name   = azurerm_api_management.this.name
  revision              = "1"
  display_name          = "Business Knowledge Platform API"
  path                  = "api"
  protocols             = ["https"]
  service_url           = var.backend_url
  subscription_required = false

  import {
    content_format = "openapi+json-link"
    content_value  = "${var.backend_url}/api-docs/swagger.json"
  }
}

# Global API policy (authentication, rate limiting, CORS)
resource "azurerm_api_management_api_policy" "knowledge_api_policy" {
  api_name            = azurerm_api_management_api.knowledge_api.name
  api_management_name = azurerm_api_management.this.name
  resource_group_name = var.resource_group_name

  xml_content = <<XML
<policies>
  <inbound>
    <base />
    <!-- CORS policy -->
    <cors allow-credentials="true">
      <allowed-origins>
        <origin>${var.frontend_url}</origin>
      </allowed-origins>
      <allowed-methods>
        <method>GET</method>
        <method>POST</method>
        <method>PUT</method>
        <method>DELETE</method>
        <method>PATCH</method>
        <method>OPTIONS</method>
      </allowed-methods>
      <allowed-headers>
        <header>*</header>
      </allowed-headers>
      <expose-headers>
        <header>*</header>
      </expose-headers>
    </cors>
    <!-- Rate limiting -->
    <rate-limit-by-key calls="100" renewal-period="60" counter-key="@(context.Request.IpAddress)" />
    <!-- Validate Azure AD JWT -->
    <validate-azure-ad-token tenant-id="${var.azure_ad_tenant_id}">
      <client-application-ids>
        <application-id>${var.azure_ad_client_id}</application-id>
      </client-application-ids>
    </validate-azure-ad-token>
    <!-- Set backend -->
    <set-backend-service backend-id="backend-api" />
  </inbound>
  <backend>
    <base />
  </backend>
  <outbound>
    <base />
    <!-- Add security headers -->
    <set-header name="X-Content-Type-Options" exists-action="override">
      <value>nosniff</value>
    </set-header>
    <set-header name="X-Frame-Options" exists-action="override">
      <value>DENY</value>
    </set-header>
  </outbound>
  <on-error>
    <base />
  </on-error>
</policies>
XML
}

# Health check endpoint (no auth required)
resource "azurerm_api_management_api_operation" "health_check" {
  operation_id        = "health-check"
  api_name            = azurerm_api_management_api.knowledge_api.name
  api_management_name = azurerm_api_management.this.name
  resource_group_name = var.resource_group_name
  display_name        = "Health Check"
  method              = "GET"
  url_template        = "/health"
  description         = "Health check endpoint"

  response {
    status_code = 200
  }
}

# Override policy for health check (no auth)
resource "azurerm_api_management_api_operation_policy" "health_check_policy" {
  api_name            = azurerm_api_management_api.knowledge_api.name
  api_management_name = azurerm_api_management.this.name
  resource_group_name = var.resource_group_name
  operation_id        = azurerm_api_management_api_operation.health_check.operation_id

  xml_content = <<XML
<policies>
  <inbound>
    <base />
    <!-- Skip Azure AD validation for health check -->
  </inbound>
  <backend>
    <base />
  </backend>
  <outbound>
    <base />
  </outbound>
  <on-error>
    <base />
  </on-error>
</policies>
XML
}

# Named value for backend URL (can be referenced in policies)
resource "azurerm_api_management_named_value" "backend_url" {
  name                = "backend-url"
  resource_group_name = var.resource_group_name
  api_management_name = azurerm_api_management.this.name
  display_name        = "backend-url"
  value               = var.backend_url
}
