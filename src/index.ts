import express, { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import axios from 'axios';
import qs from 'querystring';
import crypto from 'crypto';
import fs from 'fs';
import SecureTokenStorage, { TokenData } from './tokenStorage';

dotenv.config();

// Extend session data type
declare module 'express-session' {
  interface SessionData {
    codeVerifier: string;
  }
}

const app = express();
const PORT = Number(process.env.PORT) || 7777;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware for PKCE code verifier storage
app.use(session({
  secret: process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY || 'fallback-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true,
    maxAge: 10 * 60 * 1000 // 10 minutes - enough time to complete OAuth flow
  }
}));

// Security: Enable HSTS (HTTP Strict Transport Security)
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains; preload'
  );
  next();
});

// ===== Rate Limiting =====

// Global rate limiter - 100 requests per 15 minutes
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
});

// Strict limiter for auth endpoints - 5 attempts per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 auth attempts per windowMs
  message: { error: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply global rate limiter to all routes
app.use(globalLimiter);

// ===== API Authentication =====

// Parse API keys from environment variable (comma-separated)
const API_KEYS = new Set((process.env.API_KEYS || '').split(',').filter(k => k.trim()));

// API key authentication middleware
function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string || req.query.api_key as string;

  if (!apiKey || !API_KEYS.has(apiKey)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid API key required. Include X-API-Key header or api_key query parameter.'
    });
  }

  next();
}

// Initialize secure storage with encryption key from environment
const tokenStorage = new SecureTokenStorage(process.env.ENCRYPTION_KEY);

// ===== PKCE Utility Functions =====

// Generate random string for code verifier (TikTok's official method)
function generateRandomString(length: number): string {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

// Generate PKCE code verifier and challenge (TikTok's official method)
function generatePKCE(): { verifier: string; challenge: string } {
  // Generate random code verifier (43-128 characters as per TikTok docs)
  const verifier = generateRandomString(64); // Using 64 characters for good entropy

  // Generate code challenge using SHA256 with hex encoding (TikTok's method)
  const challenge = crypto.createHash('sha256').update(verifier).digest('hex');

  return { verifier, challenge };
}

// ===== Token Management =====

// Auto-refresh access token if expired
async function getValidAccessToken(): Promise<string> {
  const tokens = tokenStorage.loadTokens();
  if (!tokens) {
    throw new Error(`No tokens available. Please complete OAuth flow first. Visit http://localhost:${PORT}/auth/login`);
  }

  // If token is still valid (with 60 second buffer), return it
  if (Date.now() < tokens.expires_at - 60 * 1000) {
    return tokens.access_token;
  }

  // Token expired, refresh it
  console.log('🔄 Refreshing TikTok access token...');
  const refreshRes = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', {
    client_key: process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  });

  const { access_token, refresh_token, expires_in } = refreshRes.data;

  // Save new tokens
  tokenStorage.saveTokens({
    access_token,
    refresh_token,
    expires_at: Date.now() + expires_in * 1000
  });

  return access_token;
}

// ===== Basic Endpoints =====

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Root endpoint with basic info
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'TikTok OAuth2 Server',
    version: '2.0.0',
    status: 'running',
    endpoints: {
      auth: '/auth/login',
      callback: '/auth/callback',
      logout: '/auth/logout',
      creator_info: '/creator-info',
      user_info: '/user/info',
      video_direct_post: '/video/direct-post',
      video_upload: '/video/upload',
      video_status: '/video/status?publish_id=YOUR_PUBLISH_ID',
      health: '/health'
    }
  });
});

// ===== OAuth Flow Endpoints =====

// 1. Redirect user to TikTok auth page with PKCE
app.get('/auth/login', authLimiter, (req: Request, res: Response) => {
  // Generate PKCE code verifier and challenge
  const pkce = generatePKCE();
  req.session.codeVerifier = pkce.verifier; // Store in session for later use in callback

  const params = {
    client_key: process.env.TIKTOK_CLIENT_KEY!,
    redirect_uri: process.env.TIKTOK_REDIRECT_URI!,
    response_type: 'code',
    scope: 'user.info.basic,video.publish,video.upload',
    state: 'secureRandomState123', // optional
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256'
  };

  const authUrl = `https://www.tiktok.com/v2/auth/authorize/?${qs.stringify(params)}`;
  res.redirect(authUrl);
});

// 2. Callback endpoint to handle TikTok redirect with PKCE
app.get('/auth/callback', authLimiter, async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) {
    return res.status(400).send('Missing code');
  }

  if (!req.session.codeVerifier) {
    return res.status(400).send('No code verifier found. Session may have expired.');
  }

  try {
    const requestData = new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.TIKTOK_REDIRECT_URI!,
      code_verifier: req.session.codeVerifier
    });

    const tokenRes = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', requestData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    });

    if (tokenRes.data.error) {
      return res.status(400).send(`Error: ${tokenRes.data.error}, Description: ${tokenRes.data.error_description}`);
    }
    if (!tokenRes.data.access_token) {
      return res.status(400).send('Access token not received');
    }

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    // Save tokens securely (server-side only)
    tokenStorage.saveTokens({
      access_token,
      refresh_token,
      expires_at: Date.now() + expires_in * 1000
    });

    // Clear code verifier from session after successful token exchange
    req.session.codeVerifier = undefined as any;

    // SECURITY FIX: Do NOT display tokens in browser
    // Only show success message and available endpoints
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; }
          .success { color: #4CAF50; font-size: 24px; }
          h1 { color: #333; }
          h3 { color: #555; margin-top: 30px; }
          ul { line-height: 1.8; }
          a { color: #4CAF50; text-decoration: none; }
          a:hover { text-decoration: underline; }
          .info-box {
            background: #f0f8ff;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
            border-left: 4px solid #4CAF50;
          }
        </style>
      </head>
      <body>
        <h1 class="success">✅ Authentication Successful!</h1>
        <div class="info-box">
          <p><strong>You have been successfully authenticated with TikTok.</strong></p>
          <p>Tokens have been securely stored on the server and are encrypted.</p>
          <p>Your session will expire in ${Math.floor(expires_in / 3600)} hours.</p>
        </div>

        <h3>Available Endpoints:</h3>
        <ul>
          <li><a href="/creator-info">Creator Info</a> - Get your TikTok profile info</li>
          <li><a href="/user/info?fields=open_id,union_id,avatar_url,display_name">User Info</a> - Get your TikTok user info</li>
          <li><a href="/health">Health Check</a> - Server status</li>
        </ul>

        <h3>API Usage Examples:</h3>
        <pre>
POST /video/direct-post
{
  "file_path": "/path/to/video.mp4",
  "title": "Your video title"
}

GET /video/status?publish_id=YOUR_PUBLISH_ID
        </pre>
      </body>
      </html>
    `);
  } catch (err: any) {
    console.error('❌ Token exchange error:', err.response?.data || err.message);
    res.status(500).send('Token exchange failed');
  }
});

// 3. Logout endpoint - clears stored tokens
app.get('/auth/logout', (req: Request, res: Response) => {
  const tokensCleared = tokenStorage.clearTokens();

  if (tokensCleared) {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; }
          .success { color: #4CAF50; font-size: 24px; }
          h1 { color: #333; }
          .info-box {
            background: #f0f8ff;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
            border-left: 4px solid #4CAF50;
          }
          a { color: #4CAF50; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <h1 class="success">✅ Logged Out Successfully!</h1>
        <div class="info-box">
          <p>Your authentication tokens have been cleared from the server.</p>
          <p>You are now logged out of TikTok.</p>
        </div>
        <p><a href="/auth/login">Click here to login again</a></p>
      </body>
      </html>
    `);
    console.log('🔓 User logged out - tokens cleared');
  } else {
    res.status(500).send('Failed to clear tokens');
  }
});

// ===== TikTok API Endpoints =====

// Get creator info
app.get('/creator-info', requireApiKey, async (req: Request, res: Response) => {
  try {
    const access_token = await getValidAccessToken();

    const profile = await axios.post('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {}, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
    });

    res.json(profile.data);
  } catch (err: any) {
    console.error('❌ Creator info error:', err.response?.data || err.message);
    res.status(500).send('API call failed');
  }
});

// Get user info - accepts fields from client and forwards to TikTok
app.get('/user/info', requireApiKey, async (req: Request, res: Response) => {
  try {
    const access_token = await getValidAccessToken();
    const { fields } = req.query;

    if (!fields) {
      return res.status(400).json({
        error: 'fields query parameter is required',
        example: 'GET /user/info?fields=open_id,union_id,avatar_url'
      });
    }

    const userInfoResponse = await axios.get(`https://open.tiktokapis.com/v2/user/info/?fields=${fields}`, {
      headers: {
        'Authorization': `Bearer ${access_token}`,
      }
    });

    res.json(userInfoResponse.data);
  } catch (err: any) {
    console.error('❌ User info error:', err.response?.data || err.message);
    res.status(500).json({
      error: 'User info request failed',
      details: err.response?.data || err.message
    });
  }
});

// Video upload API - direct post with file path and title
app.post('/video/direct-post', requireApiKey, async (req: Request, res: Response) => {
  try {
    const access_token = await getValidAccessToken();
    const { file_path, title } = req.body;

    if (!file_path) {
      return res.status(400).json({ error: 'file_path is required' });
    }

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    // Check if file_path is a URL or local path
    const isUrl = file_path.startsWith('http://') || file_path.startsWith('https://');
    let videoBuffer: Buffer;
    let fileSize: number;

    if (isUrl) {
      // Download file from URL
      console.log('📥 Downloading video from URL:', file_path);
      const videoResponse = await axios.get(file_path, {
        responseType: 'arraybuffer',
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      videoBuffer = Buffer.from(videoResponse.data);
      fileSize = videoBuffer.length;
      console.log('✅ Video downloaded, size:', fileSize, 'bytes');
    } else {
      // Read from local file path
      if (!fs.existsSync(file_path)) {
        return res.status(400).json({ error: 'File not found at specified path' });
      }
      const stats = fs.statSync(file_path);
      fileSize = stats.size;
      videoBuffer = fs.readFileSync(file_path);
    }

    const chunkSize = (fileSize < 10 * 1024 * 1024) ? fileSize : 10 * 1024 * 1024; // 10MB chunks
    const totalChunkCount = Math.ceil(fileSize / chunkSize);

    // Step 1: Initialize video upload
    console.log('📤 Initializing video upload...');
    const initResponse = await axios.post('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      post_info: {
        title: title,
        privacy_level: process.env.PRIVACY_LEVEL || 'SELF_ONLY',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: fileSize,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount
      }
    }, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      }
    });

    if (initResponse.data.error && initResponse.data.error.code !== 'ok') {
      throw new Error(`TikTok API Error: ${initResponse.data.error.message}`);
    }

    const { publish_id, upload_url } = initResponse.data.data;
    console.log('✅ Upload initialized:', { publish_id, upload_url });

    // Step 2: Upload video file to TikTok's designated URL
    console.log('📤 Uploading video file to TikTok...');

    await axios.put(upload_url, videoBuffer, {
      headers: {
        'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`,
        'Content-Type': 'video/mp4',
        'Content-Length': fileSize
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    console.log(`✅ Video upload requested. Check status at http://localhost:${PORT}/video/status?publish_id=${publish_id}`);

    // Return success response with publish_id
    res.json({
      success: true,
      message: 'Video upload requested successfully',
      data: {
        publish_id: publish_id,
        status_url: `http://localhost:${PORT}/video/status?publish_id=${publish_id}`,
        file_info: {
          path: file_path,
          size: fileSize,
          size_mb: (fileSize / 1024 / 1024).toFixed(2)
        }
      }
    });

  } catch (err: any) {
    console.error('❌ Video upload error:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Video upload failed',
      details: err.response?.data || err.message
    });
  }
});

// Check video upload status
app.get('/video/status', requireApiKey, async (req: Request, res: Response) => {
  try {
    const access_token = await getValidAccessToken();
    const { publish_id } = req.query;

    if (!publish_id) {
      return res.status(400).json({ error: 'publish_id query parameter is required' });
    }

    const statusResponse = await axios.post('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      publish_id: publish_id
    }, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      }
    });

    res.json(statusResponse.data);

  } catch (err: any) {
    console.error('❌ Status check error:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Status check failed',
      details: err.response?.data || err.message
    });
  }
});

// Video upload to inbox API - uploads to TikTok inbox for user to complete
app.post('/video/upload', requireApiKey, async (req: Request, res: Response) => {
  try {
    const access_token = await getValidAccessToken();
    const { file_path } = req.body;

    if (!file_path) {
      return res.status(400).json({ error: 'file_path is required' });
    }

    // Check if file_path is a URL or local path
    const isUrl = file_path.startsWith('http://') || file_path.startsWith('https://');
    let videoBuffer: Buffer;
    let fileSize: number;

    if (isUrl) {
      // Download file from URL
      console.log('📥 Downloading video from URL:', file_path);
      const videoResponse = await axios.get(file_path, {
        responseType: 'arraybuffer',
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      videoBuffer = Buffer.from(videoResponse.data);
      fileSize = videoBuffer.length;
      console.log('✅ Video downloaded, size:', fileSize, 'bytes');
    } else {
      // Read from local file path
      if (!fs.existsSync(file_path)) {
        return res.status(400).json({ error: 'File not found at specified path' });
      }
      const stats = fs.statSync(file_path);
      fileSize = stats.size;
      videoBuffer = fs.readFileSync(file_path);
    }

    const chunkSize = (fileSize < 10 * 1024 * 1024) ? fileSize : 10 * 1024 * 1024; // 10MB chunks
    const totalChunkCount = Math.ceil(fileSize / chunkSize);

    console.log('📤 Starting video upload to inbox...');
    console.log('📁 File info:', { source: isUrl ? 'URL' : 'local', size: fileSize, size_mb: (fileSize / 1024 / 1024).toFixed(2) });

    // Step 1: Initialize video upload
    console.log('📤 Step 1: Initializing video upload...');
    const initResponse = await axios.post('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: fileSize,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount
      }
    }, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      }
    });

    if (initResponse.data.error && initResponse.data.error.code !== 'ok') {
      throw new Error(`TikTok API Error: ${initResponse.data.error.message}`);
    }

    const { publish_id, upload_url } = initResponse.data.data;
    console.log('✅ Upload initialized:', { publish_id, upload_url });

    // Step 2: Upload video file to TikTok's designated URL
    console.log('📤 Step 2: Uploading video file to TikTok...');

    await axios.put(upload_url, videoBuffer, {
      headers: {
        'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`,
        'Content-Type': 'video/mp4',
        'Content-Length': fileSize
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    console.log('✅ Video uploaded to inbox successfully');

    // Return success response with publish_id
    res.json({
      success: true,
      message: 'Video uploaded to TikTok inbox successfully. User must complete editing flow in TikTok app.',
      data: {
        publish_id: publish_id,
        file_info: {
          path: file_path,
          size: fileSize,
          size_mb: (fileSize / 1024 / 1024).toFixed(2)
        },
        note: 'Video is now in TikTok inbox. User must click on inbox notifications to continue the editing flow in TikTok and complete the post.'
      }
    });

  } catch (err: any) {
    console.error('❌ Video upload error:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Video upload failed',
      details: err.response?.data || err.message
    });
  }
});

// ===== Server Startup =====

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 TikTok OAuth2 Server running at http://localhost:${PORT}`);
  console.log(`📍 VM: http://38.242.141.70:${PORT}`);
  console.log(`📖 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 Perform OAuth flow: http://localhost:${PORT}/auth/login`);
});
