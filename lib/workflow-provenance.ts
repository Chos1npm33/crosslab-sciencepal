import { z } from 'zod';

const displayText = (max: number) => z.string().trim().min(1).max(max)
  .refine(value => !/[\u0000-\u001f\u007f]/.test(value), '来源标识不可包含控制字符');

/** Source information reported by the configured gateway, not platform attestation. */
export const upstreamRunSchema = z.object({
  provider: displayText(80),
  runId: displayText(200),
  projectUrl: z.string().trim().max(2048).url().refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }, '来源项目必须使用不含用户凭据的 HTTPS 链接'),
  completedAt: z.string().datetime({ offset: true }),
});

// Strip unrecognized fields so gateway credentials or internal metadata cannot
// accidentally be echoed into the browser alongside the allowed provenance.
export const remoteWorkflowEnvelopeSchema = z.object({
  data: z.unknown(),
  upstream: upstreamRunSchema.optional(),
});

export type UpstreamRun = z.infer<typeof upstreamRunSchema>;
