import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reviseContext, restoreWorkspace, type Workspace, type Analysis, type Plan, type Result, type Evaluation } from '../lib/research';
import { researchExamples, resetForExample, applyExampleRevision } from '../lib/examples';
import { runShowcase } from '../lib/showcase';

async function analyzed(id: string): Promise<Workspace> {
  const s = resetForExample(initialState(), id);
  const response = await runShowcase('analyze', s);
  const a = response.data as Analysis;
  return { ...s, step:3, analysis:a, context:{ ...s.context, papers:a.papers, mappings:a.mappings } };
}
for (const example of researchExamples) {
  test(`${example.id}: coherent complete workflow with explicit confirmation`, async () => {
    let s = await analyzed(example.id);
    assert.ok(s.context.problem.resources.includes('演示条件'));
    assert.ok(s.context.papers.length >= 2);
    s = reviseContext(s, applyExampleRevision(s.context, example.id === 'potato-bulk' ? 1 : 0));
    s.plan = (await runShowcase('plan',s)).data as Plan;
    await assert.rejects(runShowcase('deep',s), /确认/);
    s.confirmation = {approved:true,fingerprint:s.plan.fingerprint,at:new Date().toISOString()};
    s.result = (await runShowcase('deep',s)).data as Result;
    s.evaluation = (await runShowcase('evaluate',s)).data as Evaluation;
    s.step=5;
    assert.equal(s.evaluation.decision,'补充条件后继续');
    assert.equal(s.result.fingerprint,s.confirmation.fingerprint);
    assert.deepEqual(await restoreWorkspace(s),s);
    const revised=reviseContext(s,{note:s.context.note+' 新增修改'});
    assert.equal(revised.result,null);
    await assert.rejects(runShowcase('deep',revised),/确认/);
    const switched=resetForExample(s,example.id === 'potato-bulk'?'wheat-genomics':'potato-bulk');
    assert.equal(switched.analysis,null);assert.equal(switched.confirmation,null);assert.equal(switched.result,null);assert.deepEqual(switched.context.papers,[]);
  });
  test(`${example.id}: unmet assumptions produce a negative decision`,async()=>{
    let s=await analyzed(example.id);
    s=reviseContext(s,applyExampleRevision(s.context,example.id==='potato-bulk'?0:1));
    s.plan=(await runShowcase('plan',s)).data as Plan;
    s.confirmation={approved:true,fingerprint:s.plan.fingerprint,at:new Date().toISOString()};
    s.result=(await runShowcase('deep',s)).data as Result;
    assert.equal(((await runShowcase('evaluate',s)).data as Evaluation).decision,'暂停当前迁移');
  });
}
test('genomics example uses genomics papers, with no claimed model results',async()=>{
  const s=await analyzed('wheat-genomics');
  assert.deepEqual(s.context.papers.map(p=>p.id),['G1','G2']);
  assert.ok(s.analysis!.summary.includes('未执行训练'));
  assert.ok(s.analysis!.mappings.some(m=>m.condition.includes('同一材料')));
});
