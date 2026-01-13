# Network Security Groups for subnet protection
# These NSGs implement defense-in-depth security controls

# NSG for App Service subnet
resource "azurerm_network_security_group" "app" {
  name                = "${var.name}-app-nsg"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

# NSG for Functions subnet
resource "azurerm_network_security_group" "functions" {
  name                = "${var.name}-functions-nsg"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

# NSG for Private Endpoints subnet
resource "azurerm_network_security_group" "private_endpoints" {
  name                = "${var.name}-pe-nsg"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

# ===== App Subnet Security Rules =====

# Allow HTTPS outbound to private endpoints subnet
resource "azurerm_network_security_rule" "app_to_pe_https" {
  name                        = "Allow-HTTPS-To-PrivateEndpoints"
  priority                    = 100
  direction                   = "Outbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "443"
  source_address_prefix       = "VirtualNetwork"
  destination_address_prefix  = var.subnets["private_endpoints"].address_prefixes[0]
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.app.name
}

# Allow outbound to Azure Monitor (for Application Insights)
resource "azurerm_network_security_rule" "app_to_azure_monitor" {
  name                        = "Allow-AzureMonitor-Outbound"
  priority                    = 200
  direction                   = "Outbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "443"
  source_address_prefix       = "VirtualNetwork"
  destination_address_prefix  = "AzureMonitor"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.app.name
}

# Allow outbound to Azure AD for authentication
resource "azurerm_network_security_rule" "app_to_azure_ad" {
  name                        = "Allow-AzureAD-Outbound"
  priority                    = 210
  direction                   = "Outbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "443"
  source_address_prefix       = "VirtualNetwork"
  destination_address_prefix  = "AzureActiveDirectory"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.app.name
}

# Deny direct inter-app communication (defense in depth)
resource "azurerm_network_security_rule" "app_deny_inter_app" {
  name                        = "Deny-Inter-App-Traffic"
  priority                    = 4000
  direction                   = "Outbound"
  access                      = "Deny"
  protocol                    = "*"
  source_port_range           = "*"
  destination_port_range      = "*"
  source_address_prefix       = var.subnets["app"].address_prefixes[0]
  destination_address_prefix  = var.subnets["app"].address_prefixes[0]
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.app.name
}

# ===== Functions Subnet Security Rules =====

# Allow HTTPS outbound to private endpoints subnet
resource "azurerm_network_security_rule" "functions_to_pe_https" {
  name                        = "Allow-HTTPS-To-PrivateEndpoints"
  priority                    = 100
  direction                   = "Outbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "443"
  source_address_prefix       = "VirtualNetwork"
  destination_address_prefix  = var.subnets["private_endpoints"].address_prefixes[0]
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.functions.name
}

# Allow outbound to Azure Monitor
resource "azurerm_network_security_rule" "functions_to_azure_monitor" {
  name                        = "Allow-AzureMonitor-Outbound"
  priority                    = 200
  direction                   = "Outbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "443"
  source_address_prefix       = "VirtualNetwork"
  destination_address_prefix  = "AzureMonitor"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.functions.name
}

# Allow outbound to Azure AD
resource "azurerm_network_security_rule" "functions_to_azure_ad" {
  name                        = "Allow-AzureAD-Outbound"
  priority                    = 210
  direction                   = "Outbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "443"
  source_address_prefix       = "VirtualNetwork"
  destination_address_prefix  = "AzureActiveDirectory"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.functions.name
}

# Allow outbound to Azure Storage (for Function App runtime)
resource "azurerm_network_security_rule" "functions_to_storage" {
  name                        = "Allow-Storage-Outbound"
  priority                    = 220
  direction                   = "Outbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "443"
  source_address_prefix       = "VirtualNetwork"
  destination_address_prefix  = "Storage"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.functions.name
}

# ===== Private Endpoints Subnet Security Rules =====

# Allow inbound from App subnet
resource "azurerm_network_security_rule" "pe_from_app" {
  name                        = "Allow-From-App-Subnet"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "443"
  source_address_prefix       = var.subnets["app"].address_prefixes[0]
  destination_address_prefix  = "VirtualNetwork"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.private_endpoints.name
}

# Allow inbound from Functions subnet
resource "azurerm_network_security_rule" "pe_from_functions" {
  name                        = "Allow-From-Functions-Subnet"
  priority                    = 110
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "443"
  source_address_prefix       = var.subnets["functions"].address_prefixes[0]
  destination_address_prefix  = "VirtualNetwork"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.private_endpoints.name
}

# Deny all other inbound traffic to private endpoints
resource "azurerm_network_security_rule" "pe_deny_other_inbound" {
  name                        = "Deny-Other-Inbound"
  priority                    = 4000
  direction                   = "Inbound"
  access                      = "Deny"
  protocol                    = "*"
  source_port_range           = "*"
  destination_port_range      = "*"
  source_address_prefix       = "*"
  destination_address_prefix  = "VirtualNetwork"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.private_endpoints.name
}

# ===== Subnet Associations =====

resource "azurerm_subnet_network_security_group_association" "app" {
  subnet_id                 = azurerm_subnet.this["app"].id
  network_security_group_id = azurerm_network_security_group.app.id
}

resource "azurerm_subnet_network_security_group_association" "functions" {
  subnet_id                 = azurerm_subnet.this["functions"].id
  network_security_group_id = azurerm_network_security_group.functions.id
}

resource "azurerm_subnet_network_security_group_association" "private_endpoints" {
  subnet_id                 = azurerm_subnet.this["private_endpoints"].id
  network_security_group_id = azurerm_network_security_group.private_endpoints.id
}
