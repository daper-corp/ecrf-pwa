// ID Generation Utilities
// UUID v4 및 커스텀 ID 생성

/**
 * UUID v4 생성 (Web Crypto API 사용)
 */
export function generateUUID(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  
  // Set version (4) and variant (RFC4122)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join('-');
}

/**
 * 짧은 랜덤 ID 생성
 * @param prefix 접두사 (예: 'usr', 'study', 'site')
 * @param length 랜덤 부분 길이 (기본값: 8)
 */
export function generateId(prefix: string, length: number = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  
  let result = prefix + '_';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  
  return result;
}

/**
 * 타임스탬프 기반 ID 생성 (정렬 가능)
 * @param prefix 접두사
 */
export function generateTimeBasedId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}${random}`;
}

/**
 * Subject ID 생성 (Site번호-일련번호 형식)
 * @param siteNumber 기관 번호
 * @param sequenceNumber 일련번호
 */
export function generateSubjectId(siteNumber: string, sequenceNumber: number): string {
  const paddedSequence = sequenceNumber.toString().padStart(3, '0');
  return `${siteNumber}-${paddedSequence}`;
}

/**
 * Screening Number 생성
 * @param prefix 접두사 (기본값: 'SCR')
 * @param sequenceNumber 일련번호
 */
export function generateScreeningNumber(prefix: string = 'SCR', sequenceNumber: number): string {
  const paddedSequence = sequenceNumber.toString().padStart(4, '0');
  return `${prefix}-${paddedSequence}`;
}

/**
 * Audit Log ID 생성 (타임스탬프 + 랜덤)
 */
export function generateAuditId(): string {
  return generateTimeBasedId('aud');
}

/**
 * Session ID 생성
 */
export function generateSessionId(): string {
  return generateUUID();
}
