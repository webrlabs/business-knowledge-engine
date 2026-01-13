variable "project" {
  description = "Short project slug used in naming."
  type        = string
  default     = "bke"
}

variable "environment" {
  description = "Deployment environment (dev, stage, prod)."
  type        = string
  default     = "dev"
}

variable "location" {
  description = "Azure region for all resources."
  type        = string
  default     = "East US"
}

variable "tags" {
  description = "Base tags applied to all resources."
  type        = map(string)
  default     = {}
}

variable "address_space" {
  description = "VNet address space."
  type        = list(string)
  default     = ["10.20.0.0/16"]
}

variable "subnets" {
  description = "Subnet definitions."
  type = map(object({
    address_prefixes                          = list(string)
    private_endpoint_network_policies_enabled = optional(bool)
    private_link_service_network_policies_enabled = optional(bool)
    delegation = optional(object({
      name = string
      service_delegation = object({
        name    = string
        actions = list(string)
      })
    }))
  }))
  default = {
    app = {
      address_prefixes = ["10.20.1.0/24"]
      delegation = {
        name = "appservice-delegation"
        service_delegation = {
          name    = "Microsoft.Web/serverFarms"
          actions = ["Microsoft.Network/virtualNetworks/subnets/action"]
        }
      }
    }
    functions = {
      address_prefixes = ["10.20.2.0/24"]
      delegation = {
        name = "functionapp-delegation"
        service_delegation = {
          name    = "Microsoft.Web/serverFarms"
          actions = ["Microsoft.Network/virtualNetworks/subnets/action"]
        }
      }
    }
    private_endpoints = {
      address_prefixes = ["10.20.3.0/24"]
      private_endpoint_network_policies_enabled = false
    }
  }
}

variable "openai_model_name" {
  description = "OpenAI model deployment name."
  type        = string
  default     = "gpt-5.2"
}

variable "cosmos_database_name" {
  description = "Cosmos DB SQL database name."
  type        = string
  default     = "knowledge-platform"
}

variable "cosmos_documents_container_name" {
  description = "Cosmos DB documents container name."
  type        = string
  default     = "documents"
}

variable "cosmos_audit_container_name" {
  description = "Cosmos DB audit log container name."
  type        = string
  default     = "audit-logs"
}

variable "storage_documents_container_name" {
  description = "Blob container name for uploaded documents."
  type        = string
  default     = "documents"
}

variable "storage_processed_container_name" {
  description = "Blob container name for processed outputs."
  type        = string
  default     = "processed"
}

variable "storage_public_network_access_enabled" {
  description = "Allow public network access to Storage for Terraform data plane calls."
  type        = bool
  default     = true
}

variable "cosmos_public_network_access_enabled" {
  description = "Allow public network access to Cosmos DB."
  type        = bool
  default     = true
}

variable "search_public_network_access_enabled" {
  description = "Allow public network access to Azure AI Search."
  type        = bool
  default     = true
}

variable "aiservices_public_network_access_enabled" {
  description = "Allow public network access to Azure AI Services account."
  type        = bool
  default     = true
}

variable "docint_public_network_access_enabled" {
  description = "Allow public network access to Document Intelligence."
  type        = bool
  default     = true
}

variable "keyvault_public_network_access_enabled" {
  description = "Allow public network access to Key Vault."
  type        = bool
  default     = true
}

variable "enable_private_endpoints" {
  description = "Create private endpoints and private DNS zones."
  type        = bool
  default     = false
}

variable "openai_embedding_deployment" {
  description = "Embedding deployment name."
  type        = string
  default     = "text-embedding-ada-002"
}

variable "openai_api_version" {
  description = "Azure OpenAI API version."
  type        = string
  default     = "2024-02-15-preview"
}

variable "search_index_name" {
  description = "Azure AI Search index name."
  type        = string
  default     = "documents"
}

variable "frontend_redirect_uri" {
  description = "Frontend redirect URI for Entra ID auth."
  type        = string
  default     = "http://localhost:3001/auth/callback"
}

variable "frontend_api_scope" {
  description = "Frontend API scope for Entra ID."
  type        = string
  default     = ""
}

variable "azure_ad_audience" {
  description = "Backend API audience for Entra ID."
  type        = string
  default     = ""
}

variable "create_foundry_hub" {
  description = "Create Azure AI Foundry Hub workspace (optional)."
  type        = bool
  default     = false
}

variable "cosmos_data_contributor_role_definition_id" {
  description = "Cosmos DB built-in data contributor role definition id."
  type        = string
  default     = "00000000-0000-0000-0000-000000000002"
}

variable "apim_publisher_name" {
  description = "Name of the API publisher organization."
  type        = string
  default     = "Business Knowledge Platform"
}

variable "apim_publisher_email" {
  description = "Email address of the API publisher."
  type        = string
  default     = "admin@example.com"
}

variable "apim_sku" {
  description = "SKU name for API Management (Developer_1, Basic_1, Standard_1, Premium_1)."
  type        = string
  default     = "Developer_1"
}

variable "appservice_sku_name" {
  description = "App Service plan SKU for frontend/backend."
  type        = string
  default     = "B1"
}

variable "function_sku_name" {
  description = "Function App plan SKU."
  type        = string
  default     = "Y1"
}

variable "function_os_type" {
  description = "Function App plan OS type (Windows or Linux)."
  type        = string
  default     = "Linux"
}

variable "function_vnet_integration_enabled" {
  description = "Enable VNet integration for Function App (requires premium/dedicated plan)."
  type        = bool
  default     = false
}

variable "appservice_vnet_integration_enabled" {
  description = "Enable VNet integration for App Service (requires supported SKU)."
  type        = bool
  default     = false
}
