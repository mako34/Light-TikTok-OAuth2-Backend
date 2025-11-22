import fs from 'fs';
import crypto from 'crypto';

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface EncryptedData {
  iv: string;
  encrypted: string;
}

class SecureTokenStorage {
  private encryptionKey: string;
  private filePath: string;

  constructor(encryptionKey?: string, filePath: string = './tokens.encrypted.json') {
    this.filePath = filePath;

    // Generate or use provided key
    const providedKey = encryptionKey || this.generateEncryptionKey();

    // Ensure the encryption key is exactly 32 bytes (64 hex chars) for AES-256
    if (providedKey.length < 64) {
      // Derive a proper 32-byte key using scrypt
      this.encryptionKey = crypto.scryptSync(providedKey, 'salt', 32).toString('hex');
    } else {
      this.encryptionKey = providedKey;
    }
  }

  // Generate a random encryption key if none provided
  private generateEncryptionKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  // Encrypt data
  private encrypt(data: TokenData): EncryptedData {
    const iv = crypto.randomBytes(16);
    // Use first 32 bytes of key for AES-256
    const key = Buffer.from(this.encryptionKey.slice(0, 64), 'hex');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return {
      iv: iv.toString('hex'),
      encrypted: encrypted
    };
  }

  // Decrypt data
  private decrypt(encryptedData: EncryptedData): TokenData | null {
    try {
      const iv = Buffer.from(encryptedData.iv, 'hex');
      // Use first 32 bytes of key for AES-256
      const key = Buffer.from(this.encryptionKey.slice(0, 64), 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return JSON.parse(decrypted) as TokenData;
    } catch (error: any) {
      console.error('Decryption failed:', error.message);
      return null;
    }
  }

  // Save tokens to encrypted file
  saveTokens(tokens: TokenData): boolean {
    try {
      const encrypted = this.encrypt(tokens);
      fs.writeFileSync(this.filePath, JSON.stringify(encrypted));
      console.log('✅ Tokens saved securely');
      return true;
    } catch (error: any) {
      console.error('❌ Failed to save tokens:', error.message);
      return false;
    }
  }

  // Load tokens from encrypted file
  loadTokens(): TokenData | null {
    try {
      if (!fs.existsSync(this.filePath)) {
        console.log('ℹ️  No existing tokens found');
        return null;
      }

      const encryptedData = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as EncryptedData;
      const tokens = this.decrypt(encryptedData);

      if (tokens) {
        console.log('✅ Tokens loaded successfully');
        return tokens;
      } else {
        console.log('❌ Failed to decrypt tokens');
        return null;
      }
    } catch (error: any) {
      console.error('❌ Failed to load tokens:', error.message);
      return null;
    }
  }

  // Clear stored tokens
  clearTokens(): boolean {
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
        console.log('✅ Tokens cleared');
      }
      return true;
    } catch (error: any) {
      console.error('❌ Failed to clear tokens:', error.message);
      return false;
    }
  }

  // Check if tokens exist and are valid
  hasValidTokens(): boolean {
    const tokens = this.loadTokens();
    if (!tokens || !tokens.access_token) {
      return false;
    }

    // Check if token is expired (with 5 minute buffer)
    const bufferTime = 5 * 60 * 1000; // 5 minutes
    return Date.now() < (tokens.expires_at - bufferTime);
  }
}

export default SecureTokenStorage;
export { TokenData, EncryptedData };
