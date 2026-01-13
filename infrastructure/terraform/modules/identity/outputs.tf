output "frontend_app_id" {
  value = azuread_application.frontend.client_id
}

output "backend_app_id" {
  value = azuread_application.backend.client_id
}

output "backend_app_uri" {
  value = local.backend_app_uri
}

output "backend_scope_id" {
  value = random_uuid.backend_scope_id.result
}
