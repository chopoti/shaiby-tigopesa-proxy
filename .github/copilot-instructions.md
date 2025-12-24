# Copilot Instructions for Shaiby-Tigopesa Proxy

## Project Overview
This is a Node.js/Express proxy service that relays bill payment requests to the Tigo payment gateway (Tanzania). It acts as an intermediary between a client (Shaiby Transporter) and the Tigo `ShabibyTransporter2DM` API, handling authentication and request/response translation.

## Architecture

### Core Flow
1. **Token Acquisition** (`getAccessToken()`) - Exchanges hardcoded credentials for OAuth bearer tokens from Tigo
2. **Request Relay** (`/relay/push-billpay` endpoint) - Receives client payment requests, adds token, forwards to Tigo's `PushBillPay` endpoint
3. **Callback Handling** (`/MixByYasPushCallback` and `/prod/MixByYasPushCallback`) - Receives async callbacks from Tigo, returns success acknowledgment

### Key Components
- `server.js` - Single file containing all Express routes and Tigo API integration
- `package.json` - Minimal dependencies: express, axios, qs only
- `Dockerfile` - Node 20 Alpine-style image with standard Express port (3000)

## Critical Patterns

### HTTPS Configuration
- Uses custom `https.Agent` with `rejectUnauthorized: false` to accept Tigo's self-signed certificates
- **This is intentional and required** - Tigo's production endpoint uses non-standard SSL setup
- Must be preserved in all code paths making HTTPS calls

### Authentication Approach
- Credentials stored as environment variables (`TIGO_USERNAME`, `TIGO_PASSWORD`)
- Token is requested on startup and automatically refreshed **every 1 hour**
- Cached token is used for all requests within the 1-hour window
- Service requests a fresh token immediately after startup, then every 60 minutes
- No manual restart needed — automatic refresh runs in background
- Tigo returns `access_token` in `response.data.access_token`

### Error Handling Strategy
- Uses try-catch per route handler
- Returns standardized error object: `{ ResponseStatus: false, ResponseCode: "BILLER-18-9999-F", ResponseDescription, Error }`
- Logs both request and response objects (including raw Tigo responses) for debugging

### Request/Response Patterns
- All endpoints use `res.json()` with explicit status codes
- Callback routes acknowledge with `ResponseCode: "BILLER-18-0000-S"` (Tigo expects this exact format)
- Currency/payment details are in `req.body` (passed through without transformation to Tigo)

## Development Workflow

### Environment Variables
All configuration is managed through environment variables. Copy `.env.example` to `.env` and customize:

```bash
# Server settings
SERVER_PORT=3000
SERVER_HOST=0.0.0.0
NODE_ENV=production

# Tigo API (can be overridden for staging/testing)
TIGO_BASE_URL=https://sal-accessgwr1.tigo.co.tz:8443
TIGO_USERNAME=ShabibyTransporterLtd
TIGO_PASSWORD=saRBJCe
TIGO_REQUEST_TIMEOUT=15000

# Token caching
TOKEN_EXPIRY_HOURS=24

# Health check configuration
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_INTERVAL=60000  # milliseconds, default 60 seconds

# Internal service to receive callbacks
INTERNAL_SERVICE_URL=http://your-internal-service:5000
INTERNAL_CALLBACK_ENDPOINT=/api/payment-callback
INTERNAL_SERVICE_TIMEOUT=15000
```

### Health Check Configuration
The service automatically performs **health checks** to monitor Tigo API availability using DNS resolution + TCP connection tests. Health status is tracked internally and logged:

**How It Works:**
- Extracts hostname and port from `TIGO_BASE_URL`
- Performs DNS resolution to verify the host is reachable
- Attempts TCP connection to the port (typically 443 for HTTPS)
- Runs every 60 seconds by default, logs results to stdout
- Tracks: response time, consecutive failures, last check timestamp
- Does NOT expose HTTP endpoints — purely background monitoring

**Configuration:**
```bash
HEALTH_CHECK_ENABLED=true          # Enable/disable automatic checks (default: true)
HEALTH_CHECK_INTERVAL=60000        # Check frequency in milliseconds (default: 60 seconds)
```

**Example logs:**
```
[HEALTH] Starting health checks every 60000ms
[HEALTH] Checking sal-accessgwr1.tigo.co.tz:443...
[HEALTH] Tigo host sal-accessgwr1.tigo.co.tz:443 is UP (245ms)
```

### Running Locally
```bash
npm install
# Configure .env (optional - uses defaults from .env.example)
npm start  # Starts on configured SERVER_HOST:SERVER_PORT
```

### Testing
- No test framework configured - currently test via external HTTP client
- Log all Tigo requests/responses to `console.log()` for verification
- Mock Tigo responses by modifying `axios.post()` calls

### Deployment
- `npm start` runs the Express server on port 3000
- Docker build: `docker build -t shaiby-tigopesa-proxy .`
- Container expects port 3000 exposed and `0.0.0.0` binding (enables external access)

## When Modifying This Project

### Do's
- Preserve the `rejectUnauthorized: false` in httpsAgent - Tigo requires this
- Keep callback routes returning `ResponseCode: "BILLER-18-0000-S"` exactly
- Add console.log statements when changing API calls - this is how errors are debugged
- Test with actual Tigo credentials in staging before touching the token endpoint

### Don'ts
- Don't add credential rotation or token caching without consulting Tigo API docs first
- Don't modify the callback response format - Tigo's webhook expects specific fields
- Don't remove the `Content-Type: application/x-www-form-urlencoded` from token request (Tigo requires this)
- Don't refactor into multiple files without documenting the new module boundaries

## Key File Locations
- Main service: `server.js` (118 lines - entire proxy logic)
- Dependencies: `package.json` (express, axios, qs)
- Container config: `Dockerfile`
