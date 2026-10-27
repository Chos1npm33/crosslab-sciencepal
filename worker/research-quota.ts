import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';

const identity = z.object({ role: z.enum(['owner', 'review']), visitorId: z.string().min(1).max(100) }).refine(value => value.role === 'owner' ? value.visitorId === 'owner' : z.string().uuid().safeParse(value.visitorId).success);
const reserveSchema = z.object({ requestId: z.string().uuid(), signature: z.string().regex(/^[a-f0-9]{64}$/) });
const completionSchema = z.object({ requestId: z.string().uuid(), claim: z.string().uuid(), response: z.object({ httpStatus: z.number().int().min(200).max(599), body: z.record(z.unknown()) }) });

/** A fixed namespace/object owns the complete campaign budget across deployments. */
export class ResearchQuota extends DurableObject {
  protected now() { return Date.now(); }
  private initialize() {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS budget (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), used INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO budget VALUES (1, 0)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, used INTEGER NOT NULL, last_dispatch INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS receipts (request_id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, signature TEXT NOT NULL, claim TEXT NOT NULL, response TEXT)');
  }
  private quota(visitorId: string, role: 'review' | 'owner', now: number) {
    const totalUsed = this.ctx.storage.sql.exec<{ used: number }>('SELECT used FROM budget WHERE singleton = 1').one().used;
    const visitor = this.ctx.storage.sql.exec<{ used: number; last_dispatch: number }>('SELECT used, last_dispatch FROM visitors WHERE id = ?', visitorId).toArray()[0];
    const visitorLimit = role === 'review' ? 8 : 30;
    return { totalLimit: 30, totalUsed, totalRemaining: 30 - totalUsed, visitorLimit, visitorUsed: visitor?.used || 0, visitorRemaining: Math.max(0, visitorLimit - (visitor?.used || 0)), retryAfterSeconds: role === 'review' && visitor ? Math.max(0, Math.min(60, Math.ceil((visitor.last_dispatch + 60_000 - now) / 1000))) : 0 };
  }
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    let raw: string;
    let body: unknown;
    try { raw = await request.text(); if (raw.length > 300000) return new Response(null, { status: 413 }); body = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
    const person = identity.safeParse(body);
    if (!person.success) return new Response(null, { status: 400 });
    const { visitorId, role } = person.data;
    const now = this.now();
    const path = new URL(request.url).pathname;
    return this.ctx.storage.transactionSync(() => {
      this.initialize();
      const quota = this.quota(visitorId, role, now);
      const error = (message: string, code: string, status: number, extra: Record<string, unknown> = {}) => Response.json({ error: message, code, quota, ...extra }, { status });
      if (path === '/status') return Response.json({ quota });
      if (path === '/reserve') {
        const parsed = reserveSchema.safeParse(body);
        if (!parsed.success) return error('研究请求标识无效。', 'request_invalid', 400);
        const { requestId, signature } = parsed.data;
        const prior = this.ctx.storage.sql.exec<{ visitor_id: string; signature: string; response: string | null }>('SELECT visitor_id, signature, response FROM receipts WHERE request_id = ?', requestId).toArray()[0];
        if (prior) {
          if (prior.visitor_id !== visitorId || prior.signature !== signature) return error('同一请求标识对应不同内容或访问会话。', 'request_conflict', 409);
          if (prior.response) return Response.json({ kind: 'replay', response: JSON.parse(prior.response), quota });
          return error('此请求已提交或启动结果待核对，请查询已有任务，不会重复启动。', 'request_inflight', 409, { status: 'unknown', requestId });
        }
        if (quota.totalRemaining <= 0) return error('本次评审的真实研究总额度已用完，仍可查看案例或切换演示。', 'quota_total_exhausted', 429);
        if (role === 'review' && quota.visitorRemaining <= 0) return error('当前浏览器的真实研究额度已用完，仍可查看案例或切换演示。', 'quota_visitor_exhausted', 429);
        if (quota.retryAfterSeconds > 0) return error('请等待一分钟间隔后再启动真实研究；查询进度不受此限制。', 'quota_cooldown', 429);
        const claim = crypto.randomUUID();
        this.ctx.storage.sql.exec('INSERT INTO receipts (request_id, visitor_id, signature, claim) VALUES (?, ?, ?, ?)', requestId, visitorId, signature, claim);
        this.ctx.storage.sql.exec('UPDATE budget SET used = used + 1 WHERE singleton = 1');
        this.ctx.storage.sql.exec('INSERT INTO visitors (id, used, last_dispatch) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET used = used + 1, last_dispatch = excluded.last_dispatch', visitorId, now);
        return Response.json({ kind: 'dispatch', claim, quota: this.quota(visitorId, role, now) });
      }
      if (path === '/complete') {
        const parsed = completionSchema.safeParse(body);
        if (!parsed.success) return error('运行回执无效。', 'receipt_invalid', 400);
        const { requestId, claim, response } = parsed.data;
        const receipt = this.ctx.storage.sql.exec<{ visitor_id: string; claim: string; response: string | null }>('SELECT visitor_id, claim, response FROM receipts WHERE request_id = ?', requestId).toArray()[0];
        if (!receipt || receipt.visitor_id !== visitorId || receipt.claim !== claim) return error('运行回执与提交不匹配。', 'receipt_mismatch', 409);
        const encoded = JSON.stringify(response);
        if (receipt.response && receipt.response !== encoded) return error('运行回执已经保存。', 'receipt_conflict', 409);
        this.ctx.storage.sql.exec('UPDATE receipts SET response = ? WHERE request_id = ?', encoded, requestId);
        return Response.json({ ok: true, quota });
      }
      return new Response(null, { status: 404 });
    });
  }
}

