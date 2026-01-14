variable "name_prefix" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "subnet_id" {
  type = string
}

variable "vnet_id" {
  type = string
}

variable "storage_account_id" {
  type = string
}

variable "cosmos_account_id" {
  type = string
}

variable "search_service_id" {
  type = string
}

variable "key_vault_id" {
  type = string
}

variable "openai_account_id" {
  type = string
}

variable "docint_account_id" {
  type = string
}

variable "gremlin_account_id" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
