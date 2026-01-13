output "name" {
  description = "Name of the API Management instance"
  value       = azurerm_api_management.this.name
}

output "id" {
  description = "ID of the API Management instance"
  value       = azurerm_api_management.this.id
}

output "gateway_url" {
  description = "Gateway URL for the API Management instance"
  value       = azurerm_api_management.this.gateway_url
}

output "management_api_url" {
  description = "Management API URL"
  value       = azurerm_api_management.this.management_api_url
}

output "portal_url" {
  description = "Developer portal URL"
  value       = azurerm_api_management.this.developer_portal_url
}

output "principal_id" {
  description = "Principal ID of the managed identity"
  value       = azurerm_api_management.this.identity[0].principal_id
}

output "api_id" {
  description = "ID of the Business Knowledge API"
  value       = azurerm_api_management_api.knowledge_api.id
}
