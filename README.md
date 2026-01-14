# Business Knowledge Engine

An AI-powered knowledge management platform that ingests enterprise documents, builds a knowledge graph, and provides intelligent Q&A through GraphRAG (Graph Retrieval-Augmented Generation).

## Overview

This platform is designed for **enterprise environments** with:
- **Zero-Trust security** architecture with Microsoft Entra ID
- **Managed Identity** authentication (no secrets in code)
- **Private networking** support via Azure Private Endpoints
- **GDPR compliance** with audit logging and PII redaction
- **Scalable Azure-native** services

## Architecture

### Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 15, React 19, TypeScript, Tailwind CSS |
| **Backend API** | Node.js 24+, Express 5 |
| **Authentication** | Microsoft Entra ID, MSAL, JWT |
| **Document Processing** | Azure AI Document Intelligence |
| **AI/LLM** | Azure AI Foundry (GPT-5.2, text-embedding-ada-002) |
| **Vector Search** | Azure AI Search (hybrid + semantic ranking) |
| **Document Store** | Azure Cosmos DB (SQL API) |
| **Knowledge Graph** | Azure Cosmos DB (Gremlin API) |
| **File Storage** | Azure Blob Storage |
| **Secrets** | Azure Key Vault |
| **Monitoring** | Azure Application Insights |
| **Infrastructure** | Terraform |

### High-Level Architecture

```
                                    +------------------+
                                    |   Entra ID       |
                                    |  (Authentication)|
                                    +--------+---------+
                                             |
+------------------+              +----------v-----------+
|    Frontend      |   REST API   |      Backend API     |
|   (Next.js 15)   +------------->|    (Express 5)       |
+------------------+              +----------+-----------+
                                             |
          +----------------------------------+----------------------------------+
          |                    |                    |                           |
+---------v--------+  +--------v--------+  +-------v--------+  +---------------v-+
| Azure AI Search  |  | Azure AI Foundry|  | Cosmos DB      |  | Blob Storage    |
| (Vector + Hybrid)|  | (GPT-5.2/Embed) |  | (Docs + Graph) |  | (Files)         |
+------------------+  +-----------------+  +----------------+  +-----------------+
```

## Prerequisites

- **Node.js 24+** - [Download](https://nodejs.org/)
- **Azure CLI** - [Download](https://aka.ms/installazurecliwindows)
- **Terraform** (for infrastructure) - [Download](https://www.terraform.io/downloads)
- **Git** - [Download](https://git-scm.com/download/win)

## Getting Started

### 1. Clone and Install Dependencies

```bash
# Clone the repository
git clone https://github.com/your-org/business-knowledge-engine.git
cd business-knowledge-engine

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Azure Infrastructure Setup

Deploy the Azure infrastructure using Terraform:

```bash
cd infrastructure/terraform

# Initialize Terraform
terraform init

# Review the plan
terraform plan

# Deploy (creates all Azure resources)
terraform apply
```

This creates:
- Resource Group
- Virtual Network with subnets
- Azure OpenAI Service
- Azure AI Search
- Azure Cosmos DB (SQL + Gremlin APIs)
- Azure Blob Storage
- Azure Key Vault
- Azure App Services (frontend + backend)
- Azure Functions
- Application Insights
- API Management (optional)
- Private Endpoints (optional)

### 3. Environment Configuration

```bash
# Backend
cd backend
cp .env.example .env
# Edit .env with your Azure resource endpoints

# The backend uses DefaultAzureCredential for authentication
# No API keys needed - uses Managed Identity in Azure, Azure CLI locally
```

### 4. Run Locally

```bash
# Terminal 1: Start backend
cd backend
npm run dev

# Terminal 2: Start frontend
cd frontend
npm run dev
```

- **Frontend**: http://localhost:3001
- **Backend API**: http://localhost:8080
- **API Docs**: http://localhost:8080/api-docs

## Key Features

### Document Processing Pipeline
- Multi-format support (PDF, Word, PowerPoint, images)
- OCR and layout analysis via Azure AI Document Intelligence
- Automatic chunking with semantic boundaries
- Entity extraction and knowledge graph construction
- Vector embedding generation for semantic search

### Knowledge Graph
- **Entity Types**: Process, Task, Role, System, DataAsset, Form, Policy, Procedure, Directive, Guide
- **Relationship Types**: PRECEDES, RESPONSIBLE_FOR, TRANSFORMS_INTO, REGULATED_BY
- Versioned ontology with confidence scoring
- Human-in-the-loop review workflows

### GraphRAG Query System
- Natural language question answering
- Hybrid search (keyword + vector + semantic ranking)
- Graph traversal for contextual enrichment
- Security trimming at query time
- PII redaction in responses
- Citation tracking

### Security Features
- Microsoft Entra ID authentication (OAuth 2.0 / OIDC)
- Role-based access control (RBAC)
- Security trimming at search and graph layers
- PII detection and redaction
- Comprehensive audit logging
- Private networking support

## Project Structure

```
business-knowledge-engine/
├── backend/                 # Node.js Express API
│   ├── src/
│   │   ├── clients/        # Azure service clients
│   │   ├── middleware/     # Auth, validation, rate limiting
│   │   ├── pipelines/      # Document processing, GraphRAG
│   │   ├── services/       # Business logic services
│   │   └── utils/          # Helpers, telemetry, logging
│   └── package.json
├── frontend/               # Next.js React application
│   ├── app/               # Next.js app router pages
│   ├── components/        # React components
│   ├── lib/               # Auth, API clients, utilities
│   └── package.json
├── functions/             # Azure Functions (background processing)
│   └── package.json
├── infrastructure/        # Infrastructure as Code
│   └── terraform/
│       ├── main.tf
│       ├── variables.tf
│       └── modules/       # Reusable Terraform modules
└── docs/                  # Documentation
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/documents` | GET | List documents |
| `/api/documents` | POST | Upload document |
| `/api/documents/:id` | GET | Get document details |
| `/api/documents/:id/process` | POST | Process document |
| `/api/query` | POST | GraphRAG query |
| `/api/graph/entities` | GET | List graph entities |
| `/api/graph/relationships` | GET | List relationships |
| `/health` | GET | Health check |
| `/api-docs` | GET | Swagger documentation |

## Environment Variables

See `backend/.env.example` for the complete list. Key variables:

| Variable | Description |
|----------|-------------|
| `AZURE_AD_TENANT_ID` | Entra ID tenant |
| `AZURE_AD_CLIENT_ID` | Backend app registration |
| `AZURE_OPENAI_ENDPOINT` | OpenAI service URL |
| `AZURE_SEARCH_ENDPOINT` | AI Search service URL |
| `COSMOS_DB_ENDPOINT` | Cosmos DB URL |
| `AZURE_STORAGE_ACCOUNT_NAME` | Storage account name |

## Testing

```bash
# Backend tests
cd backend
npm test
npm run test:coverage

# Frontend tests
cd frontend
npm test
npm run test:coverage

# Linting
npm run lint
npm run lint:fix
```

## Deployment

### Azure App Service

The Terraform configuration creates App Services for both frontend and backend. Deploy using:

```bash
# Build frontend
cd frontend
npm run build

# Deploy using Azure CLI or CI/CD pipeline
az webapp deploy --resource-group <rg> --name <app-name> --src-path .
```

### CI/CD

GitHub Actions deploy workflows are included:
- `.github/workflows/deploy-frontend.yml`
- `.github/workflows/deploy-backend.yml`
- `.github/workflows/deploy-functions.yml`

To use OIDC, create a federated identity in Entra ID and add these repo secrets:
- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

Federated credential settings:
- Issuer: `https://token.actions.githubusercontent.com`
- Subject: `repo:webrlabs/business-knowledge-engine:ref:refs/heads/main`
- Audience: `api://AzureADTokenExchange`

## Security Considerations

1. **Never commit credentials** - Use `.env` files (gitignored) or Azure Key Vault
2. **Use Managed Identity** - All Azure services authenticate via DefaultAzureCredential
3. **Enable Private Endpoints** - Set `enable_private_endpoints = true` in Terraform for production
4. **Configure RBAC** - Use Entra ID app roles for authorization
5. **Enable audit logging** - Application Insights captures all security events
6. **Regular updates** - Keep dependencies updated for security patches

## Cost Optimization

For development environments, the Terraform defaults use cost-effective tiers:
- App Service: B1 (~$13/month)
- Azure AI Search: Basic (~$75/month) or Free tier for dev
- Cosmos DB: Serverless or 400 RU/s
- Azure Functions: Consumption plan (pay per execution)

Production environments should scale appropriately based on load.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is proprietary. See LICENSE file for details.

## Support

For issues and feature requests, please use the GitHub Issues tab.
