import { type Context, type Paper, type Analysis, type Plan, type Result, type Evaluation, fingerprint } from './research';
import { genomicsAnalysis, genomicsPlan, genomicsDeep, genomicsEvaluation } from './genomics-demo';

const transport: Paper = { id: 'P6', title: 'Optimal-Transport Analysis of Single-Cell Gene Expression Identifies Developmental Trajectories in Reprogramming', year: '2019', url: 'https://doi.org/10.1016/j.cell.2019.01.006', role: '方法', contribution: '将最优传输用于单细胞基因表达时间序列，估计不同时间点状态分布之间的联系。', relevance: '为比较发育时期的状态分布提供方法参考，需重新设计马铃薯多组学的特征表示和代价函数。', boundary: '推断的状态联系需要相应数据与模型假设；单次采样不能据此重建真实发育时间轨迹，推断也不等同于真实细胞谱系。', provenance: '预置文献 · 附件提供的原始研究 DOI 与方法概要；全文参数尚待复核' };
const potato: Paper = { id: 'P7', title: 'Transcriptomics combined with physiological analysis and metabolomics revealed the response of potato tuber formation to nitrogen', year: '2024', url: 'https://link.springer.com/article/10.1186/s12870-024-05758-2', role: '背景', contribution: '结合转录组、生理分析与代谢组，研究不同氮条件下马铃薯块茎形成的共表达基因与潜在通路。', relevance: '为马铃薯块茎形成的多组学变量选择与条件设计提供本领域参考。', boundary: '研究场景为氮处理下的块茎形成；该研究不直接验证最优传输方法或发育轨迹推断。', provenance: '预置文献 · 已核对公开摘要' };
const network: Paper = { id: 'P1', title: 'From hairballs to hypotheses–biological insights from microbial networks', year: '2018', url: 'https://doi.org/10.1093/femsre/fuy030', role: '方法', contribution: '综述微生物网络推断如何帮助形成生物学假说，并讨论解释网络结构时的限制。', relevance: '用于审查“网络边代表什么”，并设计后续验证。', boundary: '共现关系需要结合额外证据才能解释为直接生态作用。', provenance: '预置文献 · 已核对公开综述内容' };
const root: Paper = { id: 'P2', title: 'Drought and host selection influence bacterial community dynamics in the grass root microbiome', year: '2017', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5702725/', role: '背景', contribution: '比较禾本科植物根部及根际的细菌群落，研究干旱与宿主选择的影响。', relevance: '为干旱下根部微生物研究提供背景和实验分组启发。', boundary: '研究对象为禾本科植物；对马铃薯的适用性需要另行检验。', provenance: '预置文献 · 已核对公开论文内容' };
const traffic: Paper = { id: 'P3', title: 'Route choice, travel time variability, and rational inattention', year: '2020', url: 'https://doi.org/10.1016/j.trb.2019.05.020', role: '跨界案例', contribution: '将有成本的信息获取引入路径选择，并扩展到出行者网络均衡。', relevance: '展示“外领域机制—原有假设调整—新模型”的迁移路径。', boundary: '行为决策模型中的主体和效用，迁移到生物系统时必须重新定义。', provenance: '预置文献 · 已核对作者公开稿' };
const diffusion: Paper = { id: 'P4', title: 'Spatial organization in microbial range expansion emerges from trophic dependencies and successful lineages', year: '2020', url: 'https://www.nature.com/articles/s42003-020-01409-y', role: '方法', contribution: '研究营养依赖与空间生长格局的联系，并建模局部营养与代谢物扩散。', relevance: '用于提出“空间传输条件影响群落响应”的候选机制。', boundary: '培养体系与真实土壤的孔隙结构和参数存在差异。', provenance: '预置文献 · 已核对公开摘要' };
const attention: Paper = { id: 'P5', title: 'Travel time variability and rational inattention', year: '2019', url: 'https://doi.org/10.1016/j.trb.2018.12.003', role: '方法', contribution: '将信息获取策略纳入随机旅行时间下的出发时间选择。', relevance: '为带有信息成本的采样或管理决策提供建模参考。', boundary: '需明确谁做决策、接收什么信息以及优化什么结果。', provenance: '预置文献 · 已核对公开摘要' };

export function analyze(c: Context): Analysis {
  if (c.direction === 'genomics') return genomicsAnalysis(c);
  const custom = c.direction === 'custom';
  const targetFitsExample = c.direction === 'transport' ? /马铃薯|块茎/.test(c.problem.field + c.problem.question) : /微生物|根际|群落/.test(c.problem.field + c.problem.question);
  const ideas = {
    transport: { hypothesis: c.sampleType === 'timeSeries' ? '在核对时间点、样本单位、特征可比性与增长/死亡假设后，比较相邻发育时期的状态分布；检验候选状态联系能否在独立样本和实验中得到支持。' : '先比较可比样本的多组学状态分布；若要研究发育时间过程，需补充多时期数据，再检验状态联系与机制假说。', sources: ['状态分布', '传输代价', '时间与质量变化'], targets: ['各时期或各条件下的可比多组学样本', '表达或代谢特征之间具有生物学解释的距离', '实际采样时期与生长、死亡或取样比例变化'], conditions: ['明确 bulk 或单细胞单位、组织来源与生物重复', '核对归一化、批次效应与组学配准方式', '过程分析需要多时期数据，并核查质量守恒或非平衡设定'] },
    network: { hypothesis: '在控制群落丰度与环境差异后，候选网络瓶颈与干旱响应之间仍存在可重复关系；进一步通过干预检验瓶颈的作用。', sources: ['节点', '连接关系', '扰动与鲁棒性'], targets: ['微生物类群或功能单元', '统计关联，或由实验支持的资源交换关系', '干旱处理下的群落响应与恢复'], conditions: ['统一类群分辨率与采样尺度', '先明确边的含义；关联与交换分别建模', '定义可测结果并设置对照组'] },
    diffusion: { hypothesis: '空间传输尺度能够解释部分均匀混合模型未解释的群落响应差异，可通过改变几何结构或含水条件进行检验。', sources: ['浓度场', '传输参数', '反应项'], targets: ['根际局部营养物或代谢物浓度', '介质中的有效扩散参数', '微生物消耗与生产速率'], conditions: ['获得空间或时间分辨测量', '明确孔隙、含水率与尺度', '用实验估计参数并检查单位'] },
    attention: { hypothesis: '在采样或管理决策中，信息处理成本影响信息使用策略；改变成本后，策略与决策结果随之变化。', sources: ['决策主体', '信息成本', '行动与效用'], targets: ['研究者或种植管理者', '采样、理解与处理信息的成本', '采样或管理行动及其结果'], conditions: ['明确主体；若研究生物感知需另行建立机制', '测量成本或设计可识别的代理变量', '设置充分信息与固定策略基线'] },
    custom: { hypothesis: `围绕“${c.problem.question}”，检验“${c.method}”的核心机制能否解释现有方法尚未解释的现象。`, sources: ['外领域研究对象', '核心机制或算法', '适用条件'], targets: ['请填写本领域的对应对象', '请填写可测变量与机制关系', '请填写目标数据与实验条件'], conditions: ['需要提供该方法的来源论文', '说明迁移后保留与调整的假设', '设定可区分于基线的新预测'] },
  }[c.direction];
  const generic = !custom && !targetFitsExample && c.direction !== 'attention';
  return { summary: `围绕“${c.problem.field}”，借鉴“${c.method}”建立可审查的迁移关系。${generic ? '目标领域超出预置案例，以下保留方法结构，目标变量由研究者填写。' : '以下为预置示例分析，请结合研究条件修正。'}`, hypothesis: generic ? `检验“${c.method}”能否为“${c.problem.question}”提供可测量、可区分于现有方法的新解释。` : ideas.hypothesis, papers: custom ? [traffic] : c.direction === 'transport' ? [potato, transport] : c.direction === 'attention' ? [attention, traffic] : generic ? [network] : c.direction === 'diffusion' ? [root, diffusion, network] : [network, root, traffic], mappings: ideas.sources.map((s, i) => ({ id: `M${i + 1}`, source: s, target: generic ? `待填写：${c.problem.field} 中与“${s}”对应的对象或变量` : ideas.targets[i], condition: ideas.conditions[i], status: 'pending' })), questions: c.direction === 'transport' ? ['样本是单次采样、多时期采样，还是尚无数据？样本单位为 bulk 还是单细胞？', '目标是分布比较、预测还是发育机制？能否补充缺失时期与生物重复？'] : ['现有数据支持统计关联、方向性关系，还是直接机制证据？', '哪一项关键条件已经满足，哪一项需要补充？'] };
}
export async function makePlan(c: Context): Promise<Plan> {
  if (c.direction === 'genomics') return genomicsPlan(c);
  return { fingerprint: await fingerprint(c), questions: [c.problem.question, `“${c.method}”在目标问题中的前提是否成立？`, '最近邻工作已经解决什么，新增贡献在哪里？'], searches: [`建议检索（未执行）：${c.problem.field} ${c.method}`, `建议检索（未执行）：${c.method} assumptions limitations`, `建议检索（未执行）：${c.problem.field} intervention validation`], tasks: ['整理已选文献记录中的贡献、适用范围与对应主张；分别标明预置来源或用户材料', c.direction === 'transport' ? '按用户声明的条件检查采样时期、bulk/单细胞单位、特征可比性、传输代价及增长/死亡假设' : '对照用户修正，检查迁移前提和缺失证据', '形成候选预测、基线与最小验证方案，列出仍需正式检索的事项'], stop: c.direction === 'transport' ? '单次采样且无法补样时，暂停真实发育过程重建；另行评估分布比较。关键映射被否定时重建对应关系。' : '关键前提被否定时停止该迁移；缺少证据时列出补充条件。', scope: `根据已选 ${c.papers.length} 条文献记录及 ${c.mappings.length} 项映射执行规则演示。用户材料仅复述所提供的摘要，未读取其全文，也未自动核验其中的主张。检索式是待执行建议；本轮不执行实时检索或实验。` };
}
export async function deepResearch(c: Context): Promise<Result> {
  if (c.direction === 'genomics') return genomicsDeep(c);
  const rejected = c.mappings.filter(m => m.status === 'rejected');
  const isTransport = c.direction === 'transport';
  const processBlocked = isTransport && c.goal === 'mechanism' && c.sampleType !== 'timeSeries' && !c.canCollect;
  const hypothesis = processBlocked ? '当前暂停真实发育时间过程的重建；可将问题改为可比样本之间的状态分布比较，并明确其统计解释范围。' : c.direction === 'network' && c.evidence !== 'functional' && /微生物|根际|群落/.test(c.problem.field + c.problem.question) ? '以统计关联网络筛选候选瓶颈，并通过独立数据和干预实验验证其与群落响应的关系。' : analyze(c).hypothesis;
  const transportGap = c.sampleType === 'none' ? '尚无数据。先落实数据获取方案，并确认样本单位与采样时期。' : c.sampleType === 'single' ? `当前为单次采样，支持范围需限定在可比样本的分布分析。${c.canCollect ? '可补样：先设计多时期采样，再评估发育过程建模。' : '无法补样：暂停真实发育时间轨迹重建；分布比较可作为另一个研究问题评估。'}` : '多时期数据满足了时间信息这一条件；还需核查时期覆盖、生物重复、批次、组织一致性、特征空间和生长/死亡假设。';
  return { fingerprint: await fingerprint(c), hypothesis, completedAt: new Date().toISOString(), findings: [
    ...c.papers.map(p => ({ title: p.title, body: p.contribution, kind: 'evidence' as const, sourceIds: [p.id] })),
    { title: '迁移推论', body: hypothesis, kind: 'inference', sourceIds: [] },
    { title: '条件审查', body: rejected.length ? `用户已否定：${rejected.map(m => m.source).join('、')}。当前迁移需暂停，重建这些映射。` : isTransport ? transportGap : c.evidence === 'unknown' ? '证据类型尚不明确，先确认可测变量和数据来源。' : c.evidence === 'association' ? '现有材料支持关联层面的候选筛选。因果或资源流解释需要额外测量或干预。' : '用户声明具有机制或功能数据，需核对测量定义、质量与重复性。', kind: 'gap', sourceIds: [] },
    { title: '目标领域证据缺口', body: '本轮预置材料尚未完成目标领域的系统检索。需补充目标组织、时期和数据类型的直接来源，并检查已有交叉研究。', kind: 'gap', sourceIds: [] },
    { title: '用户修正已纳入', body: c.note || '当前没有补充说明；按已审查映射制定验证方案。', kind: 'inference', sourceIds: [] },
  ], experiment: processBlocked ? ['将研究目标调整为状态分布比较，并明确可比较的组别与独立重复。', '用差异分析或常规距离度量作为基线，评估传输代价对特征选择、批次和距离定义的敏感性。', '报告分布层面的差异及不确定性；若未来获得时间序列，再重新建立过程建模计划。'] : [
    `固定研究问题：${c.problem.question}`,
    `设置基线：${c.problem.baseline || '补充本领域常用模型或常规实验作为对照'}。比较引入 ${c.method} 后是否增加解释或预测能力。`,
    `测量关键对应关系：${c.mappings.map(m => m.target).join('；')}。明确单位、时间尺度与样本独立性。`,
    ...(isTransport ? [c.sampleType === 'timeSeries' ? '审查时期覆盖、组织与样本质量、组学配准、特征尺度和批次；比较平衡与非平衡传输假设，检查增长/死亡敏感性。' : c.canCollect ? '先补充有生物重复的多时期样本，记录组织与批次；形成满足目标分析的数据后再估计时期之间的联系。' : '将验证限定在已有条件的分布比较或横截面预测，明确其目标和适用范围。'] : []),
    '在独立样本上验证预测，并预先指定指标；需要机制结论时增加针对性的干预与阴性对照。',
    `资源条件：${c.problem.resources || '尚未提供，先确认数据、实验条件和预算'}。先进行小规模验证，再决定是否扩大研究。`,
  ], next: rejected.length ? ['重新定义被否定的迁移关系', '修改后生成并确认新计划'] : processBlocked ? ['选择分布比较这一可行替代目标', '修改研究问题并确认新计划', '若可获取多时期数据，再恢复发育过程研究'] : ['检索并比较最近邻研究，核查新增贡献', '补充目标物种或体系的直接证据', '由研究者复核验证设计、资源与可实施性'] };
}
export function evaluate(c: Context): Evaluation {
  if (c.direction === 'genomics') return genomicsEvaluation(c);
  const rejected = c.mappings.some(m => m.status === 'rejected');
  const pending = c.mappings.some(m => m.status === 'pending');
  const processBlocked = c.direction === 'transport' && c.goal === 'mechanism' && c.sampleType !== 'timeSeries' && !c.canCollect;
  const noData = c.sampleType === 'none' && !c.canCollect;
  const strong = c.evidence === 'functional' && !pending && !rejected && !!c.problem.resources.trim() && c.sampleType !== 'none' && !processBlocked;
  return { decision: rejected || processBlocked || noData ? '暂停当前迁移' : strong ? '继续验证' : '补充条件后继续', reason: rejected ? '至少一个关键迁移前提被用户否定。先调整映射或更换借鉴方向。' : processBlocked ? '当前数据缺少多时期信息且无法补样，暂停真实发育时间过程重建。状态分布比较仍可作为替代目标另行评估。' : noData ? '尚无数据且无法采集，需先找到可用的公开数据或调整研究目标。' : strong ? '已声明数据条件并完成映射审查，可进入最小验证；仍需核对样本、数据质量与模型假设，结论由验证判定。' : '当前可形成候选方案，仍需补充数据条件或完成迁移审查。', dimensions: [
    { name: '迁移合理性', level: rejected ? '较弱' : pending ? '待验证' : '一般', reason: rejected ? '存在被否定的关键前提。' : pending ? '部分映射仍待确认。' : '映射已由用户审查，适用性需通过验证。' },
    { name: '创意性', level: '待验证', reason: '需完成最近邻检索，区分方法复用与新的研究贡献。' },
    { name: '可行性', level: processBlocked || noData ? '较弱' : strong ? '一般' : '待验证', reason: processBlocked ? '当前条件不支持真实发育时间过程重建，需调整目标或补充时间数据。' : noData ? '缺少可执行的数据获取方案。' : strong ? '用户已声明功能数据与资源条件，下一步核对质量、假设与成本。' : '数据、测量或实验资源仍需具体确认。' },
    { name: '方案完善度', level: '一般', reason: '已有问题、映射、基线和验证步骤；样本量与参数设计待完善。' },
    { name: '证据覆盖', level: '待验证', reason: `当前选用 ${c.papers.length} 篇材料，尚未完成系统检索与目标场景覆盖核查。` },
  ], contribution: `候选贡献是明确“${c.method}”在“${c.problem.field}”中的适用条件，并检验其相对现有方法的增益。` };
}
