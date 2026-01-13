output "name" {
  value = length(azurerm_linux_function_app.this) > 0 ? azurerm_linux_function_app.this[0].name : azurerm_windows_function_app.this[0].name
}

output "principal_id" {
  value = length(azurerm_linux_function_app.this) > 0 ? azurerm_linux_function_app.this[0].identity[0].principal_id : azurerm_windows_function_app.this[0].identity[0].principal_id
}

output "app_id" {
  value = length(azurerm_linux_function_app.this) > 0 ? azurerm_linux_function_app.this[0].id : azurerm_windows_function_app.this[0].id
}
