output "storage_account_name" {
  value = azurerm_storage_account.documents.name
}

output "storage_account_id" {
  value = azurerm_storage_account.documents.id
}

output "storage_documents_container_name" {
  value = azurerm_storage_container.raw.name
}

output "cosmos_account_name" {
  value = azurerm_cosmosdb_account.data.name
}

output "cosmos_account_id" {
  value = azurerm_cosmosdb_account.data.id
}

output "cosmos_endpoint" {
  value = azurerm_cosmosdb_account.data.endpoint
}

output "cosmos_database_name" {
  value = azurerm_cosmosdb_sql_database.main.name
}

output "cosmos_documents_container_name" {
  value = azurerm_cosmosdb_sql_container.documents.name
}

output "cosmos_audit_container_name" {
  value = azurerm_cosmosdb_sql_container.audit.name
}

output "search_name" {
  value = azurerm_search_service.this.name
}

output "search_id" {
  value = azurerm_search_service.this.id
}

output "search_endpoint" {
  value = "https://${azurerm_search_service.this.name}.search.windows.net"
}

# Gremlin outputs
output "gremlin_account_name" {
  value = azurerm_cosmosdb_account.gremlin.name
}

output "gremlin_account_id" {
  value = azurerm_cosmosdb_account.gremlin.id
}

output "gremlin_endpoint" {
  value = "wss://${azurerm_cosmosdb_account.gremlin.name}.gremlin.cosmos.azure.com:443/"
}

output "gremlin_database_name" {
  value = azurerm_cosmosdb_gremlin_database.graph.name
}

output "gremlin_graph_name" {
  value = azurerm_cosmosdb_gremlin_graph.entities.name
}

