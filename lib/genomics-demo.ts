import { fingerprint, type Context, type Analysis, type Plan, type Result, type Evaluation } from './research';

export function genomicsAnalysis(c: Context): Analysis {
  return {
    summary: '小麦 SNP 到表型预测的预置文献分析。DeepGS 已研究这一方向，新增贡献须落到明确的验证设计与目标场景；本轮未执行训练或最新文献检索。',
    hypothesis: '在固定的家系隔离与留出年份测试中，检验 CNN 相对 RR-BLUP 的预测增益是否稳定，并量化增益的不确定性与计算成本。',
    papers: [
      { id:'G1',title:'A deep convolutional neural network approach for predicting phenotypes from genotypes',year:'2018',url:'https://doi.org/10.1007/s00425-018-2976-9',role:'方法',contribution:'提出 DeepGS，用卷积神经网络从基因型预测表型，并研究与 RR-BLUP 集成的互补性。',relevance:'提供 SNP 编码、神经网络预测与线性基线比较的起点。',boundary:'已有 AI + 基因组预测工作；采用 CNN 本身不能视为新的科研贡献，其结果不能直接外推到当前数据。',provenance:'预置文献 · 已核对 PubMed 摘要与作者代码仓库'},
      { id:'G2',title:'Deep Learning for Predicting Complex Traits in Spring Wheat Breeding Program',year:'2020',url:'https://doi.org/10.3389/fpls.2020.613325',role:'背景',contribution:'在春小麦育种群体中比较 MLP、CNN 与 rrBLUP，并通过交叉验证及独立年份预测评估复杂性状。',relevance:'为本案例区分随机划分与未来年份预测提供实验设计参考。',boundary:'预测性能依赖性状、环境与群体；本案例尚未复现模型或获得性能结果。',provenance:'预置文献 · 已核对公开论文的验证设计'},
    ],
    mappings: [
      {id:'M1',source:'输入特征',target:'统一材料标识与等位基因编码的 SNP 矩阵',condition:'处理缺失率、等位基因方向、标记顺序；预处理只拟合训练数据。',status:'pending'},
      {id:'M2',source:'预测标签与损失',target:'经过明确环境校正定义的小麦籽粒产量',condition:'核对样本对应、表型单位与重复测量；避免测试标签参与特征选择。',status:'pending'},
      {id:'M3',source:'泛化与验证',target:'未参与训练的家系或年份中的材料',condition:'记录家系、年份与环境；同一材料的重复不得跨集合，调参和最终测试分离。',status:'pending'},
    ], questions:['能否提供材料、家系、年份和环境标识，以设计独立验证？','希望预测同群体新材料，还是新家系／未来年份？计算预算和基线是什么？'],
  };
}
export async function genomicsPlan(c: Context): Promise<Plan> {
  return { fingerprint:await fingerprint(c), questions:[c.problem.question,'家系和年份隔离后，预测增益是否仍成立？'], searches:['建议检索（未执行）：wheat genomic prediction CNN RR-BLUP independent validation','建议检索（未执行）：wheat genomic prediction family split environment generalization'], tasks:['核对 SNP、表型与元数据对应，记录数据许可和缺失率','冻结家系与年份测试集；训练折内完成预处理、特征筛选与调参','用同一划分比较 CNN、RR-BLUP 与均值基线，报告相关系数、RMSE、不确定性和计算成本','检查最近邻工作，区分已有算法复用与目标场景中的新增证据'], stop:'缺少家系／年份元数据时，暂停跨家系或跨年份泛化主张；若增益不稳定或低于基线，保留否定结果。', scope:'按预置论文概要与用户条件生成研究计划。本轮没有下载数据、训练 CNN 或计算预测精度。' };
}
export async function genomicsDeep(c: Context): Promise<Result> {
  const blocked=c.mappings.some(m=>m.status==='rejected');
  return { fingerprint:await fingerprint(c),completedAt:new Date().toISOString(),hypothesis:blocked?'先补齐被否定的映射条件；在元数据与样本对应可核对之前，暂停跨家系／年份泛化主张。':genomicsAnalysis(c).hypothesis,
    findings:[...c.papers.map(p=>({title:p.title,body:p.contribution,kind:'evidence' as const,sourceIds:[p.id]})),
      {title:'迁移推论',body:'以统一 SNP 编码作为网络输入，以产量为预测标签；模型学习的关联不能直接解释为基因作用机制。',kind:'inference',sourceIds:[]},
      {title:'验证条件',body:blocked?'已有关键映射被否定，先补足数据条件。':'需核对家系、年份、环境和材料重复；随机划分中的亲缘关系会影响测试解释。',kind:'gap',sourceIds:[]},
      {title:'用户修订',body:c.note||'尚未补充验证划分。请明确目标部署人群或年份。',kind:'inference',sourceIds:[]},
      {title:'本次审查得到的具体结论',body:'CNN 已有基因组预测先例，当前可检验的问题是：在家系隔离与留出年份后，它相对 RR-BLUP 的增益是否仍成立。随机划分结果与未来年份预测分别报告，不能用前者替代后者。',kind:'inference',sourceIds:c.papers.filter(p=>['G1','G2'].includes(p.id)).map(p=>p.id)},
      {title:'可以交付的比较结果结构',body:'后续每个测试划分输出“真实产量、均值基线预测、RR-BLUP 预测、CNN 预测”四列；在同一测试材料上计算 Pearson r、RMSE 和配对误差差值，并报告重采样不确定性、耗时与按家系／年份的误差。当前交付的是这套可执行验证设计，表中数值等待真实训练。',kind:'inference',sourceIds:[]},
      {title:'判定规则与否定结果',body:'将“相对 RR-BLUP 改善预测误差且跨划分稳定”作为待检验条件。若 CNN 的优势随年份或家系划分消失，报告场景依赖或没有稳定增益；若缺少关键元数据，暂停相应泛化结论。样本、超参数和测试划分应在运行前固定。',kind:'inference',sourceIds:[]},
      {title:'尚未获得的结果',body:'没有模型训练结果、性能增益或实验发现。最近邻检索与独立复现仍待执行。',kind:'gap',sourceIds:[]}],
    experiment:['核对公开数据许可、SNP 质控、材料对应与表型单位。','预先冻结按家系／年份隔离的测试集；相同材料的重复记录保持在同一侧。','在训练折内拟合缺失填补、标准化和 SNP 筛选；使用内层验证调参。','用完全相同的数据划分比较均值基线、RR-BLUP／GBLUP 与 CNN。','报告 Pearson r、RMSE、置信区间与计算成本；按家系和年份分层检查误差。','若增益不稳定、置信区间无法支持改善或数据泄漏无法排除，保留否定结果。'],next:blocked?['补齐缺失元数据','重新审查映射并确认计划']:['检索最近邻工作并核查候选贡献','运行独立数据验证','公开划分、代码、参数与负面结果'] };
}
export function genomicsEvaluation(c: Context): Evaluation {
 const blocked=c.mappings.some(m=>m.status==='rejected');
 return {decision:blocked?'暂停当前迁移':'补充条件后继续',reason:blocked?'关键映射条件不成立，先补齐数据和验证条件，再评估跨群体泛化。':'研究方案已形成；尚需核对元数据、执行训练并检验相对基线的增益。',dimensions:[
  {name:'迁移合理性',level:blocked?'较弱':'一般',reason:'已有基因组预测文献支持方法参考，当前样本对应与标签定义仍需核验。'},
  {name:'创意性',level:'待验证',reason:'CNN 基因组预测已有先例。新贡献需通过最近邻检索与目标场景验证确定。'},
  {name:'可行性',level:blocked?'较弱':'待验证',reason:blocked?'独立验证所需条件存在缺口。':'数据许可、家系与年份标识及计算预算尚待核对。'},
  {name:'方案完善度',level:'一般',reason:'已有基线、分组划分与指标，样本规模、参数和复现结果尚待补全。'},
  {name:'证据覆盖',level:'待验证',reason:'目前两篇预置核心文献；未完成系统检索和数据复现。'}],contribution:'候选贡献是检验严格划分下的稳定预测增益及失败边界，不将使用深度学习本身作为新发现。'};
}
