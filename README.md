# Keeper Connection Manager (Web)

Express + Next.js web UI for provisioning Keeper connections and user access from DynamoDB.

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
cd server
npm install

cd ../web
npm install
```

## Run locally
```
cd server
npm run dev
```

In another terminal:
```
cd web
npm run dev
```

Open `http://localhost:3000`.

## Notes
- Keeper login credentials are entered in the UI and stored in memory for the session.
- `WEB_ORIGIN` (server) defaults to `http://localhost:3000`.
- `NEXT_PUBLIC_API_BASE` (web) defaults to `http://localhost:4000`.
