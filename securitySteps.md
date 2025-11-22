# Security Implementation Steps

## =4 CRITICAL - Minimum for MVP

These MUST be implemented before deploying to production:

### 1. HTTPS/SSL Setup
**Priority: CRITICAL**
**Location: nginx/reverse proxy**

- [x] Obtain SSL certificate (Let's Encrypt recommended)
- [x] Configure nginx to enforce HTTPS
- [x] Redirect all HTTP traffic to HTTPS
- [x] Enable HSTS headers

**Why**: OAuth tokens transmitted over HTTP can be intercepted. TikTok requires HTTPS for production redirects.
 

---

### 2. Remove Token Display from Browser
**Priority: CRITICAL**
**Location: index.js:141-231**

- [x] Remove access_token and refresh_token from HTML response
- [x] Show only success message
- [x] Store tokens server-side only

**Why**: Exposing tokens in browser HTML is a major security vulnerability. Tokens can be stolen via XSS or browser history.
 
---

### 3. Secure Environment Variables
**Priority: CRITICAL**
**Location: .env file**

- [ ] Generate strong ENCRYPTION_KEY (32+ random characters)
- [ ] Set proper file permissions: `chmod 600 .env`
- [ ] Never commit .env to git (verify .gitignore)
- [ ] Validate all required env vars on startup

**Why**: Weak encryption keys compromise token security. Exposed secrets = compromised API access.
 

### 4. Add API Authentication
**Priority: CRITICAL**
**Location: All API endpoints**

- [x] Implement API key authentication
- [x] Protect all endpoints except /health and /auth/*
- [x] Store API keys securely

**Why**: Currently anyone with your server URL can access user data and upload videos.
 

---

### 7. Fix In-Memory Code Verifier Issue
**Priority: HIGH**
**Location: index.js:21**

- [x] Replace in-memory storage with session-based or Redis
- [x] Properly scope verifiers to individual users

**Why**: Current implementation fails with multiple concurrent users or server restarts.
 
---

### 8. Add Security Headers
**Priority: HIGH**
**Location: index.js middleware section**

- [ ] Install helmet
- [ ] Configure security headers

**Why**: Protects against common web vulnerabilities (XSS, clickjacking, etc.)
 

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
