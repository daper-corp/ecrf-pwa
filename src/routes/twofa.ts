// eCRF PWA - Two-Factor Authentication Routes
// Production-grade TOTP-based 2FA with enhanced security
// Compliant with 21 CFR Part 11 requirements

import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { getAuthUser, getClientInfo } from '../middleware/auth';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// =====================================================
// SECURITY CONSTANTS
// =====================================================
const TOTP_WINDOW = 1; // Allow 1 time step before/after (±30 seconds)
const BACKUP_CODE_COUNT = 10;
const MAX_VERIFY_ATTEMPTS = 5; // Max failed attempts before lockout
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const CODE_REUSE_WINDOW_MS = 60 * 1000; // 60 seconds - prevent code reuse
const SECRET_LENGTH = 32; // 160 bits for RFC 4226 compliance

// =====================================================
// CRYPTO UTILITIES (Cloudflare Workers Compatible)
// =====================================================

/**
 * Generate cryptographically secure random bytes
 */
function getRandomBytes(length: number): Uint8Array {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return array;
}

/**
 * Generate a random base32 secret (RFC 4648)
 */
function generateSecret(length = SECRET_LENGTH): string {
  const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const array = getRandomBytes(length);
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
  const cleanInput = encoded.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  
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
 * SHA-256 hash
 */
async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Encrypt data using AES-GCM
 */
async function encryptSecret(plaintext: string, encryptionKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const iv = getRandomBytes(12); // 96-bit IV for AES-GCM
  
  // Derive key from encryption key using SHA-256
  const keyMaterial = await crypto.subtle.digest('SHA-256', encoder.encode(encryptionKey));
  const key = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext)
  );
  
  // Combine IV + ciphertext and encode as base64
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt data using AES-GCM
 */
async function decryptSecret(encrypted: string, encryptionKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  
  // Decode base64
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  
  // Derive key from encryption key using SHA-256
  const keyMaterial = await crypto.subtle.digest('SHA-256', encoder.encode(encryptionKey));
  const key = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  
  return decoder.decode(plaintext);
}

/**
 * Generate TOTP code (RFC 6238)
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
  
  // Dynamic truncation (RFC 4226)
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
 * Verify TOTP code with time window and replay protection
 */
async function verifyTOTP(
  secret: string, 
  code: string, 
  window = TOTP_WINDOW
): Promise<{ valid: boolean; timeStep?: number }> {
  const now = Math.floor(Date.now() / 1000);
  const currentTimeStep = Math.floor(now / 30);
  
  for (let i = -window; i <= window; i++) {
    const timeOffset = now + (i * 30);
    const expectedCode = await generateTOTP(secret, timeOffset);
    if (code === expectedCode) {
      return { valid: true, timeStep: currentTimeStep + i };
    }
  }
  
  return { valid: false };
}

/**
 * Generate secure backup codes
 */
function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const array = getRandomBytes(4);
    const code = Array.from(array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    codes.push(code.slice(0, 4) + '-' + code.slice(4, 8));
  }
  return codes;
}

/**
 * Hash backup codes for secure storage
 */
async function hashBackupCodes(codes: string[]): Promise<string[]> {
  const hashedCodes: string[] = [];
  for (const code of codes) {
    const hash = await sha256(code.toUpperCase().replace('-', ''));
    hashedCodes.push(hash);
  }
  return hashedCodes;
}

/**
 * Get encryption key (should be stored in Cloudflare secrets in production)
 */
function getEncryptionKey(env: Bindings): string {
  // In production, use: env.TWO_FACTOR_ENCRYPTION_KEY
  // For development, use a derived key
  return env.TWO_FACTOR_ENCRYPTION_KEY || 'ecrf-pwa-2fa-encryption-key-v1-development';
}

// =====================================================
// AUDIT LOGGING
// =====================================================

async function create2FAAuditLog(
  db: D1Database,
  userId: string,
  action: string,
  details: Record<string, any>,
  ipAddress: string,
  userAgent: string
) {
  await db.prepare(`
    INSERT INTO audit_logs (
      id, table_name, record_id, action, user_id, 
      new_value, ip_address, user_agent, timestamp
    ) VALUES (?, 'users', ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    userId,
    action,
    userId,
    JSON.stringify({ 
      action_type: '2FA',
      action_detail: action,
      ...details,
      timestamp: new Date().toISOString()
    }),
    ipAddress,
    userAgent
  ).run();
}

// =====================================================
// RATE LIMITING & LOCKOUT
// =====================================================

async function check2FALockout(db: D1Database, userId: string): Promise<{ locked: boolean; remainingTime?: number }> {
  const result = await db.prepare(`
    SELECT two_factor_failed_attempts, two_factor_lockout_until
    FROM users WHERE id = ?
  `).bind(userId).first<{ two_factor_failed_attempts: number; two_factor_lockout_until: string | null }>();
  
  if (!result) return { locked: false };
  
  if (result.two_factor_lockout_until) {
    const lockoutUntil = new Date(result.two_factor_lockout_until).getTime();
    const now = Date.now();
    
    if (now < lockoutUntil) {
      return { locked: true, remainingTime: Math.ceil((lockoutUntil - now) / 1000) };
    }
    
    // Lockout expired, reset
    await db.prepare(`
      UPDATE users SET two_factor_failed_attempts = 0, two_factor_lockout_until = NULL WHERE id = ?
    `).bind(userId).run();
  }
  
  return { locked: false };
}

async function record2FAFailure(db: D1Database, userId: string): Promise<{ locked: boolean; attemptsRemaining: number }> {
  const result = await db.prepare(`
    SELECT two_factor_failed_attempts FROM users WHERE id = ?
  `).bind(userId).first<{ two_factor_failed_attempts: number }>();
  
  const currentAttempts = (result?.two_factor_failed_attempts || 0) + 1;
  
  if (currentAttempts >= MAX_VERIFY_ATTEMPTS) {
    // Lock the account
    const lockoutUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
    await db.prepare(`
      UPDATE users SET 
        two_factor_failed_attempts = ?,
        two_factor_lockout_until = ?
      WHERE id = ?
    `).bind(currentAttempts, lockoutUntil, userId).run();
    
    return { locked: true, attemptsRemaining: 0 };
  }
  
  await db.prepare(`
    UPDATE users SET two_factor_failed_attempts = ? WHERE id = ?
  `).bind(currentAttempts, userId).run();
  
  return { locked: false, attemptsRemaining: MAX_VERIFY_ATTEMPTS - currentAttempts };
}

async function reset2FAFailures(db: D1Database, userId: string): Promise<void> {
  await db.prepare(`
    UPDATE users SET 
      two_factor_failed_attempts = 0,
      two_factor_lockout_until = NULL
    WHERE id = ?
  `).bind(userId).run();
}

// =====================================================
// CODE REUSE PREVENTION
// =====================================================

async function checkCodeReuse(db: D1Database, userId: string, timeStep: number): Promise<boolean> {
  const result = await db.prepare(`
    SELECT two_factor_last_used_timestep FROM users WHERE id = ?
  `).bind(userId).first<{ two_factor_last_used_timestep: number | null }>();
  
  return result?.two_factor_last_used_timestep === timeStep;
}

async function recordCodeUsage(db: D1Database, userId: string, timeStep: number): Promise<void> {
  await db.prepare(`
    UPDATE users SET two_factor_last_used_timestep = ? WHERE id = ?
  `).bind(timeStep, userId).run();
}

// =====================================================
// 2FA STATUS
// =====================================================

app.get('/status', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  const result = await c.env.DB.prepare(`
    SELECT 
      two_factor_enabled, 
      two_factor_verified_at,
      two_factor_failed_attempts,
      two_factor_lockout_until
    FROM users WHERE id = ?
  `).bind(user.userId).first();

  const lockoutStatus = await check2FALockout(c.env.DB, user.userId);

  return c.json({
    success: true,
    data: {
      enabled: result?.two_factor_enabled === 1,
      verifiedAt: result?.two_factor_verified_at,
      locked: lockoutStatus.locked,
      lockoutRemainingSeconds: lockoutStatus.remainingTime
    }
  });
});

// =====================================================
// 2FA SETUP
// =====================================================

app.post('/setup', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  const { ipAddress, userAgent } = getClientInfo(c);

  // Check if already enabled
  const existingUser = await c.env.DB.prepare(`
    SELECT two_factor_enabled, email FROM users WHERE id = ?
  `).bind(user.userId).first<{ two_factor_enabled: number; email: string }>();

  if (existingUser?.two_factor_enabled) {
    return c.json({ success: false, error: '2FA가 이미 활성화되어 있습니다.' }, 400);
  }

  // Generate secret
  const secret = generateSecret();
  
  // Encrypt secret for storage
  const encryptionKey = getEncryptionKey(c.env);
  const encryptedSecret = await encryptSecret(secret, encryptionKey);
  
  // Store encrypted secret temporarily (not enabled yet)
  await c.env.DB.prepare(`
    UPDATE users 
    SET two_factor_secret = ?, 
        two_factor_enabled = 0,
        two_factor_pending_setup = 1,
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(encryptedSecret, user.userId).run();

  // Generate OTP Auth URI for QR code
  const issuer = 'eCRF-Clinical';
  const accountName = existingUser?.email || user.email;
  const otpAuthUri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

  // Audit log
  await create2FAAuditLog(
    c.env.DB,
    user.userId,
    '2FA_SETUP_INITIATED',
    { step: 'setup_started' },
    ipAddress || 'unknown',
    userAgent || 'unknown'
  );

  return c.json({
    success: true,
    data: {
      secret, // Show to user for manual entry
      otpAuthUri,
      qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpAuthUri)}`
    }
  });
});

// =====================================================
// 2FA VERIFY AND ENABLE
// =====================================================

app.post('/verify', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  const { code } = await c.req.json();
  const { ipAddress, userAgent } = getClientInfo(c);

  if (!code || !/^\d{6}$/.test(code)) {
    return c.json({ success: false, error: '6자리 숫자 인증 코드를 입력하세요.' }, 400);
  }

  // Check lockout
  const lockoutStatus = await check2FALockout(c.env.DB, user.userId);
  if (lockoutStatus.locked) {
    return c.json({ 
      success: false, 
      error: `너무 많은 시도가 있었습니다. ${Math.ceil(lockoutStatus.remainingTime! / 60)}분 후에 다시 시도하세요.` 
    }, 429);
  }

  // Get stored encrypted secret
  const result = await c.env.DB.prepare(`
    SELECT two_factor_secret, two_factor_pending_setup FROM users WHERE id = ?
  `).bind(user.userId).first<{ two_factor_secret: string; two_factor_pending_setup: number }>();

  if (!result?.two_factor_secret || !result?.two_factor_pending_setup) {
    return c.json({ success: false, error: '2FA 설정을 먼저 시작하세요.' }, 400);
  }

  // Decrypt secret
  const encryptionKey = getEncryptionKey(c.env);
  let secret: string;
  try {
    secret = await decryptSecret(result.two_factor_secret, encryptionKey);
  } catch (error) {
    console.error('Failed to decrypt 2FA secret:', error);
    return c.json({ success: false, error: '보안 오류가 발생했습니다.' }, 500);
  }

  // Verify code
  const verification = await verifyTOTP(secret, code);
  
  if (!verification.valid) {
    const failure = await record2FAFailure(c.env.DB, user.userId);
    
    await create2FAAuditLog(
      c.env.DB,
      user.userId,
      '2FA_VERIFY_FAILED',
      { reason: 'invalid_code', attempts_remaining: failure.attemptsRemaining },
      ipAddress || 'unknown',
      userAgent || 'unknown'
    );
    
    if (failure.locked) {
      return c.json({ 
        success: false, 
        error: '너무 많은 시도가 있었습니다. 15분 후에 다시 시도하세요.' 
      }, 429);
    }
    
    return c.json({ 
      success: false, 
      error: `잘못된 인증 코드입니다. (${failure.attemptsRemaining}회 남음)` 
    }, 400);
  }

  // Generate backup codes and hash them
  const backupCodes = generateBackupCodes();
  const hashedBackupCodes = await hashBackupCodes(backupCodes);

  // Enable 2FA
  await c.env.DB.prepare(`
    UPDATE users 
    SET two_factor_enabled = 1,
        two_factor_verified_at = datetime('now'),
        two_factor_backup_codes = ?,
        two_factor_pending_setup = 0,
        two_factor_failed_attempts = 0,
        two_factor_lockout_until = NULL,
        two_factor_last_used_timestep = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(JSON.stringify(hashedBackupCodes), verification.timeStep, user.userId).run();

  // Audit log
  await create2FAAuditLog(
    c.env.DB,
    user.userId,
    '2FA_ENABLED',
    { backup_codes_generated: backupCodes.length },
    ipAddress || 'unknown',
    userAgent || 'unknown'
  );

  return c.json({
    success: true,
    message: '2단계 인증이 활성화되었습니다.',
    data: {
      backupCodes // Return plain codes to user (only time they'll see them)
    }
  });
});

// =====================================================
// 2FA DISABLE
// =====================================================

app.post('/disable', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  const { password, code } = await c.req.json();
  const { ipAddress, userAgent } = getClientInfo(c);

  if (!password) {
    return c.json({ success: false, error: '비밀번호를 입력하세요.' }, 400);
  }

  // Verify password
  const userResult = await c.env.DB.prepare(`
    SELECT password_hash, two_factor_secret, two_factor_enabled FROM users WHERE id = ?
  `).bind(user.userId).first<{ password_hash: string; two_factor_secret: string; two_factor_enabled: number }>();

  if (!userResult?.two_factor_enabled) {
    return c.json({ success: false, error: '2FA가 활성화되지 않았습니다.' }, 400);
  }

  // Verify password using PBKDF2
  const { verifyPassword } = await import('../services/auth.service');
  const isPasswordValid = await verifyPassword(password, userResult.password_hash);
  
  if (!isPasswordValid) {
    await create2FAAuditLog(
      c.env.DB,
      user.userId,
      '2FA_DISABLE_FAILED',
      { reason: 'invalid_password' },
      ipAddress || 'unknown',
      userAgent || 'unknown'
    );
    return c.json({ success: false, error: '잘못된 비밀번호입니다.' }, 400);
  }

  // Verify 2FA code if provided (recommended)
  if (code) {
    const encryptionKey = getEncryptionKey(c.env);
    try {
      const secret = await decryptSecret(userResult.two_factor_secret, encryptionKey);
      const verification = await verifyTOTP(secret, code);
      if (!verification.valid) {
        return c.json({ success: false, error: '잘못된 인증 코드입니다.' }, 400);
      }
    } catch (error) {
      return c.json({ success: false, error: '보안 오류가 발생했습니다.' }, 500);
    }
  }

  // Disable 2FA - clear all 2FA data
  await c.env.DB.prepare(`
    UPDATE users 
    SET two_factor_enabled = 0,
        two_factor_secret = NULL,
        two_factor_backup_codes = NULL,
        two_factor_verified_at = NULL,
        two_factor_pending_setup = 0,
        two_factor_failed_attempts = 0,
        two_factor_lockout_until = NULL,
        two_factor_last_used_timestep = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(user.userId).run();

  // Audit log
  await create2FAAuditLog(
    c.env.DB,
    user.userId,
    '2FA_DISABLED',
    { method: code ? 'password_and_code' : 'password_only' },
    ipAddress || 'unknown',
    userAgent || 'unknown'
  );

  return c.json({
    success: true,
    message: '2단계 인증이 비활성화되었습니다.'
  });
});

// =====================================================
// 2FA VALIDATION (During Login)
// =====================================================

app.post('/validate', async (c) => {
  const { userId, code, backupCode } = await c.req.json();
  const { ipAddress, userAgent } = getClientInfo(c);

  if (!userId) {
    return c.json({ success: false, error: '사용자 ID가 필요합니다.' }, 400);
  }

  // Check lockout
  const lockoutStatus = await check2FALockout(c.env.DB, userId);
  if (lockoutStatus.locked) {
    return c.json({ 
      success: false, 
      error: `너무 많은 시도가 있었습니다. ${Math.ceil(lockoutStatus.remainingTime! / 60)}분 후에 다시 시도하세요.`,
      locked: true,
      lockoutRemainingSeconds: lockoutStatus.remainingTime
    }, 429);
  }

  const userResult = await c.env.DB.prepare(`
    SELECT two_factor_secret, two_factor_backup_codes, two_factor_enabled, two_factor_last_used_timestep
    FROM users WHERE id = ?
  `).bind(userId).first<{ 
    two_factor_secret: string; 
    two_factor_backup_codes: string; 
    two_factor_enabled: number;
    two_factor_last_used_timestep: number | null;
  }>();

  if (!userResult?.two_factor_enabled) {
    return c.json({ success: true, data: { required: false } });
  }

  // Validate input
  if (!code && !backupCode) {
    return c.json({ success: false, error: '인증 코드 또는 백업 코드를 입력하세요.' }, 400);
  }

  // Try TOTP code first
  if (code) {
    if (!/^\d{6}$/.test(code)) {
      return c.json({ success: false, error: '6자리 숫자 인증 코드를 입력하세요.' }, 400);
    }

    const encryptionKey = getEncryptionKey(c.env);
    let secret: string;
    try {
      secret = await decryptSecret(userResult.two_factor_secret, encryptionKey);
    } catch (error) {
      console.error('Failed to decrypt 2FA secret:', error);
      return c.json({ success: false, error: '보안 오류가 발생했습니다.' }, 500);
    }

    const verification = await verifyTOTP(secret, code);
    
    if (verification.valid) {
      // Check for code reuse
      if (verification.timeStep === userResult.two_factor_last_used_timestep) {
        return c.json({ 
          success: false, 
          error: '이 코드는 이미 사용되었습니다. 새 코드를 기다려주세요.' 
        }, 400);
      }

      // Record code usage and reset failures
      await recordCodeUsage(c.env.DB, userId, verification.timeStep!);
      await reset2FAFailures(c.env.DB, userId);
      
      await create2FAAuditLog(
        c.env.DB,
        userId,
        '2FA_LOGIN_SUCCESS',
        { method: 'totp' },
        ipAddress || 'unknown',
        userAgent || 'unknown'
      );

      return c.json({ success: true, data: { validated: true } });
    }
  }

  // Try backup code
  if (backupCode) {
    const normalizedBackupCode = backupCode.toUpperCase().replace(/-/g, '').replace(/\s/g, '');
    const backupCodeHash = await sha256(normalizedBackupCode);
    
    const hashedCodes: string[] = JSON.parse(userResult.two_factor_backup_codes || '[]');
    const codeIndex = hashedCodes.indexOf(backupCodeHash);
    
    if (codeIndex !== -1) {
      // Remove used backup code
      hashedCodes.splice(codeIndex, 1);
      await c.env.DB.prepare(`
        UPDATE users SET two_factor_backup_codes = ? WHERE id = ?
      `).bind(JSON.stringify(hashedCodes), userId).run();

      await reset2FAFailures(c.env.DB, userId);
      
      await create2FAAuditLog(
        c.env.DB,
        userId,
        '2FA_LOGIN_SUCCESS',
        { 
          method: 'backup_code', 
          remaining_backup_codes: hashedCodes.length,
          warning: hashedCodes.length < 3 ? 'low_backup_codes' : null
        },
        ipAddress || 'unknown',
        userAgent || 'unknown'
      );

      return c.json({ 
        success: true, 
        data: { 
          validated: true,
          backupCodeUsed: true,
          remainingBackupCodes: hashedCodes.length,
          warning: hashedCodes.length < 3 ? '백업 코드가 부족합니다. 새로 생성하세요.' : null
        } 
      });
    }
  }

  // Failed verification
  const failure = await record2FAFailure(c.env.DB, userId);
  
  await create2FAAuditLog(
    c.env.DB,
    userId,
    '2FA_LOGIN_FAILED',
    { 
      reason: code ? 'invalid_totp' : 'invalid_backup_code',
      attempts_remaining: failure.attemptsRemaining
    },
    ipAddress || 'unknown',
    userAgent || 'unknown'
  );

  if (failure.locked) {
    return c.json({ 
      success: false, 
      error: '너무 많은 시도가 있었습니다. 15분 후에 다시 시도하세요.',
      locked: true
    }, 429);
  }

  return c.json({ 
    success: false, 
    error: `잘못된 인증 코드입니다. (${failure.attemptsRemaining}회 남음)` 
  }, 400);
});

// =====================================================
// REGENERATE BACKUP CODES
// =====================================================

app.post('/backup-codes/regenerate', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  const { password, code } = await c.req.json();
  const { ipAddress, userAgent } = getClientInfo(c);

  if (!password) {
    return c.json({ success: false, error: '비밀번호를 입력하세요.' }, 400);
  }

  // Verify password
  const userResult = await c.env.DB.prepare(`
    SELECT password_hash, two_factor_enabled, two_factor_secret FROM users WHERE id = ?
  `).bind(user.userId).first<{ password_hash: string; two_factor_enabled: number; two_factor_secret: string }>();

  if (!userResult?.two_factor_enabled) {
    return c.json({ success: false, error: '2FA가 활성화되지 않았습니다.' }, 400);
  }

  const { verifyPassword } = await import('../services/auth.service');
  const isPasswordValid = await verifyPassword(password, userResult.password_hash);
  
  if (!isPasswordValid) {
    return c.json({ success: false, error: '잘못된 비밀번호입니다.' }, 400);
  }

  // Optionally verify 2FA code for extra security
  if (code) {
    const encryptionKey = getEncryptionKey(c.env);
    try {
      const secret = await decryptSecret(userResult.two_factor_secret, encryptionKey);
      const verification = await verifyTOTP(secret, code);
      if (!verification.valid) {
        return c.json({ success: false, error: '잘못된 인증 코드입니다.' }, 400);
      }
    } catch (error) {
      return c.json({ success: false, error: '보안 오류가 발생했습니다.' }, 500);
    }
  }

  // Generate new backup codes
  const backupCodes = generateBackupCodes();
  const hashedBackupCodes = await hashBackupCodes(backupCodes);
  
  await c.env.DB.prepare(`
    UPDATE users SET two_factor_backup_codes = ?, updated_at = datetime('now') WHERE id = ?
  `).bind(JSON.stringify(hashedBackupCodes), user.userId).run();

  // Audit log
  await create2FAAuditLog(
    c.env.DB,
    user.userId,
    '2FA_BACKUP_CODES_REGENERATED',
    { new_codes_count: backupCodes.length },
    ipAddress || 'unknown',
    userAgent || 'unknown'
  );

  return c.json({
    success: true,
    data: { backupCodes }
  });
});

// =====================================================
// GET REMAINING BACKUP CODES COUNT
// =====================================================

app.get('/backup-codes/count', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  const result = await c.env.DB.prepare(`
    SELECT two_factor_backup_codes, two_factor_enabled FROM users WHERE id = ?
  `).bind(user.userId).first<{ two_factor_backup_codes: string; two_factor_enabled: number }>();

  if (!result?.two_factor_enabled) {
    return c.json({ success: false, error: '2FA가 활성화되지 않았습니다.' }, 400);
  }

  const codes: string[] = JSON.parse(result.two_factor_backup_codes || '[]');

  return c.json({
    success: true,
    data: { 
      count: codes.length,
      warning: codes.length < 3 ? '백업 코드가 부족합니다. 새로 생성하세요.' : null
    }
  });
});

export default app;

// Export TOTP functions for use in auth routes
export { verifyTOTP, generateTOTP, decryptSecret, getEncryptionKey };
