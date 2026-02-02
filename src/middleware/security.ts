// Security Middleware for eCRF PWA
// Provides security headers, rate limiting, and request validation

import { Context, Next } from 'hono';
import type { Bindings, Variables } from '../types';

// =====================================================
// SECURITY HEADERS MIDDLEWARE
// =====================================================

export const securityHeaders = async (c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) => {
  await next();
  
  // Security headers for 21 CFR Part 11 compliance
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  
  // Cache control for sensitive data
  if (c.req.path.startsWith('/api/')) {
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    c.header('Pragma', 'no-cache');
    c.header('Expires', '0');
  }
  
  // Content Security Policy
  c.header('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://*.pages.dev https://*.workers.dev",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'"
  ].join('; '));
};

// =====================================================
// RATE LIMITING MIDDLEWARE
// =====================================================

// In-memory rate limit store (for Cloudflare Workers, consider using KV or Durable Objects for production)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

interface RateLimitConfig {
  windowMs: number;  // Time window in milliseconds
  max: number;       // Max requests per window
  message?: string;  // Custom error message
}

const defaultRateLimitConfig: RateLimitConfig = {
  windowMs: 60 * 1000,  // 1 minute
  max: 100,             // 100 requests per minute
  message: 'Too many requests, please try again later.'
};

const loginRateLimitConfig: RateLimitConfig = {
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,                     // 5 login attempts per 15 minutes
  message: 'Too many login attempts, please try again later.'
};

const getClientIP = (c: Context): string => {
  return c.req.header('CF-Connecting-IP') || 
         c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 
         c.req.header('X-Real-IP') || 
         'unknown';
};

export const createRateLimiter = (config: RateLimitConfig = defaultRateLimitConfig) => {
  return async (c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) => {
    const ip = getClientIP(c);
    const key = `${ip}:${c.req.path}`;
    const now = Date.now();
    
    // Clean up expired entries periodically
    if (Math.random() < 0.01) {  // 1% chance to clean up
      for (const [k, v] of rateLimitStore.entries()) {
        if (v.resetTime < now) {
          rateLimitStore.delete(k);
        }
      }
    }
    
    const record = rateLimitStore.get(key);
    
    if (!record || record.resetTime < now) {
      // New window
      rateLimitStore.set(key, {
        count: 1,
        resetTime: now + config.windowMs
      });
    } else {
      // Existing window
      record.count++;
      
      if (record.count > config.max) {
        const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);
        c.header('Retry-After', String(retryAfterSeconds));
        c.header('X-RateLimit-Limit', String(config.max));
        c.header('X-RateLimit-Remaining', '0');
        c.header('X-RateLimit-Reset', String(record.resetTime));
        
        return c.json({
          success: false,
          error: config.message || 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          retry_after_seconds: retryAfterSeconds,
          request_id: c.get('requestId')
        }, 429);
      }
    }
    
    // Add rate limit headers
    const currentRecord = rateLimitStore.get(key)!;
    c.header('X-RateLimit-Limit', String(config.max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, config.max - currentRecord.count)));
    c.header('X-RateLimit-Reset', String(currentRecord.resetTime));
    
    await next();
  };
};

// Pre-configured rate limiters
export const apiRateLimiter = createRateLimiter(defaultRateLimitConfig);
export const loginRateLimiter = createRateLimiter(loginRateLimitConfig);

// Stricter rate limiter for sensitive operations
export const strictRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many requests for this operation.'
});

// =====================================================
// REQUEST VALIDATION MIDDLEWARE
// =====================================================

export const validateRequest = async (c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) => {
  // Check for required headers on POST/PUT/DELETE
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(c.req.method)) {
    const contentType = c.req.header('Content-Type');
    
    // Skip content-type check for form data and empty bodies
    if (contentType && !contentType.includes('application/json') && !contentType.includes('multipart/form-data')) {
      // Only enforce for API routes with body
      if (c.req.path.startsWith('/api/') && c.req.path !== '/api/auth/logout') {
        // Log but don't block - some operations may have empty bodies
        console.warn(`Non-JSON content type received: ${contentType} for ${c.req.path}`);
      }
    }
  }
  
  // Check for suspicious patterns in request
  const userAgent = c.req.header('User-Agent') || '';
  const suspiciousPatterns = [
    /sqlmap/i,
    /nikto/i,
    /nessus/i,
    /masscan/i,
    /zgrab/i
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(userAgent)) {
      console.warn(`Suspicious user agent detected: ${userAgent}`);
      // Don't block, but log for monitoring
    }
  }
  
  await next();
};

// =====================================================
// REQUEST ID MIDDLEWARE
// =====================================================

export const requestId = async (c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) => {
  const id = c.req.header('X-Request-ID') || crypto.randomUUID();
  c.set('requestId' as keyof Variables, id as Variables[keyof Variables]);
  c.header('X-Request-ID', id);
  await next();
};
