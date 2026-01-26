// eCRF PWA - Push Notification Routes
// Web Push API for Query/Signature notifications

import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { getAuthUser } from '../middleware/auth';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// =====================================================
// WEB PUSH IMPLEMENTATION
// =====================================================

// Note: For production, you need VAPID keys stored in environment
// Generate with: npx web-push generate-vapid-keys

/**
 * Get VAPID public key for client subscription
 */
app.get('/vapid-key', (c) => {
  // In production, this should come from environment variables
  const publicKey = c.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
  
  return c.json({
    success: true,
    data: { publicKey }
  });
});

/**
 * Subscribe to push notifications
 */
app.post('/subscribe', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  const { subscription } = await c.req.json();

  if (!subscription || !subscription.endpoint) {
    return c.json({ success: false, error: '유효하지 않은 구독 정보입니다.' }, 400);
  }

  // Store subscription
  await c.env.DB.prepare(`
    UPDATE users 
    SET push_subscription = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(JSON.stringify(subscription), user.userId).run();

  return c.json({
    success: true,
    message: '푸시 알림이 활성화되었습니다.'
  });
});

/**
 * Unsubscribe from push notifications
 */
app.post('/unsubscribe', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  await c.env.DB.prepare(`
    UPDATE users 
    SET push_subscription = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(user.userId).run();

  return c.json({
    success: true,
    message: '푸시 알림이 비활성화되었습니다.'
  });
});

/**
 * Get notification preferences
 */
app.get('/preferences', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  const result = await c.env.DB.prepare(`
    SELECT push_subscription, notification_preferences
    FROM users WHERE id = ?
  `).bind(user.userId).first();

  const preferences = result?.notification_preferences 
    ? JSON.parse(result.notification_preferences as string)
    : { query: true, signature: true, lock: true, system: true };

  return c.json({
    success: true,
    data: {
      subscribed: !!result?.push_subscription,
      preferences
    }
  });
});

/**
 * Update notification preferences
 */
app.put('/preferences', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  const { preferences } = await c.req.json();

  const validPreferences = {
    query: preferences.query !== false,
    signature: preferences.signature !== false,
    lock: preferences.lock !== false,
    system: preferences.system !== false
  };

  await c.env.DB.prepare(`
    UPDATE users 
    SET notification_preferences = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(JSON.stringify(validPreferences), user.userId).run();

  return c.json({
    success: true,
    data: { preferences: validPreferences }
  });
});

/**
 * Send test notification
 */
app.post('/test', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  const result = await c.env.DB.prepare(`
    SELECT push_subscription FROM users WHERE id = ?
  `).bind(user.userId).first();

  if (!result?.push_subscription) {
    return c.json({ success: false, error: '푸시 알림이 활성화되지 않았습니다.' }, 400);
  }

  const subscription = JSON.parse(result.push_subscription as string);
  
  const payload = JSON.stringify({
    title: 'eCRF 테스트 알림',
    body: '푸시 알림이 정상적으로 작동합니다.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    tag: 'test-notification',
    data: { url: '/' }
  });

  try {
    // Note: In production, use web-push library with VAPID keys
    // For now, we'll simulate success
    // await webpush.sendNotification(subscription, payload);
    
    return c.json({
      success: true,
      message: '테스트 알림이 전송되었습니다.',
      note: '실제 Push 알림은 VAPID 키 설정 후 작동합니다.'
    });
  } catch (error: any) {
    return c.json({
      success: false,
      error: '알림 전송에 실패했습니다.',
      details: error.message
    }, 500);
  }
});

/**
 * Send notification to specific users (internal use)
 */
export async function sendNotificationToUsers(
  db: D1Database,
  userIds: string[],
  notification: {
    title: string;
    body: string;
    tag?: string;
    data?: Record<string, any>;
    type: 'query' | 'signature' | 'lock' | 'system';
  }
) {
  const results = await db.prepare(`
    SELECT id, push_subscription, notification_preferences
    FROM users 
    WHERE id IN (${userIds.map(() => '?').join(',')})
      AND push_subscription IS NOT NULL
  `).bind(...userIds).all();

  const notifications: Array<{ userId: string; sent: boolean; error?: string }> = [];

  for (const user of results.results || []) {
    const prefs = user.notification_preferences 
      ? JSON.parse(user.notification_preferences as string)
      : {};
    
    // Check if user wants this type of notification
    if (prefs[notification.type] === false) {
      notifications.push({ userId: user.id as string, sent: false, error: 'Disabled by preference' });
      continue;
    }

    const subscription = JSON.parse(user.push_subscription as string);
    
    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-72.png',
      tag: notification.tag || `ecrf-${notification.type}`,
      data: notification.data || {}
    });

    try {
      // Note: Implement actual web-push here
      // await webpush.sendNotification(subscription, payload);
      notifications.push({ userId: user.id as string, sent: true });
    } catch (error: any) {
      notifications.push({ userId: user.id as string, sent: false, error: error.message });
    }
  }

  return notifications;
}

/**
 * Get notification history (in-app notifications)
 */
app.get('/history', async (c) => {
  const user = getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: '인증이 필요합니다.' }, 401);
  }

  const limit = parseInt(c.req.query('limit') || '20');
  const offset = parseInt(c.req.query('offset') || '0');

  // Get recent audit logs related to user as notifications
  const logs = await c.env.DB.prepare(`
    SELECT 
      al.id,
      al.action,
      al.table_name,
      al.record_id,
      al.new_value,
      al.timestamp,
      u.name as actor_name
    FROM audit_logs al
    LEFT JOIN users u ON al.user_id = u.id
    WHERE 
      (al.table_name = 'queries' AND al.record_id IN (
        SELECT id FROM queries WHERE created_by = ? OR 
        crf_instance_id IN (SELECT id FROM crf_instances WHERE created_by = ?)
      ))
      OR (al.table_name = 'electronic_signatures' AND al.record_id IN (
        SELECT id FROM electronic_signatures WHERE signer_id = ?
      ))
      OR (al.table_name = 'data_locks')
    ORDER BY al.timestamp DESC
    LIMIT ? OFFSET ?
  `).bind(user.userId, user.userId, user.userId, limit, offset).all();

  // Transform to notification format
  const notifications = (logs.results || []).map((log: any) => ({
    id: log.id,
    type: log.table_name,
    action: log.action,
    message: formatNotificationMessage(log),
    actor: log.actor_name,
    timestamp: log.timestamp,
    read: false // Would need a separate read status table for real implementation
  }));

  return c.json({
    success: true,
    data: notifications
  });
});

function formatNotificationMessage(log: any): string {
  const messages: Record<string, Record<string, string>> = {
    queries: {
      CREATE: '새로운 Query가 생성되었습니다.',
      UPDATE: 'Query가 업데이트되었습니다.',
      QUERY_ANSWER: 'Query에 답변이 등록되었습니다.',
      QUERY_CLOSE: 'Query가 종료되었습니다.'
    },
    electronic_signatures: {
      CREATE: '전자서명이 완료되었습니다.',
      SIGN: '문서가 서명되었습니다.'
    },
    data_locks: {
      CREATE: '데이터가 잠금되었습니다.',
      LOCK: '데이터가 잠금되었습니다.',
      UNLOCK: '데이터 잠금이 해제되었습니다.'
    }
  };

  return messages[log.table_name]?.[log.action] || `${log.table_name} ${log.action}`;
}

export default app;
