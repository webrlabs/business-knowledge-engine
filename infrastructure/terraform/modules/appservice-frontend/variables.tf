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

variable "api_base_url" {
  type    = string
  default = ""
}

variable "subnet_id" {
  type = string
}

variable "azure_ad_client_id" {
  type    = string
  default = ""
}

variable "azure_ad_tenant_id" {
  type    = string
  default = ""
}

variable "azure_ad_redirect_uri" {
  type    = string
  default = ""
}

variable "api_scope" {
  type    = string
  default = ""
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

variable "tags" {
  type    = map(string)
  default = {}
}
