locals {
  name_prefix = "${var.project}-${var.environment}"
  tags = merge(
    var.tags,
    {
      environment = var.environment
      project     = var.project
      managed_by  = "terraform"
    }
  )
}
