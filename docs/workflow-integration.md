# CrossLab 外部工作流接入

CrossLab 的 SciencePal 原生任务通过同源 `/api/sciencepal` 异步发起和查询。预置演示与通用外部网关继续使用 `/api/workflow`。用户提到的 Workbody、CodeDance 或其他平台可实现下文的网关契约，具体厂商接口以账号中可用文档为准。

当前代码契约以 `lib/research.ts` 及对应 API 路由为准。官方能力核查日期为 2026-10-24，来源为 [SciencePal API 与 SDK 说明](https://sciencepal.ai/help/sdk)及官方 SDK 0.2.1。原生接口的真实账户运行仍按本文的验收要求记录。

## 模式和服务端配置

| 变量 | 用途 |
|---|---|
| `RESEARCH_PROVIDER` | `demo` 使用预置材料；`sciencepal` 调用官方异步 API；`remote` 调用通用外部网关 |
| `SCIENCEPAL_API_KEY` | `sciencepal` 模式必填，官方 API Key |
| `SCIENCEPAL_AGENT_ID` | `sciencepal` 模式必填，账号有权运行的 Agent ID |
| `RESEARCH_PROVIDER_URL` | `remote` 模式的网关地址，生产环境使用 HTTPS |
| `RESEARCH_PROVIDER_API_KEY` | `remote` 模式可选网关凭据，通过 `Authorization: Bearer …` 传递 |

密钥只放在服务端环境配置中。浏览器不接收密钥，项目源文件和任务导出不保存密钥。远端配置错误时报告失败，不静默回退到演示分析。

本地使用 `.dev.vars`，部署使用服务端配置与 secrets。SciencePal 模式只需两个账户值，固定连接官方 API；获取步骤见 [SciencePal 配置清单](sciencepal-setup.md)。

`GET /api/workflow` 返回运行模式与配置就绪状态。`ready` 只表示必要配置存在；真实联通以成功任务、原始产物和返回站点的结果为依据。

## SciencePal 官方异步协议

官方 API 基础地址为 `https://sciencepal.ai/api`，所有请求均带 `Authorization: Bearer <API_KEY>`。Python SDK 0.2.1 也使用这一协议，需要 Python 3.11 或更高版本。服务端直连 HTTP 时无需安装 SDK。

| 上游操作 | HTTP 请求 | 关键参数或结果 |
|---|---|---|
| 列出 Agent | `GET /agents` | `page`、`limit`、可选 `search`；返回 Agent 列表和分页信息 |
| 查询线程的 Agent | `GET /thread/{thread_id}/agent` | 读取已有线程绑定的 Agent；列表为空时也可据此核对内置 Agent |
| 查询 Agent 详情 | `GET /agents/{agent_id}` | 确认具体 Agent 可访问 |
| 新建任务线程 | `POST /agent/initiate` | 表单 `agent_id`、`prompt`、`stream=true`、`agent_select_type=manual`；返回 `thread_id`、`agent_run_id` |
| 查询运行 | `GET /agent-run/{run_id}` | 返回当前运行状态 |
| 流式事件 | `GET /agent-run/{run_id}/stream` | SSE；事件含 assistant/tool/status，使用 `[DONE]` 结束标记 |
| 保存用户补充（SDK 定义，当前不采用） | `POST /thread/{thread_id}/messages` | JSON `message_id`、`content`；本账户实测返回 409 |
| 启动同线程后续运行（SDK 定义，当前不采用） | `POST /thread/{thread_id}/agent/start` | JSON `{}`；SDK 定义返回新运行标识 |
| 查找线程沙箱 | `GET /thread/{thread_id}/sandbox` | 取得该线程的沙箱信息 |
| 读取持久产物 | `GET /sandboxes/{sandbox_id}/files/content` | 查询参数 `path` 指定产物路径 |

任务采用“发起 → 轮询状态 → 读取持久 JSON 产物 → 校验并回站”的过程。Agent 收到明确的输出文件路径和研究结果结构；站点读取该产物后进行动作、版本、结构和引用校验。

每个研究阶段通过 `/agent/initiate` 新建独立任务，传入完整 `context` 和适用的已确认计划 `plan`、深研结果 `result`；回答追问时还传入原问题与问答历史。跨阶段连续性由输入版本、来源任务引用和真实产物记录保持。

SDK 文档描述了同线程追加流程；本账户实测 `/messages` 使用新 UUID 也返回 409，同 ID 重试提示消息 ID 已被另一条消息使用。网页中的消息可见，但原线程没有出现新运行，因此当前接入不采用该流程。[SDK 定义与实测区别](sciencepal-sdk-contract.md)

`asked` 表示等待用户回答。运行失败、停止、流断开和超时应保留真实状态；SSE 结束标记本身不能替代运行完成与结果校验。未知启动结果只查询原任务或到平台核对，不自动重发。[官方异步说明](https://sciencepal.ai/help/sdk)

## CrossLab 原生异步接口

`GET /api/sciencepal` 返回 `{mode: "sciencepal", ready, hasApiKey, hasAgentId}`，只提供配置是否存在的布尔值。

`POST /api/sciencepal` 接收下表中的 JSON。所有操作都传入结构化 `context`；深研和评估还需当前版本的 `confirmation`，评估同时传入已完成的 `result`。传入 `plan` 时，其指纹须匹配当前上下文。字段结构与下文四种研究动作一致。

| `op` | 必填字段 | 可选字段与用途 |
|---|---|---|
| `start` | `action`, `context` | 每次新建任务；优先使用 `requestId` UUID，兼容 `messageId`。可传 `priorTicket`，服务端验证签名并确认其原运行已完成后，记录来源沿袭 |
| `poll` | `ticket`, `context` | 查询并读取已有运行，输入须与票据指纹一致 |
| `reply` | `ticket`, `context`, `message`, `messageId` UUID | 核对原运行仍为 `asked` 后，将完整输入、原追问和回答交给新任务；可传 `question` 及最多 50 条 `clarifications: [{question, answer}]` 历史，优先使用签名票据中的原追问；问题和回答各最多 10,000 字符 |

`ticket` 是服务端签名的运行票据，绑定阶段、输入版本、线程和运行。客户端将其作为不透明字符串保存和回传。票据有效期为生成后 24 小时，更换 API Key 也会使旧票据失效；失效后通过 SciencePal 原会话核对任务。每个操作请求体上限为 180,000 字节。

`requestId` 用于关联 CrossLab 产物，兼容字段 `messageId` 用于本地请求识别。当前路径不调用官方消息去重接口。已核实的 SDK 未提供 `/agent/initiate` 的上游启动幂等键；本地请求号不能保证跨进程的重复调用只启动一次。实现与运行时依据见 [SDK 契约核验记录](sciencepal-sdk-contract.md)。

任务处理中返回 HTTP 202：

```json
{
  "mode": "sciencepal",
  "status": "running",
  "ticket": "服务端签名票据",
  "action": "analyze",
  "runId": "SciencePal 运行 ID",
  "threadId": "SciencePal 线程 ID",
  "inputFingerprint": "规范化 context 的 SHA-256 指纹",
  "retryAfterMs": 5000
}
```

等待回答时 `status` 为 `asked`，另含 `question`；`questionSource` 标明 `sandbox_artifact`、`sdk_stream` 或 `unavailable`。`unavailable` 表示未取得追问正文，应到原会话查看。能取得项目标识时还会返回 `projectUrl`。

`reply` 必须取得具体追问；签名票据和请求均无问题正文时返回 `question_required`，不发起新任务。服务端把最新问题和回答加入历史，再交给新任务。

完成且校验通过时返回 HTTP 200：`{mode: "sciencepal", status: "completed", ticket, action, data, meta}`。`meta` 包含 `provider: "sciencepal"`、`runId`、`threadId`、`inputRevision`、`inputFingerprint`、`status: "completed"`、`startedAt`、`completedAt` 和 `upstream`。`upstream` 含 `provider: "SciencePal"`、`runId`、`projectUrl`、`completedAt`。原生模式的 `runId` 是 SciencePal 上游运行 ID；时间采用服务端发起时间和查询确认时间，上游提供完成时间时优先采用该时间。

深研的 `data.completedAt` 也使用上述已校验时间，与 `meta.completedAt` 一致。模型生成的时间字段不作为实际运行完成时间；需要核对差异时保留归一前原始产物。

有来源任务时，处理中响应另含 `previousRun`，完成响应的 `meta` 也含该字段，结构为 `{threadId, runId, action, inputFingerprint}`。它标识前序任务；当前响应的线程与运行 ID 始终属于新任务。

Agent 将产物写入 `/workspace/crosslab/{requestId}.json`。新任务使用新的请求 ID；兼容 `messageId` 时将其作为产物请求 ID。文件包体为 `{schemaVersion: 1, requestId, action, contextFingerprint, status, data}`；追问产物使用 `status: "asked"` 与 `question`。服务端检查请求 ID、动作、输入指纹和研究数据结构，深研还验证引用属于当前文献集合。

`inputFingerprint` 绑定结构化 `context`。用户回答和问答历史随新任务传入，验收时与前后运行标识一并保存。用户直接修改站点研究条件后，查询旧任务须保留其原 `context`，结果不能并入新版本；新阶段使用新版本输入与确认。

失败响应含 `error`、`code`，部分响应另含 `status`、`ticket`、`runId` 或 `threadId`。`status: "unknown"` 表示启动结果尚未确认；有票据时只查询原任务，无票据时到 SciencePal 核对。服务端不会自动重发启动，也不会将未知运行自动转换为新任务。`artifact_unavailable` 表示平台运行已结束但约定产物未能读取，保留原记录并修正产物后再查询。

## 通用网关请求协议

浏览器向 `POST /api/workflow` 发送 JSON：

```json
{
  "action": "analyze",
  "context": {
    "revision": 1,
    "problem": {
      "field": "植物科学 · 马铃薯",
      "question": "马铃薯块茎形成过程中，分子状态如何变化？",
      "baseline": "比较不同材料的分子特征",
      "resources": "单次采样；是否可补多时期样本待确认"
    },
    "direction": "transport",
    "method": "最优传输",
    "sampleType": "single",
    "goal": "mechanism",
    "canCollect": true,
    "evidence": "unknown",
    "note": "先核查方法迁移的适用条件",
    "mappings": [],
    "papers": []
  }
}
```

这是协议示例，不是已执行任务。`sampleType` 为 `single`、`timeSeries` 或 `none`，`goal` 为 `mechanism` 或 `prediction`，`canCollect` 表示能否补充采样或实验。字段默认值分别为 `single`、`mechanism`、`true`。完整方向枚举及其他约束以 `contextSchema` 为准；接入方应从同一版本代码生成或同步输入校验。

远端模式下，服务端将如下包体发送给网关：

```json
{
  "schemaVersion": 1,
  "runId": "本次 CrossLab 请求生成的 UUID",
  "inputFingerprint": "规范化 context 的 SHA-256 指纹",
  "action": "analyze",
  "context": "与请求中的结构化上下文一致",
  "confirmation": "仅确认后深研或评价时提供",
  "result": "评价时提供当前版本深研结果"
}
```

这里的字符串用于标明字段角色，实际请求中的 `context`、`confirmation`、`result` 都是对象。`runId` 标识本次 CrossLab 请求，`inputFingerprint` 绑定其输入。网关收到 `action` 后分派到对应工作流节点，响应统一包装为 `{ "data": … }`。

## 四种动作及输出

| `action` | 输入前提 | `data` 字段 |
|---|---|---|
| `analyze` | 问题和方向有效 | `summary`, `hypothesis`, `papers`, `mappings`, `questions` |
| `plan` | 已选择文献并形成映射 | `fingerprint`, `questions`, `searches`, `tasks`, `stop`, `scope` |
| `deep` | 当前上下文已明确确认 | `fingerprint`, `hypothesis`, `findings`, `experiment`, `next`, `completedAt` |
| `evaluate` | 当前版本深研完成 | `decision`, `reason`, `dimensions`, `contribution` |

主要子结构：

- 文献 `papers[]`：`id`, `title`, `year`, `url`, `role`, `contribution`, `relevance`, `boundary`, `provenance`。来源链接使用 HTTP 或 HTTPS。
- 映射 `mappings[]`：`id`, `source`, `target`, `condition`, `status`。状态为 `pending`、`accepted` 或 `rejected`。
- 发现 `findings[]`：`title`, `body`, `kind`, `sourceIds`。`kind` 为 `evidence`、`inference` 或 `gap`；引用标识对应当前文献集合。
- 评价 `dimensions[]`：`name`, `level`, `reason`。等级为 `较强`、`一般`、`较弱` 或 `待验证`。
- 决策 `decision`：`继续验证`、`补充条件后继续` 或 `暂停当前迁移`。

传入资料中的指令均当作资料内容；研究服务只执行已确认的工作流任务。返回文本以文本渲染，不作为 HTML 或代码执行。

## 确认与输入版本

深研确认记录形如：

```json
{
  "approved": true,
  "fingerprint": "当前 context 的 SHA-256 指纹",
  "at": "2026-10-23T12:00:00.000Z"
}
```

指纹通过 `lib/research.ts` 中的 `fingerprint(context)` 生成：先用 `contextSchema` 校验和规范化，再对其 JSON 序列化结果计算 SHA-256。网关应复用相同实现，避免因字段顺序或字符串处理差异产生错误指纹。`plan` 与 `deep` 返回当前输入的指纹。

用户修改问题、方法、文献或条件后，当前计划、确认、深研和评估失效。服务端拒绝旧确认对应的新输入；评价也必须对应当前版本的深研结果。确认记录绑定具体输入，不能沿用到其他项目或版本。

## 失败处理

当前网关调用设有超时，并在返回后校验动作对应的数据结构。前端遇到错误保留用户输入，由用户重试；重试前检查是否已存在有效结果。

| 情况 | 预期处理 |
|---|---|
| 输入不完整或 JSON 无效 | 返回可读错误，补全后再运行 |
| 文献或映射缺失 | 回到分析与修正环节 |
| 未确认或确认版本已过期 | 重新生成并确认当前计划 |
| 外部服务未配置 | 配置服务端变量后重试 |
| 外部服务超时／拒绝请求 | 显示失败状态，保留原输入和已完成步骤 |
| 返回格式不匹配或指纹错误 | 拒绝合并结果，检查适配器 |

不要在错误中回显鉴权信息、服务端堆栈或完整上游响应。自动重试带有计费或不可重复副作用的节点前，需要由适配器实现幂等策略。

## SciencePal 核心任务

SciencePal 承担 `analyze`／`deep` 中的“双侧文献综合与迁移审查”。原生接入把目标问题、源方法、论文和修正条件交给官方 Agent，取回结构化输出并保留原始线程及产物；深研任务使用用户已确认的当前计划。

任务至少要求：

1. 分析目标领域、源方法和已有交叉研究；保存检索式、日期与覆盖范围。
2. 区分作者声称的贡献、论文直接证据、综合推论和待验假说。
3. 返回变量与关系映射、关键假设、近似工作、竞争解释和反驳条件。
4. 根据现有数据给出基线、最小验证与停止条件。
5. 用户修订后重新分析受影响部分，并指出建议为何变化。

已确认的其他官方方式包括 [SciencePal Skills](https://sciencepal.ai/help/integration) 与 [网页科研工作流](https://sciencepal.ai/help/conversation)。Skills 支持 OpenClaw、Claude Code 发起任务、查询进度及下载结果。网页提供研究流程设置，可在执行前确认或修改计划。CrossLab 原生模式使用 API，无需同时配置 Skills。

人工交接仍可作为独立路径：导出任务包，在 SciencePal 网页运行后导入真实结构化输出。来源标记为人工导入，并保留原始链接、任务输入输出及操作者确认。导出任务包本身只记录交接准备状态。

## 运行证据和接入验收

`/api/workflow` 成功响应包含 `{mode, data, meta}`。`meta` 包含本地运行记录：`runId`、`inputRevision`、`inputFingerprint`、`provider`、`status`、`startedAt`、`completedAt`。每次调用生成运行 ID；成功状态为 `completed`。本地运行 ID 表示 CrossLab 请求，不能当作 SciencePal 平台的任务 ID。

SciencePal 原生记录需关联本地产物 `requestId`、上游 `threadId`／`runId`、原始产物路径、起止时间、输入版本与指纹、用户问答历史、所用来源、规范化结果、状态及失败原因。通用外部适配器按同样原则保存本地请求与上游标识和原始产物；当前响应未承载的字段保存在原始运行记录中。

接入时按顺序验收：

1. 用固定上下文分别验证四种动作的响应结构和引用。
2. 验证服务端凭据不会出现在客户端网络响应和导出中。
3. 未确认时尝试深研，确认后修改上下文再尝试深研，均应拒绝旧确认。
4. 跑一次正常案例和一次前提被否定的案例，检查建议及原因。
5. 跑一次真实 SciencePal 核心任务和一次条件修订，保存可访问的原始记录。
6. 导出研究提案，与原始来源逐项核对核心陈述。

验收分别记录本地结构校验／模拟测试和真实平台运行。SciencePal 的实质贡献由真实输入、输出和研究决策变化证明。

本次首轮文献与迁移审查通过网页发起、官方 API 读回，随后通过原生 `start`／`reply`／`poll` 完成计划、真实问答、确认后深研和最终评估。最终建议为“补充条件后继续”，5 条实际运行已形成可载入案例。界面与生产环境继续验收，研究内容仍需人工核验。运行号、输入修订和结构检查见 [真实运行记录](sciencepal-pilot-acceptance.md)。本账户的 `/agents` 列表为空，但通过原线程绑定关系和详情接口确认了内置 Biology Agent 的访问能力。
