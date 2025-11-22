# Security Implementation Steps

## =4 CRITICAL - Minimum for MVP

These MUST be implemented before deploying to production:

### 1. HTTPS/SSL Setup
**Priority: CRITICAL**
**Location: nginx/reverse proxy**

- [ x] Obtain SSL certificate (Let's Encrypt recommended)
- [ x] Configure nginx to enforce HTTPS
- [ x] Redirect all HTTP traffic to HTTPS
- [ x] Enable HSTS headers

**Why**: OAuth tokens transmitted over HTTP can be intercepted. TikTok requires HTTPS for production redirects.

**Implementation**:
```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d yourdomain.com

# Auto-renewal
sudo certbot renew --dry-run
```

---

### 2. Remove Token Display from Browser
**Priority: CRITICAL**
**Location: index.js:141-231**

- [x] Remove access_token and refresh_token from HTML response
- [x] Show only success message
- [x] Store tokens server-side only

**Why**: Exposing tokens in browser HTML is a major security vulnerability. Tokens can be stolen via XSS or browser history.

**Implementation**:
```javascript
// Replace lines 141-231 with:
res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <style>
      body { font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; }
      .success { color: #4CAF50; font-size: 24px; }
    </style>
  </head>
  <body>
    <h1 class="success"> Authentication Successful!</h1>
    <p>You have been successfully authenticated with TikTok.</p>
    <p>Tokens have been securely stored on the server.</p>

    <h3>Available Endpoints:</h3>
    <ul>
      <li><a href="/creator-info">Creator Info</a></li>
      <li><a href="/user/info?fields=open_id,union_id,avatar_url,display_name">User Info</a></li>
      <li><a href="/health">Health Check</a></li>
    </ul>
  </body>
  </html>
`);
```

---

### 3. Secure Environment Variables
**Priority: CRITICAL**
**Location: .env file**

- [ ] Generate strong ENCRYPTION_KEY (32+ random characters)
- [ ] Set proper file permissions: `chmod 600 .env`
- [ ] Never commit .env to git (verify .gitignore)
- [ ] Validate all required env vars on startup

**Why**: Weak encryption keys compromise token security. Exposed secrets = compromised API access.

**Implementation**:
```javascript
// Add at top of index.js after line 11:
const REQUIRED_ENV_VARS = [
  'PORT',
  'ENCRYPTION_KEY',
  'TIKTOK_CLIENT_KEY',
  'TIKTOK_CLIENT_SECRET',
  'TIKTOK_REDIRECT_URI'
];

REQUIRED_ENV_VARS.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`L Missing required environment variable: ${varName}`);
    process.exit(1);
  }
});

// Validate ENCRYPTION_KEY strength
if (process.env.ENCRYPTION_KEY.length < 32) {
  console.error('L ENCRYPTION_KEY must be at least 32 characters');
  process.exit(1);
}

console.log(' Environment variables validated');
```

**Generate strong encryption key**:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

### 4. Add API Authentication
**Priority: CRITICAL**
**Location: All API endpoints**

- [ ] Implement API key authentication
- [ ] Protect all endpoints except /health and /auth/*
- [ ] Store API keys securely

**Why**: Currently anyone with your server URL can access user data and upload videos.

**Implementation**:
```javascript
// Add after line 18:
const API_KEYS = new Set((process.env.API_KEYS || '').split(',').filter(k => k));

// Authentication middleware
function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;

  if (!apiKey || !API_KEYS.has(apiKey)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid API key required'
    });
  }

  next();
}

// Apply to protected endpoints:
app.get('/creator-info', requireApiKey, async (req, res) => { /* ... */ });
app.get('/user/info', requireApiKey, async (req, res) => { /* ... */ });
app.post('/video/direct-post', requireApiKey, async (req, res) => { /* ... */ });
app.post('/video/upload', requireApiKey, async (req, res) => { /* ... */ });
app.get('/video/status', requireApiKey, async (req, res) => { /* ... */ });
```

Add to .env:
```bash
API_KEYS=your-secret-api-key-1,your-secret-api-key-2
```

Generate API key:
```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"
```

---

### 5. Remove/Secure Shutdown Endpoint
**Priority: CRITICAL**
**Location: index.js:543-578**

- [ ] Either remove shutdown endpoint or add authentication
- [ ] Use environment variable to enable/disable

**Why**: Anyone can currently shut down your server with a simple POST request.

**Implementation Option 1 - Remove**:
```javascript
// Delete lines 543-578 entirely
```

**Implementation Option 2 - Secure**:
```javascript
// Replace line 543 with:
app.post('/shutdown', requireApiKey, (req, res) => {
  // Only enable in development
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Shutdown disabled in production' });
  }

  // ... rest of shutdown code
});
```

---

## =� HIGH PRIORITY - Deploy Within First Week

### 6. Add Rate Limiting
**Priority: HIGH**
**Location: index.js middleware section**

- [ ] Install express-rate-limit
- [ ] Apply global rate limiting
- [ ] Apply stricter limits to auth endpoints

**Why**: Prevents brute force attacks, API abuse, and DoS attacks.

**Implementation**:
```bash
npm install express-rate-limit
```

```javascript
// Add after line 15:
const rateLimit = require('express-rate-limit');

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per windowMs
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 auth attempts per 15 minutes
  message: { error: 'Too many authentication attempts, please try again later' }
});

app.use(globalLimiter);
app.use('/auth/', authLimiter);
```

---

### 7. Fix In-Memory Code Verifier Issue
**Priority: HIGH**
**Location: index.js:21**

- [ ] Replace in-memory storage with session-based or Redis
- [ ] Properly scope verifiers to individual users

**Why**: Current implementation fails with multiple concurrent users or server restarts.

**Implementation (Session-based)**:
```bash
npm install express-session
```

```javascript
// Add after line 14:
const session = require('express-session');

app.use(session({
  secret: process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true,
    maxAge: 10 * 60 * 1000 // 10 minutes
  }
}));

// Remove line 21: let codeVerifier = null;

// Update line 80 to:
req.session.codeVerifier = pkce.verifier;

// Update line 101 to:
if (!req.session.codeVerifier) return res.status(400).send('No code verifier found');

// Update line 113 to:
code_verifier: req.session.codeVerifier

// Update line 139 to:
req.session.codeVerifier = null;
```

---

### 8. Add Security Headers
**Priority: HIGH**
**Location: index.js middleware section**

- [ ] Install helmet
- [ ] Configure security headers

**Why**: Protects against common web vulnerabilities (XSS, clickjacking, etc.)

**Implementation**:
```bash
npm install helmet
```

```javascript
// Add after line 14:
const helmet = require('helmet');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // For inline styles in HTML responses
      scriptSrc: ["'self'", "'unsafe-inline'"], // For inline scripts in HTML responses
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
```

---

### 9. Add Input Validation & Sanitization
**Priority: HIGH**
**Location: All endpoints with user input**

- [ ] Install express-validator
- [ ] Validate all query parameters and request bodies
- [ ] Sanitize file paths

**Why**: Prevents injection attacks, path traversal, and malformed requests.

**Implementation**:
```bash
npm install express-validator
```

```javascript
// Add after line 4:
const { body, query, validationResult } = require('express-validator');
const path = require('path');

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Update /user/info endpoint (line 289):
app.get('/user/info',
  requireApiKey,
  query('fields').isString().trim().notEmpty(),
  validate,
  async (req, res) => { /* ... */ }
);

// Update /video/direct-post endpoint (line 318):
app.post('/video/direct-post',
  requireApiKey,
  body('file_path').isString().trim().notEmpty(),
  body('title').isString().trim().isLength({ min: 1, max: 150 }),
  validate,
  async (req, res) => {
    const { file_path, title } = req.body;

    // Sanitize file path - prevent path traversal
    const normalizedPath = path.normalize(file_path);
    if (normalizedPath.includes('..')) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    // Continue with existing logic...
  }
);

// Similar updates for /video/upload and /video/status
```

---

### 10. Setup Process Manager (PM2)
**Priority: HIGH**
**Location: Server deployment**

- [ ] Install PM2 globally
- [ ] Create PM2 ecosystem config
- [ ] Enable auto-restart on crash
- [ ] Configure startup script

**Why**: Ensures server stays running, auto-restarts on crashes, and starts on system boot.

**Implementation**:
```bash
npm install -g pm2

# Create ecosystem.config.js
```

Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'tiktok-oauth',
    script: './index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
```

```bash
# Start with PM2
pm2 start ecosystem.config.js

# Enable startup on system boot
pm2 startup
pm2 save

# Monitor
pm2 monit
```

---

## =� MEDIUM PRIORITY - Improve Over Time

### 11. Add CORS Protection
**Priority: MEDIUM**
**Location: index.js middleware section**

- [ ] Install cors
- [ ] Configure allowed origins
- [ ] Set proper CORS headers

**Implementation**:
```bash
npm install cors
```

```javascript
// Add after line 14:
const cors = require('cors');

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));
```

Add to .env:
```bash
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

---

### 12. Add Structured Logging
**Priority: MEDIUM**
**Location: Throughout application**

- [ ] Install winston or pino
- [ ] Replace console.log with structured logger
- [ ] Log all errors, auth attempts, API calls
- [ ] Implement log rotation

**Implementation**:
```bash
npm install winston winston-daily-rotate-file
```

```javascript
// Create logger.js:
const winston = require('winston');
require('winston-daily-rotate-file');

const fileRotateTransport = new winston.transports.DailyRotateFile({
  filename: 'logs/app-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '14d',
  maxSize: '20m'
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    fileRotateTransport,
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

module.exports = logger;
```

```javascript
// In index.js, replace console.log/error with:
const logger = require('./logger');

logger.info('Server starting...');
logger.error('Error occurred', { error: err.message });
```

---

### 13. Implement Request/Response Monitoring
**Priority: MEDIUM**
**Location: index.js middleware section**

- [ ] Install morgan for HTTP logging
- [ ] Track response times
- [ ] Monitor error rates

**Implementation**:
```bash
npm install morgan
```

```javascript
// Add after line 14:
const morgan = require('morgan');

// Custom token for API key presence (don't log actual key)
morgan.token('has-api-key', (req) => req.headers['x-api-key'] ? 'yes' : 'no');

app.use(morgan(':method :url :status :response-time ms - API-Key: :has-api-key'));
```

---

### 14. Add Health Check Enhancements
**Priority: MEDIUM**
**Location: index.js:46-52**

- [ ] Check token storage availability
- [ ] Check disk space
- [ ] Add version info

**Implementation**:
```javascript
// Replace lines 46-52:
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    node_version: process.version,
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB',
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB'
    }
  };

  // Check token storage
  try {
    const tokens = tokenStorage.loadTokens();
    health.auth_status = tokens ? 'authenticated' : 'not_authenticated';
  } catch (err) {
    health.auth_status = 'error';
    health.status = 'degraded';
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});
```

---

### 15. Add Database for Token Storage (Optional)
**Priority: MEDIUM**
**Location: Replace tokenStorage.js**

- [ ] Setup PostgreSQL or MongoDB
- [ ] Migrate from file-based to DB storage
- [ ] Support multiple users

**Why**: File-based storage doesn't scale well for multiple users.

**Implementation**: (Depends on your scaling needs - skip for single-user MVP)

---

## =� NICE TO HAVE - Future Enhancements

### 16. Add Webhook Verification
**Priority: LOW**
**Location: New endpoint**

- [ ] Create webhook endpoint for TikTok notifications
- [ ] Verify webhook signatures
- [ ] Handle video status updates

---

### 17. Implement Request Body Size Limits
**Priority: LOW**
**Location: index.js middleware section**

- [ ] Limit JSON body size
- [ ] Prevent memory exhaustion attacks

**Implementation**:
```javascript
// Update line 14:
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
```

---

### 18. Add API Documentation
**Priority: LOW**
**Location: New /docs endpoint**

- [ ] Install swagger-ui-express
- [ ] Document all endpoints
- [ ] Add OpenAPI spec

---

### 19. Implement Graceful Shutdown
**Priority: LOW**
**Location: Server startup section**

- [ ] Handle SIGTERM/SIGINT
- [ ] Close connections gracefully
- [ ] Complete in-flight requests

**Implementation**:
```javascript
// Add at end of file:
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
  console.log('Received shutdown signal, closing server...');

  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

// Update line 583 to:
const server = app.listen(PORT, () => {
  console.log(`=� TikTok OAuth2 Server running at http://localhost:${PORT}`);
  // ...
});
```

---

### 20. Add Automated Backups
**Priority: LOW**
**Location: External cron job**

- [ ] Backup token storage regularly
- [ ] Backup logs
- [ ] Test restore process

---

## =� MVP Deployment Checklist

Before going live, ensure you've completed:

- [x] Items 1-5 (CRITICAL section)
- [ ] Items 6-10 (HIGH PRIORITY recommended)
- [ ] Setup firewall (allow only 22, 80, 443)
- [ ] Configure nginx reverse proxy
- [ ] Test OAuth flow end-to-end
- [ ] Test all API endpoints with authentication
- [ ] Monitor logs for errors
- [ ] Set up basic monitoring/alerts

---

## =� Quick Start Implementation Order

**Day 1: Critical Security**
1. Setup HTTPS/SSL (Item 1)
2. Remove token display (Item 2)
3. Secure environment variables (Item 3)

**Day 2: Authentication & Access Control**
4. Add API authentication (Item 4)
5. Remove shutdown endpoint (Item 5)

**Day 3: Hardening**
6. Add rate limiting (Item 6)
7. Fix code verifier storage (Item 7)
8. Add security headers (Item 8)

**Day 4: Validation & Deployment**
9. Add input validation (Item 9)
10. Setup PM2 (Item 10)
11. Deploy and test

**Week 2+: Improvements**
- Implement items 11-15 based on needs

---

## =� Notes

- All code examples assume they're being added to `index.js`
- Test each change in development before deploying to production
- Keep this document updated as you implement features
- Review security regularly - security is an ongoing process, not one-time setup
