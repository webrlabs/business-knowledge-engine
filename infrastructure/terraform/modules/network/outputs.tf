output "vnet_id" {
  value = azurerm_virtual_network.this.id
}

output "subnet_ids" {
  value = { for k, v in azurerm_subnet.this : k => v.id }
}

output "nsg_ids" {
  value = {
    app               = azurerm_network_security_group.app.id
    functions         = azurerm_network_security_group.functions.id
    private_endpoints = azurerm_network_security_group.private_endpoints.id
  }
}
