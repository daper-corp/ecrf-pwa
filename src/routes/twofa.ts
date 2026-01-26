// eCRF PWA - Two-Factor Authentication Routes
// TOTP-based 2FA for enhanced security

import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { getAuthUser } from '../middleware/auth';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// =====================================================
// TOTP IMPLEMENTATION (Cloudflare Workers Compatible)
// =====================================================

/**
 * Generate a random base32 secret
 */
function generateSecret(length = 20): string {
  const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  let secret = '';
  for (let i = 0; i < length; i++) {
    secret += base32Chars[array[i] % 32];
  }
  return secret;
}

/**
 * Decode base32 string to Uint8Array
 */
function base32Decode(encoded: string): Uint8Array {
  const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleanInput = encoded.replace(/=+$/, '').toUpperCase();
  
  let bits = '';
  for (const char of cleanInput) {
    const val = base32Chars.indexOf(char);
    if (val === -1) throw new Error('Invalid base32 character');
    bits += val.toString(2).padStart(5, '0');
  }
  
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  
  return bytes;
}

/**
 * Generate HMAC-SHA1 using Web Crypto API
 */
async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, message);
  return new Uint8Array(signature);
}

/**
 * Generate TOTP code
 */
async function generateTOTP(secret: string, timestamp?: number): Promise<string> {
  const time = timestamp || Math.floor(Date.now() / 1000);
  const timeStep = Math.floor(time / 30);
  
  // Convert time to 8-byte big-endian
  const timeBytes = new Uint8Array(8);
  let t = timeStep;
  for (let i = 7; i >= 0; i--) {
    timeBytes[i] = t & 0xff;
    t = Math.floor(t / 256);
  }
  
  const key = base32Decode(secret);
  const hmac = await hmacSha1(key, timeBytes);
  
  // Dynamic truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000;
  
  return code.toString().padStart(6, '0');
}

/**
 * Verify TOTP code (with time window)
 */
async function verifyTOTP(secret: string, code: string, window = 1): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  
  for (let i = -window; i <= window; i++) {
    const timeOffset = now + (i * 30);
    const expectedCode = await generateTOTP(secret, timeOffset);
    if (code === expectedCode) {
      return true;
    }
  }
  
  return false;
}

/**
 * Generate backup codes
 */
function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const array = new Uint8Array(4);
    crypto.getRandomValues(array);
    const code = Array.from(array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    codes.push(code.slice(0, 4) + '-' + code.slice(4, 8));
  }
  return codes;
}

// =====================================================
// 2FA SETUP
// =====================================================

// Get 2FA status
app.get('/status', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  const result = await c.env.DB.prepare(`
    SELECT two_factor_enabled, two_factor_verified_at
    FROM users WHERE id = ?
  `).bind(user.userId).first();

  return c.json({
    success: true,
    data: {
      enabled: result?.two_factor_enabled === 1,
      verifiedAt: result?.two_factor_verified_at
    }
  });
});

// Initialize 2FA setup
app.post('/setup', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  // Generate secret
  const secret = generateSecret();
  
  // Store secret temporarily (not enabled yet)
  await c.env.DB.prepare(`
    UPDATE users 
    SET two_factor_secret = ?, 
        two_factor_enabled = 0,
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(secret, user.userId).run();

  // Get user email for OTP URI
  const userResult = await c.env.DB.prepare(`
    SELECT email FROM users WHERE id = ?
  `).bind(user.userId).first();

  // Generate OTP Auth URI for QR code
  const issuer = 'eCRF-PWA';
  const otpAuthUri = `otpauth://totp/${issuer}:${userResult?.email}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

  return c.json({
    success: true,
    data: {
      secret,
      otpAuthUri,
      qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpAuthUri)}`
    }
  });
});

// Verify and enable 2FA
app.post('/verify', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  const { code } = await c.req.json();

  if (!code || code.length !== 6) {
    return c.json({ success: false, error: '6자리 인증 코드를 입력하세요.' }, 400);
  }

  // Get stored secret
  const result = await c.env.DB.prepare(`
    SELECT two_factor_secret FROM users WHERE id = ?
  `).bind(user.userId).first();

  if (!result?.two_factor_secret) {
    return c.json({ success: false, error: '2FA 설정을 먼저 시작하세요.' }, 400);
  }

  // Verify code
  const isValid = await verifyTOTP(result.two_factor_secret as string, code);
  
  if (!isValid) {
    return c.json({ success: false, error: '잘못된 인증 코드입니다.' }, 400);
  }

  // Generate backup codes
  const backupCodes = generateBackupCodes();
  
  // Enable 2FA
  await c.env.DB.prepare(`
    UPDATE users 
    SET two_factor_enabled = 1,
        two_factor_verified_at = datetime('now'),
        two_factor_backup_codes = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(JSON.stringify(backupCodes), user.userId).run();

  // Audit log
  await c.env.DB.prepare(`
    INSERT INTO audit_logs (id, table_name, record_id, action, user_id, new_value, ip_address, user_agent, timestamp)
    VALUES (?, 'users', ?, 'UPDATE', ?, ?, ?, ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    user.userId,
    user.userId,
    JSON.stringify({ action: '2FA_ENABLED' }),
    c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown',
    c.req.header('User-Agent') || 'unknown'
  ).run();

  return c.json({
    success: true,
    message: '2단계 인증이 활성화되었습니다.',
    data: {
      backupCodes
    }
  });
});

// Disable 2FA
app.post('/disable', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  const { password, code } = await c.req.json();

  if (!password) {
    return c.json({ success: false, error: '비밀번호를 입력하세요.' }, 400);
  }

  // Verify password
  const userResult = await c.env.DB.prepare(`
    SELECT password_hash, two_factor_secret, two_factor_enabled FROM users WHERE id = ?
  `).bind(user.userId).first();

  if (!userResult?.two_factor_enabled) {
    return c.json({ success: false, error: '2FA가 활성화되지 않았습니다.' }, 400);
  }

  // Verify password using PBKDF2
  const { verifyPassword } = await import('../services/auth.service');
  const isPasswordValid = await verifyPassword(password, userResult.password_hash as string);
  
  if (!isPasswordValid) {
    return c.json({ success: false, error: '잘못된 비밀번호입니다.' }, 400);
  }

  // Verify 2FA code if provided
  if (code) {
    const isCodeValid = await verifyTOTP(userResult.two_factor_secret as string, code);
    if (!isCodeValid) {
      return c.json({ success: false, error: '잘못된 인증 코드입니다.' }, 400);
    }
  }

  // Disable 2FA
  await c.env.DB.prepare(`
    UPDATE users 
    SET two_factor_enabled = 0,
        two_factor_secret = NULL,
        two_factor_backup_codes = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(user.userId).run();

  // Audit log
  await c.env.DB.prepare(`
    INSERT INTO audit_logs (id, table_name, record_id, action, user_id, new_value, ip_address, user_agent, timestamp)
    VALUES (?, 'users', ?, 'UPDATE', ?, ?, ?, ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    user.userId,
    user.userId,
    JSON.stringify({ action: '2FA_DISABLED' }),
    c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown',
    c.req.header('User-Agent') || 'unknown'
  ).run();

  return c.json({
    success: true,
    message: '2단계 인증이 비활성화되었습니다.'
  });
});

// Verify 2FA during login
app.post('/validate', async (c) => {
  const { userId, code, backupCode } = await c.req.json();

  if (!userId) {
    return c.json({ success: false, error: '사용자 ID가 필요합니다.' }, 400);
  }

  const userResult = await c.env.DB.prepare(`
    SELECT two_factor_secret, two_factor_backup_codes, two_factor_enabled 
    FROM users WHERE id = ?
  `).bind(userId).first();

  if (!userResult?.two_factor_enabled) {
    return c.json({ success: true, data: { required: false } });
  }

  // Try TOTP code first
  if (code) {
    const isValid = await verifyTOTP(userResult.two_factor_secret as string, code);
    if (isValid) {
      return c.json({ success: true, data: { validated: true } });
    }
  }

  // Try backup code
  if (backupCode) {
    const backupCodes = JSON.parse(userResult.two_factor_backup_codes as string || '[]');
    const codeIndex = backupCodes.indexOf(backupCode.toUpperCase());
    
    if (codeIndex !== -1) {
      // Remove used backup code
      backupCodes.splice(codeIndex, 1);
      await c.env.DB.prepare(`
        UPDATE users SET two_factor_backup_codes = ? WHERE id = ?
      `).bind(JSON.stringify(backupCodes), userId).run();

      return c.json({ 
        success: true, 
        data: { 
          validated: true,
          backupCodeUsed: true,
          remainingBackupCodes: backupCodes.length
        } 
      });
    }
  }

  return c.json({ success: false, error: '잘못된 인증 코드입니다.' }, 400);
});

// Regenerate backup codes
app.post('/backup-codes/regenerate', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  const { password } = await c.req.json();

  // Verify password
  const userResult = await c.env.DB.prepare(`
    SELECT password_hash, two_factor_enabled FROM users WHERE id = ?
  `).bind(user.userId).first();

  if (!userResult?.two_factor_enabled) {
    return c.json({ success: false, error: '2FA가 활성화되지 않았습니다.' }, 400);
  }

  const { verifyPassword } = await import('../services/auth.service');
  const isPasswordValid = await verifyPassword(password, userResult.password_hash as string);
  
  if (!isPasswordValid) {
    return c.json({ success: false, error: '잘못된 비밀번호입니다.' }, 400);
  }

  // Generate new backup codes
  const backupCodes = generateBackupCodes();
  
  await c.env.DB.prepare(`
    UPDATE users SET two_factor_backup_codes = ? WHERE id = ?
  `).bind(JSON.stringify(backupCodes), user.userId).run();

  return c.json({
    success: true,
    data: { backupCodes }
  });
});

export default app;

// Export TOTP functions for use in auth routes
export { verifyTOTP, generateTOTP };
