import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reviseContext, type Analysis, type Plan, type Result, type Evaluation } from '../lib/research';
import { resetForExample, applyExampleRevision } from '../lib/examples';
import { runShowcase } from '../lib/showcase';
import { buildResearchReport, reportToHtml, reportToMarkdown } from '../lib/report';

for (const id of ['potato-bulk','wheat-genomics']) test(`${id}: complete report preserves results, revision, citations and provenance in both exports`, async()=>{
  let s=resetForExample(initialState(),id);
  const a=(await runShowcase('analyze',s)).data as Analysis;
  s={...s,analysis:a,context:{...s.context,papers:a.papers,mappings:a.mappings}};
  const before=structuredClone(s);
  s=reviseContext(s,applyExampleRevision(s.context,id==='potato-bulk'?1:0));
  s.plan=(await runShowcase('plan',s)).data as Plan;
  s.confirmation={approved:true,fingerprint:s.plan.fingerprint,at:new Date().toISOString()};
  s.result=(await runShowcase('deep',s)).data as Result;
  s.evaluation=(await runShowcase('evaluate',s)).data as Evaluation;
  const report=buildResearchReport(s,[{action:'deep',provider:'demo',runId:'demo-test',inputRevision:s.context.revision,completedAt:s.result.completedAt}],[{state:before}]);
  const md=reportToMarkdown(report),html=reportToHtml(report);
  for(const expected of [s.result.hypothesis,s.plan.stop,s.context.note,before.context.problem.question,s.context.papers[0].url,'预置演示','demo-test']) assert.ok(md.includes(expected));
  assert.equal(report.sections.length,9);
  assert.ok(html.includes('完整研究报告'));
  assert.ok(report.sections[2].paragraphs.length>=5);
});
test('report exports escape untrusted source text and block incomplete workflows',()=>{
  const report={title:'<script>alert(1)</script>',subtitle:'source',sections:[{title:'Evidence',paragraphs:['<img src=x onerror=alert(1)> & "quote"']}]};
  const html=reportToHtml(report);
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;script&gt;'));
  assert.throws(()=>buildResearchReport(initialState(),[]),/先完成/);
});
