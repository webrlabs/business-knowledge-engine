output "openai_account_name" {
  value = azapi_resource.aiservices.name
}

output "openai_account_id" {
  value = azapi_resource.aiservices.id
}

output "openai_endpoint" {
  # Construct endpoint from custom subdomain - more reliable than azapi output
  value = "https://${var.name_prefix}-aiservices-${random_string.aiservices_suffix.result}.cognitiveservices.azure.com/"
}

output "docint_account_name" {
  value = azurerm_cognitive_account.docint.name
}

output "docint_account_id" {
  value = azurerm_cognitive_account.docint.id
}

output "docint_endpoint" {
  value = azurerm_cognitive_account.docint.endpoint
}

output "foundry_hub_id" {
  value = try(azapi_resource.foundry_hub[0].id, null)
}
