resource "random_uuid" "backend_scope_id" {}

locals {
  backend_app_uri = "api://${var.name_prefix}-backend"
}

resource "azuread_application" "backend" {
  display_name    = "${var.name_prefix}-backend"
  owners          = var.owner_object_id == "" ? [] : [var.owner_object_id]
  identifier_uris = [local.backend_app_uri]

  api {
    requested_access_token_version = 2

    oauth2_permission_scope {
      admin_consent_description  = "Access the backend API"
      admin_consent_display_name = "Access backend API"
      enabled                    = true
      id                         = random_uuid.backend_scope_id.result
      type                       = "User"
      user_consent_description   = "Allow the app to access the backend API"
      user_consent_display_name  = "Access backend API"
      value                      = "access_as_user"
    }
  }
}

resource "azuread_application" "frontend" {
  display_name = "${var.name_prefix}-frontend"
  owners       = var.owner_object_id == "" ? [] : [var.owner_object_id]

  single_page_application {
    redirect_uris = var.frontend_redirect_uris
  }

  required_resource_access {
    resource_app_id = azuread_application.backend.client_id
    resource_access {
      id   = random_uuid.backend_scope_id.result
      type = "Scope"
    }
  }
}

resource "azuread_service_principal" "frontend" {
  client_id = azuread_application.frontend.client_id
}

resource "azuread_service_principal" "backend" {
  client_id = azuread_application.backend.client_id
}
