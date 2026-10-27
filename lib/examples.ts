import { initialState, directions, type Context, type Workspace } from './research';

export const researchFields = ['植物科学', '基因组学', '微生物学', '生物化学', '环境科学', '材料科学'];
export const researchExamples = [
  {
    id: 'potato-bulk', title: '马铃薯 bulk 多组学 × 最优传输', subtitle: '从单时期数据出发，审查发育轨迹能否成立',
    fields: ['植物科学', '基因组学'], direction: 'transport' as const,
    problem: {
      field: '植物科学 · 马铃薯 bulk 多组学',
      question: '能否用最优传输比较不同氮处理下马铃薯块茎的 bulk 转录组与代谢组状态，并推断块茎形成的发育过程？',
      baseline: '差异表达、差异代谢物与通路富集；用常规距离和 PCA 比较处理组，作为最优传输的基线。',
      resources: '演示条件：单个发育时期、不同氮处理的 bulk 转录组和代谢组；组学配对、批次与生物重复待核对，目前无法新增时期采样。未上传实验数据。',
    }, sampleType: 'single' as const, goal: 'mechanism' as const, canCollect: false,
    hints: ['选择案例后，问题、已有方法、资源和推荐方向会一起填入。', '推荐最优传输；先明确样本单位为 bulk，而不是单细胞。', '对照块茎多组学论文与 Waddington-OT：原方法的数据条件能否迁移？', '试选“暂停过程重建”或“转为分布比较”，观察研究目标如何变化。', '检查停止条件，再主动确认。修订后必须生成并确认新计划。', '比较暂停与有条件继续两种结果。创新性保留为待验证。'],
    revisions: [
      { title: '暂停发育过程重建', detail: '保留机制目标；单时期且不能补样。', goal: 'mechanism' as const, note: '确认只有单时期 bulk 数据，无法补充时期。bulk 样本不对应单细胞，处理差异不代表时间变化；当前不能据此重建真实发育过程。' },
      { title: '转为处理组分布比较', detail: '收缩目标；先核对生物重复与距离定义。', goal: 'prediction' as const, note: '将目标修订为不同氮处理下 bulk 样本状态的分布比较。先核对组学配对、生物重复与批次，以 PCA 和常规距离为基线；不将传输耦合解释为细胞谱系或真实发育轨迹。' },
    ],
  },
  {
    id: 'wheat-genomics', title: '小麦基因组育种 × 深度学习', subtitle: '从 SNP 预测表型，用严格划分检验模型增益',
    fields: ['植物科学', '基因组学'], direction: 'genomics' as const,
    problem: {
      field: '基因组学 · 小麦基因组预测',
      question: '将卷积神经网络引入小麦 SNP 基因型到籽粒产量的预测，在家系隔离和留出年份验证下，是否仍优于 RR-BLUP 基线？',
      baseline: 'RR-BLUP／GBLUP 和训练集均值；所有模型使用相同训练、验证与测试划分，并比较 Pearson r、RMSE 与计算成本。',
      resources: '演示条件：计划复用公开小麦 SNP 与多年份田间表型，保留材料、家系、年份和环境标识；数据许可、样本对应、缺失率与计算资源待核对。尚未下载或训练。',
    }, sampleType: 'timeSeries' as const, goal: 'prediction' as const, canCollect: false,
    hints: ['选择案例后，自动填入 SNP、表型、数据条件和预测目标。', '推荐卷积神经网络与基因组预测；RR-BLUP 保留为基线。', '查看 DeepGS 与独立年份验证论文：已有方法解决了什么，还缺什么？', '选择严格验证方案：按家系分组，留出年份，预处理只拟合训练数据。', '确认基线、划分、指标和停止条件后，生成可执行研究方案。', '重点判断验证设计是否充分。演示不提供虚构的模型精度。'],
    revisions: [
      { title: '按家系与年份严格验证', detail: '固定测试集；在训练集内部调参。', goal: 'prediction' as const, note: '外层按家系分组并留出年份；同一材料的重复记录不得跨训练测试集。缺失填补、标准化和 SNP 筛选只拟合训练折，超参数在内层验证选择。用同一划分比较 CNN 与 RR-BLUP，报告 Pearson r、RMSE、置信区间和计算成本。' },
      { title: '缺少家系或年份标识', detail: '先补齐元数据，暂不主张跨群体泛化。', goal: 'prediction' as const, note: '目前缺少可核对的家系或年份标识。暂停跨家系、跨年份泛化主张；先补齐材料对应和元数据，随机划分只能用于初步流程检查。' },
    ],
  },
] as const;
export type ResearchExample = typeof researchExamples[number];
export function exampleContext(id: string): Context {
  const e = researchExamples.find(item => item.id === id);
  if (!e) throw new Error('未知研究案例');
  return { ...initialState().context, problem: { ...e.problem }, direction: e.direction,
    method: directions.find(d => d.id === e.direction)!.method, sampleType: e.sampleType,
    goal: e.goal, canCollect: e.canCollect, evidence: 'association' };
}
export function matchingExample(c: Context) {
  return researchExamples.find(e => e.problem.field === c.problem.field && e.direction === c.direction);
}
export function applyExampleRevision(c: Context, index: number): Context {
  const e = matchingExample(c); const revision = e?.revisions[index];
  if (!e || !revision) return c;
  const comparison = e.id === 'potato-bulk' && index === 1;
  return { ...c, problem: { ...c.problem, question: comparison ? '能否用最优传输比较不同氮处理下马铃薯 bulk 转录组与代谢组的状态分布，并检验相对 PCA 和常规距离的增益？' : e.problem.question }, goal: revision.goal, note: revision.note, evidence: 'association',
    mappings: c.mappings.map((m,i) => ({ ...m,
      ...(e.id === 'potato-bulk' && i === 2 ? comparison ? { source:'处理组与质量设定',target:'不同氮处理下的独立 bulk 样本分布',condition:'核对生物重复、组学配对与批次；本次比较不解释为真实时间过程。' } : {source:'时间与质量变化',target:'实际采样时期与生长、死亡或取样比例变化',condition:'过程分析需要多时期数据，并核查质量守恒或非平衡设定'} : {}),
      status: i === 2 && index === (e.id === 'potato-bulk' ? 0 : 1) ? 'rejected' : 'pending' })) };
}
export function resetForExample(state: Workspace, id: string): Workspace {
  return { ...initialState(), context: { ...exampleContext(id), revision: state.context.revision + 1 } };
}
