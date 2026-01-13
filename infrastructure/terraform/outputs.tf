output "resource_group_name" {
  value = module.resource_group.name
}

output "frontend_url" {
  value = "https://${module.appservice_frontend.default_hostname}"
}

output "backend_url" {
  value = "https://${module.appservice_backend.default_hostname}"
}

output "functionapp_name" {
  value = module.functionapp.name
}

output "key_vault_uri" {
  value = module.keyvault.vault_uri
}

output "ai_search_name" {
  value = module.data.search_name
}

output "cosmos_account_name" {
  value = module.data.cosmos_account_name
}

output "openai_account_name" {
  value = module.ai_foundry.openai_account_name
}

output "cosmos_endpoint" {
  value = module.data.cosmos_endpoint
}

output "storage_account_name" {
  value = module.data.storage_account_name
}

output "search_endpoint" {
  value = module.data.search_endpoint
}
