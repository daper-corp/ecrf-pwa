// Date Utilities
// ISO 8601 형식 날짜 처리

/**
 * 현재 시간 (ISO 8601 형식)
 */
export function now(): string {
  return new Date().toISOString();
}

/**
 * 날짜 포맷팅 (YYYY-MM-DD)
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
}

/**
 * 날짜+시간 포맷팅 (YYYY-MM-DD HH:mm:ss)
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * 날짜 파싱 (다양한 형식 지원)
 */
export function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * 두 날짜 사이 일수 계산
 */
export function daysBetween(date1: Date | string, date2: Date | string): number {
  const d1 = typeof date1 === 'string' ? new Date(date1) : date1;
  const d2 = typeof date2 === 'string' ? new Date(date2) : date2;
  
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * 날짜에 일수 추가
 */
export function addDays(date: Date | string, days: number): Date {
  const d = typeof date === 'string' ? new Date(date) : new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * 날짜에 분 추가
 */
export function addMinutes(date: Date | string, minutes: number): Date {
  const d = typeof date === 'string' ? new Date(date) : new Date(date);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

/**
 * 날짜 비교 (date1 > date2이면 1, 같으면 0, date1 < date2이면 -1)
 */
export function compareDates(date1: Date | string, date2: Date | string): number {
  const d1 = typeof date1 === 'string' ? new Date(date1) : date1;
  const d2 = typeof date2 === 'string' ? new Date(date2) : date2;
  
  if (d1.getTime() > d2.getTime()) return 1;
  if (d1.getTime() < d2.getTime()) return -1;
  return 0;
}

/**
 * 날짜가 범위 내에 있는지 확인
 */
export function isDateInRange(
  date: Date | string,
  startDate: Date | string,
  endDate: Date | string
): boolean {
  const d = typeof date === 'string' ? new Date(date) : date;
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate;
  
  return d >= start && d <= end;
}

/**
 * 만료 여부 확인
 */
export function isExpired(expiryDate: Date | string): boolean {
  const expiry = typeof expiryDate === 'string' ? new Date(expiryDate) : expiryDate;
  return expiry < new Date();
}

/**
 * 나이 계산
 */
export function calculateAge(birthDate: Date | string): number {
  const birth = typeof birthDate === 'string' ? new Date(birthDate) : birthDate;
  const today = new Date();
  
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  
  return age;
}

/**
 * 상대적 시간 표시 (예: "3시간 전", "어제")
 */
export function relativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 1) return '방금 전';
  if (diffMins < 60) return `${diffMins}분 전`;
  if (diffHours < 24) return `${diffHours}시간 전`;
  if (diffDays < 7) return `${diffDays}일 전`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}주 전`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}개월 전`;
  return `${Math.floor(diffDays / 365)}년 전`;
}

/**
 * Visit 윈도우 날짜 계산
 * @param baselineDate 기준일 (Baseline/Day 1)
 * @param targetDay 목표 일수
 * @param windowBefore 허용 범위 (이전)
 * @param windowAfter 허용 범위 (이후)
 */
export function calculateVisitWindow(
  baselineDate: Date | string,
  targetDay: number,
  windowBefore: number,
  windowAfter: number
): { targetDate: Date; windowStart: Date; windowEnd: Date } {
  const baseline = typeof baselineDate === 'string' ? new Date(baselineDate) : baselineDate;
  
  const targetDate = addDays(baseline, targetDay - 1); // Day 1이 기준
  const windowStart = addDays(targetDate, -windowBefore);
  const windowEnd = addDays(targetDate, windowAfter);
  
  return { targetDate, windowStart, windowEnd };
}
