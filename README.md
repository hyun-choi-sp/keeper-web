# Keeper Connection Manager (Web)

Single Next.js app (UI + API routes) for provisioning Keeper connections and user access from DynamoDB.

## Requirements
- Node.js 18+
- AWS credentials configured locally (for DynamoDB/Secrets Manager access)

## Setup
1) Create `.env` in the project root (example):
```
KEEPER_USERNAME=hyun.choi
KEEPER_API_URL=https://poc-access.sailpoint.com
TARGET_NAME=company20257-poc
ENVIRONMENT=production
```

2) Install dependencies:
```
cd web
npm install
```

## Run locally
```
cd web
npm run dev
```

Open `http://localhost:3000`.

## Notes
- Keeper login credentials are entered in the UI and stored in memory for the session.
- `NEXT_PUBLIC_API_BASE` is optional (defaults to same origin).
