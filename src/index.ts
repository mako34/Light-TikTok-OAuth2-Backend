import express, { Request, Response } from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 8888;

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`📍 VM: http://38.242.141.70:${PORT}`);
});
