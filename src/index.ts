import express, { Request, Response } from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8888;

// Middleware
app.use(express.json());

// Hello World endpoint
app.get('/hello', (req: Request, res: Response) => {
  res.json({
    message: 'Hello World!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime()
  });
});

// Root
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'TikTok OAuth2 Server',
    version: '2.0.0',
    status: 'online'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📍 Hello World: http://localhost:${PORT}/hello`);
});
