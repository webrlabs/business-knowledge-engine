variable "name_prefix" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "resource_group_id" {
  type = string
}

variable "openai_model_name" {
  type = string
}

variable "openai_embedding_deployment" {
  type    = string
  default = "text-embedding-ada-002"
}

variable "create_foundry_hub" {
  type    = bool
  default = false
}

variable "aiservices_public_network_access_enabled" {
  type    = bool
  default = true
}

variable "docint_public_network_access_enabled" {
  type    = bool
  default = true
}

variable "tags" {
  type    = map(string)
  default = {}
}

terraform {
  required_providers {
    azapi = {
      source = "azure/azapi"
    }
  }
}
