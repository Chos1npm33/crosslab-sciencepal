import type { Workspace } from './research';

export type ReportRun = { action: string; provider: string; runId: string; inputRevision: number; completedAt: string; projectUrl?: string; upstream?: { provider: string; projectUrl: string }; clarifications?: { question: string; answer: string; accepted: boolean }[] };
export type ReportSection = { title: string; paragraphs: string[]; ordered?: boolean };
export type ResearchReport = { title: string; subtitle: string; sections: ReportSection[] };
const kindLabel = { evidence: '文献依据', inference: '迁移推论', gap: '证据缺口' };
const statusLabel = { accepted: '认可', pending: '待核实', rejected: '否定' };

export function buildResearchReport(state: Workspace, runs: ReportRun[], history: { state: Workspace }[] = []): ResearchReport {
  const { context: c, plan, result, evaluation } = state;
  if (!plan || !state.confirmation || !result || !evaluation) throw new Error('请先完成当前版本的确认、深研和评估，再查看完整报告。');
  const before = [...history].reverse().find(h => h.state.context.problem.field === c.problem.field && h.state.context.direction === c.direction && (h.state.context.problem.question !== c.problem.question || h.state.context.note !== c.note))?.state;
  const sources = ['analyze', 'plan', 'deep', 'evaluate'].map(action => {
    const run = runs.filter(r => r.action === action).at(-1);
    return `${action}：${run?.upstream?.provider || (run?.provider === 'demo' ? '预置演示' : run?.provider || '来源待核对')}`;
  });
  const sections: ReportSection[] = [
    { title: '01 / 最终结论', paragraphs: [`${evaluation.decision}：${evaluation.reason}`, `修订后的研究假说：${result.hypothesis}`, `候选新增贡献：${evaluation.contribution}`] },
    { title: '02 / 修订前后发生了什么', paragraphs: [before ? `修订前的问题：${before.context.problem.question}` : '本报告未保存可比较的前一版本；以下按当前研究条件说明。', ...(before ? [`修订前的判断：${before.evaluation ? `${before.evaluation.decision}；${before.evaluation.reason}` : before.result?.hypothesis || before.analysis?.hypothesis || '尚未生成判断。'}`] : []), `本次修订：${c.note || '未填写额外修订说明。'}`, `当前问题：${c.problem.question}`, ...c.mappings.map(m => `${m.source} → ${m.target}｜${statusLabel[m.status]}。成立条件：${m.condition}`)] },
    { title: '03 / 具体发现与证据', paragraphs: result.findings.filter(f => f.kind !== 'gap').map(f => `【${kindLabel[f.kind]}】${f.title}\n${f.body}${f.sourceIds.length ? `\n依据：${f.sourceIds.map(id => `[${id}]`).join(' ')}` : ''}`) },
    { title: '04 / 已确认的研究范围', paragraphs: [`研究领域：${c.problem.field}`, `方法：${c.method}`, `已有方法／基线：${c.problem.baseline || '待补充'}`, `资源与数据：${c.problem.resources || '待补充'}`, `研究范围：${plan.scope}`, `确认时间：${state.confirmation.at}`, ...plan.questions.map(q => `待回答问题：${q}`), ...plan.tasks.map(t => `已确认任务：${t}`)] },
    { title: '05 / 最小验证方案与判定标准', paragraphs: [...result.experiment, `停止条件：${plan.stop}`], ordered: true },
    { title: '06 / 方案评估', paragraphs: evaluation.dimensions.map(d => `${d.name} · ${d.level}\n${d.reason}`) },
    { title: '07 / 证据缺口与后续工作', paragraphs: [...result.findings.filter(f => f.kind === 'gap').map(f => `${f.title}：${f.body}`), ...result.next.map(t => `下一步：${t}`)] },
    { title: '08 / 参考文献与阅读范围', paragraphs: c.papers.map(p => `[${p.id}] ${p.title} (${p.year})\n${p.url}\n贡献：${p.contribution}\n适用边界：${p.boundary}\n来源：${p.provenance}`) },
    { title: '09 / 运行记录与来源', paragraphs: [...sources, ...runs.map(r => `${r.action}｜${r.upstream?.provider || r.provider}｜输入 v${r.inputRevision}\n运行编号：${r.runId}\n完成时间：${r.completedAt}${r.upstream?.projectUrl || r.projectUrl ? `\n项目：${r.upstream?.projectUrl || r.projectUrl}` : ''}`), ...runs.flatMap(r => (r.clarifications || []).map(q => `SciencePal 追问：${q.question}\n用户回答：${q.answer}\n${q.accepted ? '平台已接收' : '接收状态待核对'}`)), '来源按阶段记录。“预置演示”使用已整理的文献概要与条件规则；SciencePal 实测记录可按原始运行编号核验。本文的研究设计与文献结论，不表示已完成新的数据计算或生物学实验。'] },
  ];
  return { title: `${c.problem.field} · 完整研究报告`, subtitle: `CrossLab · v${c.revision} · ${sources.join(' / ')}`, sections };
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function reportToMarkdown(report: ResearchReport) {
  return `# ${report.title}\n\n${report.subtitle}\n\n` + report.sections.map(s => `## ${s.title}\n\n` + s.paragraphs.map((p, i) => `${s.ordered ? `${i + 1}. ` : ''}${p}`).join('\n\n')).join('\n\n');
}
export function reportToHtml(report: ResearchReport) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(report.title)}</title><style>body{margin:0;background:#f4f6ef;color:#203a31;font:16px/1.9 system-ui,"Microsoft YaHei",sans-serif}main{max-width:920px;margin:40px auto;padding:42px;background:white;border:1px solid #dce3d6;border-radius:14px}h1{font-size:30px;line-height:1.4}h2{font-size:21px;border-bottom:1px solid #dce3d6;padding-bottom:10px;margin-top:38px}p,li{white-space:pre-wrap;overflow-wrap:anywhere}header p{font-size:12px;color:#63766b}nav{display:flex;flex-wrap:wrap;gap:8px;margin:24px 0}a{color:#23634b}nav a{font-size:13px;background:#edf3e6;padding:5px 10px;border-radius:5px;text-decoration:none}section>p,li{padding:15px 18px;background:#fafbf7;border-left:3px solid #b4c9a2;border-radius:3px}ol{padding-left:24px}@media(max-width:650px){main{margin:0;padding:22px;border:0}h1{font-size:24px}}@media print{body,main{background:white}main{max-width:none;margin:0;padding:0;border:0}nav{display:none}h2{break-after:avoid}section>p,li{background:white;break-inside:avoid}a{color:inherit}@page{size:A4;margin:18mm}}</style><main><header><h1>${escape(report.title)}</h1><p>${escape(report.subtitle)}</p><p>包含具体发现、证据、修订前后结论、验证方案和运行记录。可用浏览器打印功能保存为 PDF。</p></header><nav>${report.sections.map((s,i)=>`<a href="#s${i}">${escape(s.title)}</a>`).join('')}</nav>${report.sections.map((s,i)=>`<section id="s${i}"><h2>${escape(s.title)}</h2>${s.ordered ? '<ol>' : ''}${s.paragraphs.map(p=>`<${s.ordered ? 'li' : 'p'}>${escape(p)}</${s.ordered ? 'li' : 'p'}>`).join('')}${s.ordered ? '</ol>' : ''}</section>`).join('')}</main></html>`;
}
