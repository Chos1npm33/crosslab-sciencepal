# SciencePal SDK 契约核验记录

核验日期：2026-10-24。依据为官方 [SDK 0.2.1 wheel](https://sciencepal.ai/downloads/sdk/sciencepal_sdk-0.2.1-py3-none-any.whl)、[SHA256SUMS](https://sciencepal.ai/downloads/sdk/SHA256SUMS) 与 [API 说明](https://sciencepal.ai/help/sdk)。只读检查了 wheel 中的 Python 源码，未安装或执行 SDK。wheel SHA-256 与官方校验文件一致：

```text
9b732dbd779332c4064088a1f00efd1348f29758bb26d7aed86ec172589d559e
```

下载文件仅保存在忽略目录 `.cache/sciencepal-sdk/`。以下记录保留核验依据，不将 SDK 整包纳入项目。

| 代码依据 | 已核实契约 | 本项目处理 |
|---|---|---|
| `sciencepal/api/agent_runs.py` → `AgentRunsAPIClient.initiate`；`models.py` → `InitiateAgentResponse` | `POST /agent/initiate` 为表单；`prompt`、`agent_id`、`stream`、`agent_select_type`、`web_search_on`；响应 `thread_id: str`、`agent_run_id: str \| None` | 固定官方 API 地址；初次启动只发一次；有线程但缺运行号时查询原线程，并保留恢复票据 |
| 同模块 → `get`；`AgentRunStatus` | `GET /agent-run/{id}`；`id` 必填；`threadId`/`thread_id`、`startedAt`/`started_at`、`completedAt`/`completed_at`、`status`、`error` 可空 | 核对运行号与线程；上游完成时间有效时优先采用 |
| 同模块 → `list_thread_runs`；`AgentRunRecord` | `GET /thread/{id}/agent-runs`；包体 `agent_runs`；记录中的 `id`、`thread_id`、`status` 等可缺省或为 `null` | 只把有效 ID 作为候选；不把“列表中出现新运行”当作研究产物已验证 |
| 同模块 → `add_message`；`UserMessageResponse` | `POST /thread/{id}/messages` JSON `{message_id, content}`；SDK 响应定义为同名 `message_id`、`thread_id`；官方文档说明同一消息可复用 ID | 当前不采用：真实账户中，包括新 UUID 在内的请求返回 409，消息可见也未产生新运行 |
| 同模块 → `start`；`AgentRunStartResponse` | `POST /thread/{id}/agent/start` JSON；SDK 响应定义为 `{agent_run_id, status}` | 当前不采用自动同线程续跑；各阶段通过 `/agent/initiate` 新建任务并传入完整研究上下文 |
| `sciencepal/api/sandbox.py` → `get_thread_sandbox`；`ThreadSandboxInfo` | `GET /thread/{id}/sandbox` 返回 `thread_id`、`project_id`、`sandbox_id`、`sandbox_info` | 校验线程后使用返回的沙箱号；项目链接由真实项目号与线程号组成 |
| 同模块 → `read_file` | `GET /sandboxes/{id}/files/content?path=...` 返回文件字节 | 从官方沙箱读取约定 JSON 文件，检查请求号、动作、指纹、数据结构及引用 |
| `sciencepal/utils/streaming.py` → `parse_sse_stream`、`stream_to_text` | SSE `data:` JSON；`[DONE]` 表示流结束；纯文本提取采用 `type == "message"` 的 `content` | 仅作为追问文件缺失时的限时读取；未假设历史事件重放或游标支持 |

## 同线程接口的账户实测与当前选择

2026-10-24，本账户的 `POST /thread/{id}/messages` 请求出现 HTTP 409。新 UUID 请求也遇到该状态；同 ID 重试返回 `message_id is already in use for another message`。消息可在网页看到，但核对原线程运行列表时仅有已完成的首轮运行，没有新运行。SDK 定义和消息可见状态均不足以确认后续研究已启动。[消息回执摘要](../outputs/sciencepal-pilot/message-receipt-shape.json)

当前各研究阶段采用官方 `POST /agent/initiate` 独立任务，携带完整 `context`、适用的 `plan`／`result`，回答追问时同时携带原问题与问答历史。已有任务票据仅用于核对来源和状态，新的研究阶段返回新的线程与运行 ID。API 未知启动结果仍先查询或到平台核对，不自动换任务重发。

计划阶段首先通过站点 API 得到 HTTP 202，运行 `4a782f7c-dde1-46e4-ade1-2143d690922d`、线程 `b8b2ee18-4f0d-4c5a-8c55-814c3896e87e`。[计划发起回执](../outputs/sciencepal-pilot/plan-start-receipt.json)

该运行随后进入 `asked`。真实 `reply` 发起新任务 `127e597a-7ac0-43fa-9280-ffc565fe0125`，于 `2026-10-24T09:00:30.477Z` 完成计划，返回元数据的 `previousRun` 指向原任务，输入指纹保持一致。确认后深研 `d347cfa4-66dc-403b-9bae-2e4341e2eb0c` 于 `2026-10-24T09:06:36.659Z` 完成并返回 8 条发现及设计审查。[计划完成产物](../outputs/sciencepal-pilot/plan-completed.json)、[深研完成产物](../outputs/sciencepal-pilot/deep-completed.json)

最终评估 `7f6faf8e-2cc5-4db0-836e-183cd9819449` 于 `2026-10-24T09:12:48.358Z` 完成，返回“补充条件后继续”。此次已验证原生计划、真实问答、确认后深研、评价及结果读取；首轮分析仍明确记录为网页发起、API 读回。5 条实际运行已整理为公开案例，界面与生产环境另行验收，科学陈述继续人工核验。[评估完成产物](../outputs/sciencepal-pilot/evaluate-completed.json)、[完整案例](../public/examples/sciencepal-pilot.json)

深研模型输出的 `data.completedAt` 曾为当天零时。服务端以已校验的官方运行完成时间归一该字段，使它与 `meta.completedAt` 一致；上游时间缺失时采用查询确认时间。原始研究文本与归一前产物保留作核对。[归一前原件](../outputs/sciencepal-pilot/deep-before-time-normalization.json)

`/workspace/crosslab/{requestId}.json` 及 `{schemaVersion, requestId, action, contextFingerprint, status, data}` 是 **CrossLab 给 Agent 的输出约定**，并非 SciencePal 自带科研结果格式。Agent 须有文件工具并按提示保存产物。文件不存在或结构错误时，平台运行完成也不等于网站结果验收完成。追问文件缺失且 SSE 未返回正文时，网站提示到原会话查看；取得问题后，将问题与回答带入新任务。

启动超时且未收到线程号时，已核实的 SDK 契约无法让网站按本地 `requestId` 找回新线程；需在平台核对。`requestId` 不是官方启动幂等键。2026-10-27 评审部署通过固定 SQLite Durable Object 统一持久保存任务预留与回执，同一请求即使跨 Worker 或重启也不会重复派发；未知启动保留占额。未启用评审预算的本地或独立部署仍使用最长 24 小时的进程内回执，不具有跨 Worker 去重保证。已有未知提交应查询或核对原任务，不重新发起。

签名票据保存历史请求 ID，阻止新阶段覆盖已使用的产物路径。最终产物只有同时匹配当前票据的请求 ID、动作、上下文指纹并通过研究数据校验，才会进入网站。旧票据不能授权新版本的深研。

## Worker 运行时核验

当前生成配置为 `compatibility_date: 2026-05-15`、`nodejs_compat`。Cloudflare 官方说明支持 [Buffer](https://developers.cloudflare.com/workers/runtime-apis/nodejs/buffer/)、[Web Crypto 的 HKDF/HMAC](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)，该兼容日期也支持将服务端变量与 secrets 读取为 [process.env](https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/)。

本地测试 `node --test tests/sciencepal-worker.test.mjs` 使用项目 Wrangler 自带的 Miniflare/workerd 和相同兼容配置，实际执行环境绑定读取、票据签名、校验、错误密钥拒绝，以及原生 HTTP 请求路径；2026-10-24 通过。测试仅连接本机 Worker，并在网络边界模拟上游。服务端契约测试运行 `node tests/run.mjs`。这些测试不代表真实 SciencePal 账户运行已通过。

实测 workerd 不支持 `fetch` 的 `redirect: "error"`，会在发出请求前立即抛出 `TypeError`；Node 支持该取值。服务端因此使用 `redirect: "manual"` 并显式拒绝所有 3xx，避免转发凭据。修复后，用无凭据只读 GET 验证 Node 与本地 workerd 均可到达官方 API，得到预期的 HTTP 401。

