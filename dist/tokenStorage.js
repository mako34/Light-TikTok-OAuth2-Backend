"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
class SecureTokenStorage {
    constructor(encryptionKey, filePath = './tokens.encrypted.json') {
        this.filePath = filePath;
        // Generate or use provided key
        const providedKey = encryptionKey || this.generateEncryptionKey();
        // Ensure the encryption key is exactly 32 bytes (64 hex chars) for AES-256
        if (providedKey.length < 64) {
            // Derive a proper 32-byte key using scrypt
            this.encryptionKey = crypto_1.default.scryptSync(providedKey, 'salt', 32).toString('hex');
        }
        else {
            this.encryptionKey = providedKey;
        }
    }
    // Generate a random encryption key if none provided
    generateEncryptionKey() {
        return crypto_1.default.randomBytes(32).toString('hex');
    }
    // Encrypt data
    encrypt(data) {
        const iv = crypto_1.default.randomBytes(16);
        // Use first 32 bytes of key for AES-256
        const key = Buffer.from(this.encryptionKey.slice(0, 64), 'hex');
        const cipher = crypto_1.default.createCipheriv('aes-256-cbc', key, iv);
        let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return {
            iv: iv.toString('hex'),
            encrypted: encrypted
        };
    }
    // Decrypt data
    decrypt(encryptedData) {
        try {
            const iv = Buffer.from(encryptedData.iv, 'hex');
            // Use first 32 bytes of key for AES-256
            const key = Buffer.from(this.encryptionKey.slice(0, 64), 'hex');
            const decipher = crypto_1.default.createDecipheriv('aes-256-cbc', key, iv);
            let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return JSON.parse(decrypted);
        }
        catch (error) {
            console.error('Decryption failed:', error.message);
            return null;
        }
    }
    // Save tokens to encrypted file
    saveTokens(tokens) {
        try {
            const encrypted = this.encrypt(tokens);
            fs_1.default.writeFileSync(this.filePath, JSON.stringify(encrypted));
            console.log('✅ Tokens saved securely');
            return true;
        }
        catch (error) {
            console.error('❌ Failed to save tokens:', error.message);
            return false;
        }
    }
    // Load tokens from encrypted file
    loadTokens() {
        try {
            if (!fs_1.default.existsSync(this.filePath)) {
                console.log('ℹ️  No existing tokens found');
                return null;
            }
            const encryptedData = JSON.parse(fs_1.default.readFileSync(this.filePath, 'utf8'));
            const tokens = this.decrypt(encryptedData);
            if (tokens) {
                console.log('✅ Tokens loaded successfully');
                return tokens;
            }
            else {
                console.log('❌ Failed to decrypt tokens');
                return null;
            }
        }
        catch (error) {
            console.error('❌ Failed to load tokens:', error.message);
            return null;
        }
    }
    // Clear stored tokens
    clearTokens() {
        try {
            if (fs_1.default.existsSync(this.filePath)) {
                fs_1.default.unlinkSync(this.filePath);
                console.log('✅ Tokens cleared');
            }
            return true;
        }
        catch (error) {
            console.error('❌ Failed to clear tokens:', error.message);
            return false;
        }
    }
    // Check if tokens exist and are valid
    hasValidTokens() {
        const tokens = this.loadTokens();
        if (!tokens || !tokens.access_token) {
            return false;
        }
        // Check if token is expired (with 5 minute buffer)
        const bufferTime = 5 * 60 * 1000; // 5 minutes
        return Date.now() < (tokens.expires_at - bufferTime);
    }
}
exports.default = SecureTokenStorage;
