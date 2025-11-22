"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// Middleware
app.use(express_1.default.json());
// Hello World endpoint
app.get('/hello', (req, res) => {
    res.json({
        message: 'Hello World!',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});
// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime()
    });
});
// Root
app.get('/', (req, res) => {
    res.json({
        name: 'TikTok OAuth2 Server (TypeScript)',
        version: '2.0.0',
        endpoints: {
            hello: '/hello',
            health: '/health'
        }
    });
});
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📍 Hello World: http://localhost:${PORT}/hello`);
});
