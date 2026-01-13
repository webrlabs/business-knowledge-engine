variable "name" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "address_space" {
  type = list(string)
}

variable "subnets" {
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
}

variable "tags" {
  type    = map(string)
  default = {}
}
