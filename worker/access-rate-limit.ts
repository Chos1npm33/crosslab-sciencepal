import { DurableObject } from 'cloudflare:workers';

const WINDOW_MS = 60_000;
const ATTEMPTS = 5;

/** One object per secret-HMAC(origin + IP). Storage contains only a count and expiry. */
export class LoginAttemptCounter extends DurableObject {
  private windowTable() {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS login_window (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL)');
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/attempt') return new Response(null, { status: 405 });
    const now = Date.now();
    // No await inside the read/update: concurrent requests consume distinct slots.
    const result = this.ctx.storage.transactionSync(() => {
      this.windowTable();
      const row = this.ctx.storage.sql.exec<{ expires_at: number; attempts: number }>('SELECT expires_at, attempts FROM login_window WHERE singleton = 1').toArray()[0];
      if (!row || row.expires_at <= now) {
        const expiresAt = now + WINDOW_MS;
        this.ctx.storage.sql.exec('INSERT OR REPLACE INTO login_window (singleton, expires_at, attempts) VALUES (1, ?, 1)', expiresAt);
        return { success: true, retryAfter: 0, expiresAt, reset: true };
      }
      if (row.attempts >= ATTEMPTS) return { success: false, retryAfter: Math.max(1, Math.min(60, Math.ceil((row.expires_at - now) / 1000))), expiresAt: row.expires_at, reset: false };
      this.ctx.storage.sql.exec('UPDATE login_window SET attempts = attempts + 1 WHERE singleton = 1');
      return { success: true, retryAfter: 0, expiresAt: row.expires_at, reset: false };
    });
    if (result.reset) await this.ctx.storage.setAlarm(result.expiresAt);
    // The storage output gate commits before this response is sent.
    return Response.json({ success: result.success, retryAfter: result.retryAfter });
  }

  async alarm(): Promise<void> {
    this.windowTable();
    const row = this.ctx.storage.sql.exec<{ expires_at: number }>('SELECT expires_at FROM login_window WHERE singleton = 1').toArray()[0];
    // An old alarm must not erase a newer window created before it was delivered.
    if (row && row.expires_at > Date.now()) {
      await this.ctx.storage.setAlarm(row.expires_at);
      return;
    }
    await this.ctx.storage.deleteAll();
  }
}
