# Security Documentation

## Overview

The Business Knowledge Platform implements defense-in-depth security measures across all layers of the application stack.

## Authentication & Authorization

### Azure AD (Entra ID) Integration

All API endpoints require Azure AD authentication using OAuth 2.0 Bearer tokens.

**Token Flow:**
1. Frontend acquires token from Azure AD using MSAL
2. Token is sent in Authorization header
3. Backend validates token using Azure AD public keys
4. User identity and roles are extracted from token claims

**Required Token Claims:**
- `aud`: Must match the backend application ID URI
- `iss`: Must be from the configured Azure AD tenant
- `roles`: Used for role-based access control

### Role-Based Access Control (RBAC)

| Role | Permissions |
|------|-------------|
| Admin | Full access to all features |
| Reviewer | Review and approve/reject entities |
| Contributor | Upload documents, query knowledge graph |
| Reader | View-only access to approved content |

**Role Assignment:**
Roles are assigned via Azure AD Enterprise Applications or app role assignments.

## Input Validation

### Request Validation

All API inputs are validated using Joi schemas:
- Document IDs: UUID format validation
- Query strings: Length limits, character validation
- File uploads: Type and size restrictions

### OData Injection Prevention

Search queries use parameterized OData filters with proper escaping:
```javascript
const safeId = documentId.replace(/'/g, "''");
filter: `documentId eq '${safeId}'`
```

## Network Security

### VNet Integration

All Azure services are deployed within a Virtual Network:

```
┌─────────────────────────────────────────────────────────────┐
│                        VNet (10.20.0.0/16)                  │
│                                                              │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────┐  │
│  │  App Subnet    │  │ Functions      │  │ Private       │  │
│  │  10.20.1.0/24  │  │ 10.20.2.0/24   │  │ Endpoints     │  │
│  │                │  │                │  │ 10.20.3.0/24  │  │
│  │  - Backend     │  │  - Graph Sync  │  │               │  │
│  │  - Frontend    │  │  - Doc Proc    │  │  - Cosmos DB  │  │
│  └────────────────┘  └────────────────┘  │  - Storage    │  │
│                                          │  - Key Vault  │  │
│                                          └───────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Network Security Groups (NSGs)

**App Subnet NSG Rules:**
| Priority | Direction | Action | Source | Destination | Port | Description |
|----------|-----------|--------|--------|-------------|------|-------------|
| 100 | Inbound | Allow | Internet | Any | 443 | HTTPS traffic |
| 200 | Inbound | Allow | AzureLoadBalancer | Any | * | Health probes |
| 4096 | Inbound | Deny | Any | Any | * | Deny all other |
| 100 | Outbound | Allow | Any | VirtualNetwork | 443 | Private endpoints |
| 200 | Outbound | Allow | Any | AzureCloud | 443 | Azure services |
| 4096 | Outbound | Deny | Any | Internet | * | Deny direct internet |

### Private Endpoints

All Azure PaaS services use private endpoints:
- Cosmos DB
- Azure Storage
- Key Vault
- Azure AI Search
- Azure OpenAI

## Data Protection

### Encryption at Rest

| Service | Encryption |
|---------|------------|
| Cosmos DB | Microsoft-managed keys (default) |
| Azure Storage | Microsoft-managed keys (default) |
| Key Vault | HSM-backed keys |

### Encryption in Transit

- All HTTP traffic uses TLS 1.2 or higher
- Internal service communication uses private endpoints
- mTLS available for sensitive workloads

### Key Vault Usage

Sensitive configuration values are stored in Azure Key Vault:
- Database connection strings
- API keys
- Certificate secrets

**Access Control:**
- Managed identities for Azure services
- No secrets in application code or config files

## API Security

### Rate Limiting

Rate limits are enforced at multiple levels:

**Application Level (express-rate-limit):**
| Endpoint Type | Limit |
|---------------|-------|
| General API | 100 req/15 min |
| Auth endpoints | 5 req/15 min |
| Document processing | 10 req/min |
| GraphRAG queries | 30 req/min |
| Document uploads | 20 req/hour |

**APIM Level:**
Additional rate limiting and throttling policies in Azure API Management.

### Security Headers

Response headers set by the application:
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Content-Security-Policy: default-src 'self'
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### CORS Configuration

CORS is configured to allow only the frontend application origin:
```javascript
cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
})
```

## Audit Logging

### What is Logged

All significant actions are recorded in an immutable audit log:
- Entity approvals/rejections
- Document uploads
- User authentication events
- Configuration changes

### Audit Log Entry Format

```json
{
  "id": "uuid",
  "timestamp": "ISO 8601",
  "action": "approve|reject|create|update|delete",
  "entityType": "entity|relationship|document",
  "entityId": "uuid",
  "userId": "user@example.com",
  "userName": "User Name",
  "details": {
    "entityName": "...",
    "reason": "..."
  },
  "immutable": true
}
```

### Log Retention

- Audit logs are stored in Cosmos DB with Time-to-Live disabled
- Logs are retained indefinitely for compliance
- Purge protection is enabled on Key Vault

## Vulnerability Management

### Dependency Scanning

- `npm audit` runs in CI pipeline
- High severity vulnerabilities block deployments
- Weekly automated dependency updates via Dependabot

### Static Analysis

- ESLint security rules enabled
- Gitleaks for secret detection
- Trivy for container vulnerability scanning

### Penetration Testing

Recommended annual penetration testing covering:
- API endpoint security
- Authentication bypass attempts
- Injection attacks (SQL, XSS, OData)
- Authorization bypass
- Rate limit evasion

## Incident Response

### Security Monitoring

- Azure Monitor alerts for suspicious activity
- Application Insights for anomaly detection
- Failed authentication tracking

### Response Procedures

1. **Detection**: Automated alerting via Azure Monitor
2. **Containment**: Disable affected endpoints/users
3. **Investigation**: Review audit logs and Application Insights
4. **Remediation**: Apply fixes and patches
5. **Recovery**: Restore from backups if needed
6. **Lessons Learned**: Update security policies

## Compliance Considerations

### Data Residency

- All data stored in the configured Azure region
- No cross-region replication by default
- Configure geo-redundancy based on compliance requirements

### Data Retention

- Documents: Configurable retention period
- Audit logs: Retained indefinitely
- Processed data: Follows document retention

### Access Reviews

- Quarterly review of Azure AD group memberships
- Annual review of app role assignments
- Key Vault access audit

## Security Checklist

### Pre-Deployment

- [ ] All secrets in Key Vault (not in code/config)
- [ ] VNet and NSGs configured
- [ ] Private endpoints enabled for all PaaS services
- [ ] Azure AD app registrations secured
- [ ] CORS configured for specific origins only

### Post-Deployment

- [ ] Vulnerability scan completed
- [ ] Rate limiting verified
- [ ] Health endpoints accessible
- [ ] Audit logging confirmed working
- [ ] SSL/TLS certificates valid

### Ongoing

- [ ] Weekly dependency updates reviewed
- [ ] Monthly access reviews
- [ ] Quarterly security assessments
- [ ] Annual penetration testing
