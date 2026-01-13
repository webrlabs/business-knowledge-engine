variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "location" {
  description = "Azure region for resources"
  type        = string
}

variable "resource_group_name" {
  description = "Name of the resource group"
  type        = string
}

variable "publisher_name" {
  description = "Name of the API publisher organization"
  type        = string
}

variable "publisher_email" {
  description = "Email address of the API publisher"
  type        = string
}

variable "sku_name" {
  description = "SKU name for API Management (Developer_1, Basic_1, Standard_1, Premium_1)"
  type        = string
  default     = "Developer_1"
}

variable "backend_url" {
  description = "URL of the backend API service"
  type        = string
}

variable "frontend_url" {
  description = "URL of the frontend application (for CORS)"
  type        = string
}

variable "azure_ad_tenant_id" {
  description = "Azure AD tenant ID for JWT validation"
  type        = string
}

variable "azure_ad_client_id" {
  description = "Azure AD client/application ID for JWT validation"
  type        = string
}

variable "subnet_id" {
  description = "Subnet ID for VNet integration (optional, set to null for public access)"
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}
