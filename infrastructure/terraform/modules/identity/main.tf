resource "random_uuid" "backend_scope_id" {}
resource "random_uuid" "role_admin_id" {}
resource "random_uuid" "role_reviewer_id" {}
resource "random_uuid" "role_contributor_id" {}

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

  app_role {
    allowed_member_types = ["User"]
    description          = "Full administrative access to all features"
    display_name         = "Admin"
    enabled              = true
    id                   = random_uuid.role_admin_id.result
    value                = "Admin"
  }

  app_role {
    allowed_member_types = ["User"]
    description          = "Can review and approve documents"
    display_name         = "Reviewer"
    enabled              = true
    id                   = random_uuid.role_reviewer_id.result
    value                = "Reviewer"
  }

  app_role {
    allowed_member_types = ["User"]
    description          = "Can upload and edit documents"
    display_name         = "Contributor"
    enabled              = true
    id                   = random_uuid.role_contributor_id.result
    value                = "Contributor"
  }

  # Ensure roles claim is included in access tokens
  optional_claims {
    access_token {
      name = "roles"
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
