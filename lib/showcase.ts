import { contextSchema, fingerprint, hasValidCitations, type Workspace } from './research';
import { analyze, makePlan, deepResearch, evaluate } from './demo-provider';

export async function runShowcase(action: 'analyze' | 'plan' | 'deep' | 'evaluate', state: Workspace) {
  const context = contextSchema.parse(state.context);
  const fp = await fingerprint(context);
  if (action !== 'analyze' && (!context.papers.length || !context.mappings.length)) throw new Error('请先完成文献分析与映射审查。');
  if (action === 'deep' || action === 'evaluate') {
    if (state.plan?.fingerprint !== fp || state.confirmation?.fingerprint !== fp || !state.confirmation.approved) throw new Error('请先确认当前版本的研究计划。');
  }
  if (action === 'evaluate' && (!state.result || state.result.fingerprint !== fp || !hasValidCitations(state.result, context.papers))) throw new Error('请先完成当前版本深研。');
  const startedAt = new Date().toISOString();
  const data = await ({ analyze, plan: makePlan, deep: deepResearch, evaluate }[action])(context);
  return { data, meta: { runId: crypto.randomUUID(), inputRevision:context.revision, inputFingerprint:fp, provider:'demo' as const, status:'completed' as const, startedAt, completedAt:new Date().toISOString() } };
}
