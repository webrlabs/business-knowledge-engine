variable "name_prefix" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "app_insights_connection" {
  type    = string
  default = ""
}

variable "subnet_id" {
  type = string
}

variable "key_vault_uri" {
  type    = string
  default = ""
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

variable "sku_name" {
  type    = string
  default = "Y1"
}

variable "enable_vnet_integration" {
  type    = bool
  default = false
}


variable "tags" {
  type    = map(string)
  default = {}
}
