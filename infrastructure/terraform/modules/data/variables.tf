variable "name_prefix" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "cosmos_database_name" {
  type    = string
  default = "knowledge-platform"
}

variable "cosmos_documents_container_name" {
  type    = string
  default = "documents"
}

variable "cosmos_audit_container_name" {
  type    = string
  default = "audit-logs"
}

variable "storage_documents_container_name" {
  type    = string
  default = "documents"
}

variable "storage_processed_container_name" {
  type    = string
  default = "processed"
}

variable "storage_public_network_access_enabled" {
  type    = bool
  default = true
}

variable "cosmos_public_network_access_enabled" {
  type    = bool
  default = true
}

variable "search_public_network_access_enabled" {
  type    = bool
  default = true
}

variable "search_index_name" {
  type    = string
  default = "documents"
}

# Gremlin (Knowledge Graph)
variable "cosmos_gremlin_database_name" {
  type    = string
  default = "knowledge-graph"
}

variable "cosmos_gremlin_graph_name" {
  type    = string
  default = "entities"
}

