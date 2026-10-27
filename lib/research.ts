import { z } from 'zod';
import { upstreamRunSchema } from './workflow-provenance';

export const directions = [
  { id: 'transport', label: '数学 · 最优传输', method: '最优传输与状态分布比较', description: '比较多组学状态分布，审查发育过程重建的条件。', tag: '分布与发育', icon: 'network' },
  { id: 'genomics', label: 'AI · 基因组预测', method: '卷积神经网络与基因组预测', description: '从 SNP 预测表型，以分组验证检验相对线性基线的增益。', tag: 'AI + Genomics', icon: 'network' },
  { id: 'network', label: '数学 · 网络科学', method: '网络鲁棒性与瓶颈分析', description: '从连接关系出发，研究系统如何响应扰动。', tag: '结构与关联', icon: 'network' },
  { id: 'diffusion', label: '物理 · 传输过程', method: '反应–扩散与空间建模', description: '用空间尺度、传输和反应解释局部差异。', tag: '空间与机制', icon: 'waves' },
  { id: 'attention', label: '经管 · 决策理论', method: '理性疏忽与信息成本', description: '研究有限信息下，如何分配注意力与决策。', tag: '信息与决策', icon: 'focus' },
  { id: 'custom', label: '自定义跨界方向', method: '', description: '填写一个学科、理论、算法或具体方法。', tag: '自由探索', icon: 'plus' },
] as const;
const text = z.string().trim().max(6000);
const requiredText = text.min(1);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const textList = z.array(requiredText).max(30);
const uniqueIds = <T extends { id: string }>(values: T[]) => new Set(values.map(v => v.id)).size === values.length;
export const draftProblemSchema = z.object({ field: text, question: text, baseline: text, resources: text });
export const problemSchema = draftProblemSchema.extend({ field: text.min(2), question: text.min(10) });
export const mappingSchema = z.object({ id, source: requiredText, target: requiredText, condition: requiredText, status: z.enum(['pending', 'accepted', 'rejected']) });
export const paperSchema = z.object({ id, title: requiredText, year: z.string().max(40), url: z.string().max(2000).url().refine(v => { const url = new URL(v); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }), role: z.enum(['背景', '方法', '跨界案例', '用户材料']), contribution: requiredText, relevance: text, boundary: text, provenance: requiredText });
const mappingList = z.array(mappingSchema).max(12).refine(uniqueIds, '映射 ID 必须唯一');
const paperList = z.array(paperSchema).max(15).refine(uniqueIds, '文献 ID 必须唯一');
const draftContextSchema = z.object({
  revision: z.number().int().min(1), problem: draftProblemSchema,
  direction: z.enum(['transport', 'genomics', 'network', 'diffusion', 'attention', 'custom']), method: text.min(2),
  sampleType: z.enum(['single', 'timeSeries', 'none']).default('single'),
  goal: z.enum(['mechanism', 'prediction']).default('mechanism'),
  canCollect: z.boolean().default(true),
  evidence: z.enum(['association', 'functional', 'unknown']), note: text,
  mappings: mappingList, papers: paperList,
});
export const contextSchema = draftContextSchema.extend({ problem: problemSchema });
export const analysisSchema = z.object({ summary: requiredText, hypothesis: requiredText, papers: paperList.refine(v => v.length > 0), mappings: mappingList.refine(v => v.length > 0), questions: z.array(requiredText).max(10) });
export const planSchema = z.object({ fingerprint: hash, questions: textList.refine(v => v.length > 0), searches: textList, tasks: textList.refine(v => v.length > 0), stop: requiredText, scope: requiredText });
export const resultSchema = z.object({ fingerprint: hash, hypothesis: requiredText, findings: z.array(z.object({ title: requiredText, body: requiredText, kind: z.enum(['evidence', 'inference', 'gap']), sourceIds: z.array(id).max(15) }).refine(f => f.kind !== 'evidence' || f.sourceIds.length > 0, '文献事实必须带有来源 ID')).min(1).max(40), experiment: textList, next: textList.refine(v => v.length > 0), completedAt: z.string().datetime() });
export const evaluationSchema = z.object({ decision: z.enum(['继续验证', '补充条件后继续', '暂停当前迁移']), reason: requiredText, dimensions: z.array(z.object({ name: requiredText, level: z.enum(['较强', '一般', '较弱', '待验证']), reason: requiredText })).min(1).max(10).refine(v => new Set(v.map(d => d.name)).size === v.length), contribution: requiredText });
export const confirmationSchema = z.object({ approved: z.literal(true), fingerprint: hash, at: z.string().datetime() });
export const runMetaSchema = z.object({ runId: z.string().min(1).max(200), inputRevision: z.number().int(), inputFingerprint: hash, provider: z.enum(['demo', 'remote', 'sciencepal']), status: z.literal('completed'), startedAt: z.string().datetime(), completedAt: z.string().datetime(), upstream: upstreamRunSchema.optional() });
export const stateSchema = z.object({ version: z.literal(1), step: z.number().int().min(0).max(5), context: draftContextSchema, analysis: analysisSchema.nullable(), plan: planSchema.nullable(), confirmation: confirmationSchema.nullable(), result: resultSchema.nullable(), evaluation: evaluationSchema.nullable() });
export type Context = z.infer<typeof contextSchema>;
export type Analysis = z.infer<typeof analysisSchema>;
export type Paper = z.infer<typeof paperSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Result = z.infer<typeof resultSchema>;
export type Evaluation = z.infer<typeof evaluationSchema>;
export type Workspace = z.infer<typeof stateSchema>;
export const blankProblem = { field: '', question: '', baseline: '', resources: '' };
export const exampleProblem = { field: '植物科学 · 马铃薯块茎发育多组学', question: '能否引入最优传输，研究马铃薯块茎形成过程中多组学状态的变化，并提出可验证的发育机制假说？', baseline: '已有研究主要比较差异基因和代谢物，希望进一步分析不同发育阶段状态分布之间的联系。', resources: '当前只有单个时期的多组学样本；可安排补充时期采样，样本对应关系、批次与组织来源仍需核对。' };
export function initialState(): Workspace {
  return { version: 1, step: 0, context: { revision: 1, problem: { ...blankProblem }, direction: 'transport', method: directions[0].method, sampleType: 'single', goal: 'mechanism', canCollect: true, evidence: 'unknown', note: '', mappings: [], papers: [] }, analysis: null, plan: null, confirmation: null, result: null, evaluation: null };
}
export function reviseContext(state: Workspace, patch: Partial<Context>, resetAnalysis = false): Workspace {
  return { ...state, step: Math.min(state.step, resetAnalysis ? 2 : 3), context: { ...state.context, ...patch, ...(resetAnalysis ? { mappings: [], papers: [] } : {}), revision: state.context.revision + 1 }, analysis: resetAnalysis ? null : state.analysis, plan: null, confirmation: null, result: null, evaluation: null };
}
export function canVisit(state: Workspace, step: number) {
  if (!Number.isInteger(step) || step < 0 || step > 5) return false;
  if (step === 0) return true;
  if (step === 1 || step === 2) return problemSchema.safeParse(state.context.problem).success;
  if (step === 3) return !!state.analysis;
  if (step === 4) return !!state.plan;
  return !!state.result;
}
export function hasValidCitations(result: Result, papers: Paper[]) {
  const known = new Set(papers.map(p => p.id));
  return result.findings.every(f => (f.kind !== 'evidence' || f.sourceIds.length > 0) && f.sourceIds.every(id => known.has(id)));
}
export async function restoreWorkspace(input: unknown): Promise<Workspace> {
  const saved = stateSchema.parse(input);
  const validProblem = problemSchema.safeParse(saved.context.problem).success;
  if (!validProblem) return { ...saved, step: 0, analysis: null, plan: null, confirmation: null, result: null, evaluation: null, context: { ...saved.context, mappings: [], papers: [] } };
  const current = await fingerprint(saved.context);
  if (!saved.analysis) {
    saved.plan = null;
    saved.context.mappings = [];
    saved.context.papers = [];
  }
  if (saved.plan?.fingerprint !== current) saved.plan = null;
  if (!saved.plan || saved.confirmation?.fingerprint !== current) saved.confirmation = null;
  if (!saved.confirmation || saved.result?.fingerprint !== current || (saved.result && !hasValidCitations(saved.result, saved.context.papers))) saved.result = null;
  if (!saved.result) saved.evaluation = null;
  while (!canVisit(saved, saved.step) && saved.step > 0) saved.step--;
  return saved;
}
export async function fingerprint(context: Context): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(contextSchema.parse(context)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}
export function reportMarkdown(state: Workspace, mode: 'demo' | 'remote' | 'mixed' | 'imported' = 'demo') {
  const { context: c, analysis, plan, result, evaluation: e } = state;
  const lines = ['# CrossLab 跨学科研究方案', `版本：${c.revision} · 导出时间：${new Date().toISOString()}`, '', `研究领域：${c.problem.field}`, `研究问题：${c.problem.question}`, `已有方法：${c.problem.baseline || '待补充'}`, `资源条件：${c.problem.resources || '待补充'}`, `跨界方法：${c.method}`, `证据类型：${c.evidence}`, '', '## 来源与范围', '运行模式见报告底部。论文事实、方法迁移推论与缺口分别列示；创新性需通过正式检索核查。', '', '## 初步假说', analysis?.hypothesis || '', '', '## 交互修正', c.note || '暂无补充说明', ...c.mappings.map(m => `- ${m.source} → ${m.target}；条件：${m.condition}；状态：${m.status}`), '', '## 已确认计划', ...(plan?.tasks || []).map(t => `- ${t}`), `确认时间：${state.confirmation?.at || '未确认'}`, '', '## 分析发现', ...(result?.findings || []).map(f => `- [${f.kind}] ${f.title}：${f.body} ${f.sourceIds.map(id => `[${id}]`).join(' ')}`), '', '## 最小验证', ...(result?.experiment || []).map((v, i) => `${i + 1}. ${v}`), '', '## 方案评估', e ? `${e.decision}：${e.reason}` : '尚未完成', ...(e?.dimensions || []).map(d => `- ${d.name}：${d.level}。${d.reason}`), `新增贡献：${e?.contribution || '待评估'}`, '', '## 参考文献', ...c.papers.map(p => `- [${p.id}] ${p.title} (${p.year}) ${p.url}\n  ${p.provenance}\n  贡献：${p.contribution}\n  适用范围：${p.boundary}`), '', '## 后续工作', ...(result?.next || []).map(t => `- ${t}`)];
  const modeDescription = {
    demo: '预置演示：使用规则、预置来源概要及用户提供的材料。用户摘要仅按提交内容复述，未读取其全文；本地演示未执行实时检索或实验。',
    remote: '外部工作流：分析由配置的服务端网关提供。各阶段的服务来源、运行 ID 与输入版本详见运行记录；SciencePal 的实际使用以对应项目和运行证据为准。',
    imported: '人工导入：分析结果由用户从外部工作流带回。各阶段来源、外部项目和运行凭据详见运行记录；本地格式校验与实际科研验证分别记录。',
    mixed: '混合运行：不同阶段使用了预置演示、外部服务或人工导入。各阶段的实际来源、运行 ID 与输入版本详见运行记录，按阶段判断证据范围。',
  }[mode];
  lines.push('## 运行模式', modeDescription, `数据结构：${c.sampleType}；研究目标：${c.goal}；可补采样：${c.canCollect ? '是' : '否'}`);
  return lines.join('\n\n');
}

