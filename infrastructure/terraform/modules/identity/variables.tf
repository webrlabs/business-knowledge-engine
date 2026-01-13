variable "name_prefix" {
  type = string
}

variable "tenant_id" {
  type = string
}

variable "owner_object_id" {
  type    = string
  default = ""
}

variable "frontend_redirect_uris" {
  type    = list(string)
  default = []
}
