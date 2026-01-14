variable "name_prefix" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "key_vault_uri" {
  type    = string
  default = ""
}

variable "app_insights_connection" {
  type    = string
  default = ""
}

variable "subnet_id" {
  type = string
}

variable "cosmos_endpoint" {
  type    = string
  default = ""
}

variable "cosmos_database_name" {
  type    = string
  default = ""
}

variable "cosmos_documents_container_name" {
  type    = string
  default = ""
}

variable "cosmos_audit_container_name" {
  type    = string
  default = ""
}

variable "storage_account_name" {
  type    = string
  default = ""
}

variable "storage_documents_container_name" {
  type    = string
  default = ""
}

variable "search_endpoint" {
  type    = string
  default = ""
}

variable "search_index_name" {
  type    = string
  default = ""
}

variable "openai_endpoint" {
  type    = string
  default = ""
}

variable "openai_deployment_name" {
  type    = string
  default = ""
}

variable "openai_embedding_deployment" {
  type    = string
  default = ""
}

variable "openai_api_version" {
  type    = string
  default = ""
}

variable "form_recognizer_endpoint" {
  type    = string
  default = ""
}

variable "azure_ad_tenant_id" {
  type    = string
  default = ""
}

variable "azure_ad_client_id" {
  type    = string
  default = ""
}

variable "azure_ad_audience" {
  type    = string
  default = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "sku_name" {
  type    = string
  default = "B1"
}

variable "enable_vnet_integration" {
  type    = bool
  default = false
}

variable "node_version" {
  type    = string
  default = "24-lts"
}

# Gremlin Knowledge Graph
variable "gremlin_endpoint" {
  type    = string
  default = ""
}

variable "gremlin_database_name" {
  type    = string
  default = ""
}

variable "gremlin_graph_name" {
  type    = string
  default = ""
}

# Application settings
variable "port" {
  type    = number
  default = 8080
}

variable "log_level" {
  type    = string
  default = "info"
}

# Feature flags
variable "enable_pii_redaction" {
  type    = bool
  default = true
}

# Rate limiting
variable "rate_limit_window_ms" {
  type    = number
  default = 900000
}

variable "rate_limit_max_requests" {
  type    = number
  default = 100
}

variable "openai_rpm_limit" {
  type    = number
  default = 60
}

variable "openai_tpm_limit" {
  type    = number
  default = 90000
}
