resource "random_string" "aiservices_suffix" {
  length  = 6
  upper   = false
  special = false
}

resource "random_string" "docint_suffix" {
  length  = 6
  upper   = false
  special = false
}

resource "azapi_resource" "aiservices" {
  name      = "${var.name_prefix}-aiservices"
  location  = var.location
  parent_id = var.resource_group_id
  type      = "Microsoft.CognitiveServices/accounts@2023-05-01"
  tags      = var.tags
  schema_validation_enabled = false

  identity {
    type = "SystemAssigned"
  }

  body = jsonencode({
    kind = "AIServices"
    sku = {
      name = "S0"
    }
    properties = {
      allowProjectManagement = true
      publicNetworkAccess    = var.aiservices_public_network_access_enabled ? "Enabled" : "Disabled"
      customSubDomainName    = "${var.name_prefix}-aiservices-${random_string.aiservices_suffix.result}"
    }
  })

  response_export_values = ["properties.endpoint"]
}

resource "azurerm_cognitive_account" "docint" {
  name                = "${var.name_prefix}-docint"
  location            = var.location
  resource_group_name = var.resource_group_name
  kind                = "FormRecognizer"
  sku_name            = "S0"
  public_network_access_enabled = var.docint_public_network_access_enabled
  custom_subdomain_name = "${var.name_prefix}-docint-${random_string.docint_suffix.result}"
  tags                = var.tags
}

resource "azapi_resource" "foundry_hub" {
  count     = var.create_foundry_hub ? 1 : 0
  name      = "${var.name_prefix}-foundry-hub"
  location  = var.location
  parent_id = var.resource_group_id
  type      = "Microsoft.MachineLearningServices/workspaces@2023-10-01"

  body = jsonencode({
    kind = "Hub"
    properties = {
      description = "Azure AI Foundry Hub (stub)"
    }
  })
}
