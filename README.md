# VifeMS Backend

Backend API and core engine powering **VifeMS**, an AI-native platform that transforms a business owner's description into a customized business management workspace.

## Overview

VifeMS allows small business owners to describe how their business operates in natural language.

The platform uses AI to understand that description and generate a structured workspace containing the entities, fields, relationships, and operational tools required to manage the business.

The backend is responsible for powering this process and providing the APIs required by the VifeMS web application.

### Core Flow

```text
Business Description
        ↓
      VifeAI
        ↓
  Workspace Blueprint
        ↓
 Blueprint Validation
        ↓
Workspace Provisioning
        ↓
 Dynamic Business Workspace
```

## Responsibilities

The VifeMS backend will handle:

* Authentication and user management
* Workspace creation and management
* AI-powered business analysis
* Workspace blueprint generation and validation
* Dynamic entity and schema management
* Business record CRUD operations
* Workspace provisioning
* Workspace settings
* Integration with Rumpty Cloud services
* API validation and error handling

## Technology

| Technology   | Purpose                             |
| ------------ | ----------------------------------- |
| Node.js      | Backend runtime                     |
| Express      | HTTP API framework                  |
| JavaScript   | Application language                |
| Prisma       | Database ORM                        |
| PostgreSQL   | Primary database                    |
| Rumpty Cloud | Cloud infrastructure and deployment |
| VifeAI       | AI-powered workspace generation     |

> Technologies will be added to the implementation as the corresponding functionality is introduced.

## Project Structure

```text
vifems-backend/
│
├── src/
│   └── server.js
│
├── .env
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
└── README.md
```

The project structure will evolve as new backend modules are introduced. Features should remain separated by responsibility to keep the codebase maintainable.

## Getting Started

### Prerequisites

Make sure you have installed:

* Node.js
* npm
* Git

### Installation

Clone the repository:

```bash
git clone https://github.com/Viktor-Kode/vifems-web-backtend.git
cd vifems-backend
```

Install dependencies:

```bash
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
PORT=5000
```

Additional environment variables will be documented here as integrations are added.

### Development

Start the development server:

```bash
npm run dev
```

The API will run at:

```text
http://localhost:5000
```

### Health Check

The backend exposes a basic health endpoint:

```http
GET /api/health
```

Expected response:

```json
{
  "success": true,
  "message": "VifeMS backend is running"
}
```

## API Documentation

API documentation will be maintained as backend functionality is implemented.

Planned API areas include:

```text
/api/auth
/api/users
/api/workspaces
/api/blueprints
/api/entities
/api/records
/api/ai
```

Detailed endpoint documentation will be added as each module becomes available.

## Architecture

VifeMS follows a modular backend architecture.

The intended request flow is:

```text
Client
  ↓
Express Route
  ↓
Controller
  ↓
Service
  ↓
Data / External Provider
  ↓
Database or Cloud Service
```

AI-generated data follows an additional validation layer:

```text
Business Description
        ↓
AI Provider
        ↓
JSON Blueprint
        ↓
Blueprint Validation
        ↓
Provisioning Engine
        ↓
Workspace
```

The AI layer does **not** directly modify the database.

AI output must first be validated and converted into an accepted VifeMS blueprint before provisioning occurs.

## Development Principles

VifeMS is being developed with the following principles:

### 1. Maintainability

Features should be modular and separated by responsibility.

### 2. Validation

External input, including AI-generated data, must be validated before it reaches business logic or persistence layers.

### 3. Security

Secrets and credentials must never be committed to the repository.

Environment variables should be used for sensitive configuration.

### 4. No Hidden Business Logic

Important business rules should live in clearly identifiable services rather than being scattered throughout controllers and routes.

### 5. Documentation

Major architectural decisions, API behavior, data models, and important workflows should be documented alongside implementation.

## Deployment

VifeMS is intended to run on **Rumpty Cloud** as required by the DevCenter Hacktober Sprint.

Deployment configuration and production instructions will be documented once the production infrastructure is established.

## Hackathon Context

**Event:** DevCenter Hacktober Sprint

**Project:** VifeMS Engine

VifeMS is designed around three core objectives:

1. **Platform Deployment** — the application must be hosted live and fully functional on Rumpty Cloud.
2. **Code Quality & Technical Documentation** — the codebase must remain clean, maintainable, and comprehensively documented.
3. **Innovation & Practical Utility** — the platform should use AI to solve a real business-management problem in a practical and demonstrable way.

## Status

**Current stage:** Backend foundation

Implemented:

* Express server
* CORS configuration
* Environment configuration
* JSON request parsing
* Health check endpoint

Planned:

* Authentication
* Rumpty Cloud database integration
* Workspace model
* AI business analysis
* Blueprint generation
* Blueprint validation
* Workspace provisioning
* Dynamic entities
* Dynamic records and CRUD
* Workspace settings
* Production deployment

## License

License information will be added when the project's distribution terms are finalized.
