resource "azurerm_key_vault" "this" {
  name                        = var.name
  location                    = var.location
  resource_group_name         = var.resource_group_name
  tenant_id                   = var.tenant_id
  sku_name                    = "standard"
  soft_delete_retention_days  = 90
  purge_protection_enabled    = true
  public_network_access_enabled = var.public_network_access_enabled

  access_policy {
    tenant_id = var.tenant_id
    object_id = var.object_id

    key_permissions    = ["Get", "List"]
    secret_permissions = ["Get", "List", "Set", "Delete"]
  }

  dynamic "access_policy" {
    for_each = toset(var.additional_object_ids)
    content {
      tenant_id = var.tenant_id
      object_id = access_policy.value

      key_permissions    = ["Get", "List"]
      secret_permissions = ["Get", "List"]
    }
  }

  tags = var.tags
}
