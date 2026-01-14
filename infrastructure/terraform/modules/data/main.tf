resource "random_string" "storage_suffix" {
  length  = 6
  upper   = false
  special = false
}

resource "azurerm_storage_account" "documents" {
  name                     = "${replace(var.name_prefix, "-", "")}docs${random_string.storage_suffix.result}"
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  is_hns_enabled           = true
  public_network_access_enabled = var.storage_public_network_access_enabled
  tags                     = var.tags
}

resource "azurerm_storage_container" "raw" {
  name                  = var.storage_documents_container_name
  storage_account_name  = azurerm_storage_account.documents.name
  container_access_type = "private"
}

resource "azurerm_storage_container" "processed" {
  name                  = var.storage_processed_container_name
  storage_account_name  = azurerm_storage_account.documents.name
  container_access_type = "private"
}

resource "azurerm_cosmosdb_account" "data" {
  name                = "${var.name_prefix}-cosmos"
  location            = var.location
  resource_group_name = var.resource_group_name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"
  public_network_access_enabled = var.cosmos_public_network_access_enabled

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = var.location
    failover_priority = 0
  }

  tags = var.tags
}

resource "azurerm_cosmosdb_sql_database" "main" {
  name                = var.cosmos_database_name
  resource_group_name = var.resource_group_name
  account_name        = azurerm_cosmosdb_account.data.name
}

resource "azurerm_cosmosdb_sql_container" "documents" {
  name                = var.cosmos_documents_container_name
  resource_group_name = var.resource_group_name
  account_name        = azurerm_cosmosdb_account.data.name
  database_name       = azurerm_cosmosdb_sql_database.main.name
  partition_key_paths = ["/documentType"]
}

resource "azurerm_cosmosdb_sql_container" "audit" {
  name                = var.cosmos_audit_container_name
  resource_group_name = var.resource_group_name
  account_name        = azurerm_cosmosdb_account.data.name
  database_name       = azurerm_cosmosdb_sql_database.main.name
  partition_key_paths = ["/entityType"]
}

resource "azurerm_search_service" "this" {
  name                = "${var.name_prefix}-search"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "standard"
  public_network_access_enabled = var.search_public_network_access_enabled
  tags                = var.tags
}

# Cosmos DB Gremlin Account for Knowledge Graph
resource "azurerm_cosmosdb_account" "gremlin" {
  name                = "${var.name_prefix}-gremlin"
  location            = var.location
  resource_group_name = var.resource_group_name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"
  public_network_access_enabled = var.cosmos_public_network_access_enabled

  capabilities {
    name = "EnableGremlin"
  }

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = var.location
    failover_priority = 0
  }

  tags = var.tags
}

resource "azurerm_cosmosdb_gremlin_database" "graph" {
  name                = var.cosmos_gremlin_database_name
  resource_group_name = var.resource_group_name
  account_name        = azurerm_cosmosdb_account.gremlin.name
}

resource "azurerm_cosmosdb_gremlin_graph" "entities" {
  name                = var.cosmos_gremlin_graph_name
  resource_group_name = var.resource_group_name
  account_name        = azurerm_cosmosdb_account.gremlin.name
  database_name       = azurerm_cosmosdb_gremlin_database.graph.name
  partition_key_path  = "/ontologyType"

  index_policy {
    automatic      = true
    indexing_mode  = "consistent"
    included_paths = ["/*"]
  }
}

