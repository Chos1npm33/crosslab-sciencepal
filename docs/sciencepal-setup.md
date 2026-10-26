# CrossLab 的 SciencePal 配置清单

CrossLab 使用 SciencePal 官方异步 API，把文献分析、迁移审查和用户修订交给账号中的 Agent，再取回结构化研究结果。配置需要两个账户值：`SCIENCEPAL_API_KEY` 和 `SCIENCEPAL_AGENT_ID`。

官方能力核查时间：2026-10-24 08:00 UTC。本次已确认官方 API、Python SDK 0.2.1 和 Skills 接入说明。首轮研究通过网页发起并由官方 API 取回，后续原生接口的追问、回答、计划、确认后深研与最终评估已完成此次实测。界面与生产环境继续验收，科学内容继续人工核对。证据见 [真实运行记录](sciencepal-pilot-acceptance.md)。模拟响应测试和真实平台运行分别记录。

## 1. 获取两个账户值

1. 登录 SciencePal，打开 **用户中心 → 连接与开发 → API 与 Python SDK**。
2. 创建 API Key，填写用途名称和有效期。官方说明允许 1–365 天，默认 90 天；完整 Key 只在创建时显示一次。
3. 选择账号内可访问、适合科研任务的 Agent，取得它的 `agent_id`。本接入从线程沙箱读取结果，所选 Agent 需能把 JSON 产物写入沙箱文件。若界面未显示 ID，可按下方官方 SDK 方法列出账号中的 Agent。

| 服务端变量 | 填写内容 |
|---|---|
| `SCIENCEPAL_API_KEY` | 从上述页面创建的 API Key |
| `SCIENCEPAL_AGENT_ID` | 运行 CrossLab 研究任务的 Agent ID |

这条接入只需上述两个账户值。登录密码、浏览器会话 Cookie 和其他模型厂商的 Key 均不参与配置。Key 具有当前账户的访问权限并使用其额度；有效期和撤销操作由 SciencePal 管理。[官方 API 与 SDK 说明](https://sciencepal.ai/help/sdk)

## 2. 配置本地或部署环境

本地开发在项目根目录创建 `.dev.vars`；已有该文件时直接编辑，保留其他配置。填入以下三行，其中 `RESEARCH_PROVIDER` 是模式开关：

```dotenv
RESEARCH_PROVIDER=sciencepal
SCIENCEPAL_API_KEY=在本地填入实际值
SCIENCEPAL_AGENT_ID=在本地填入实际值
```

`.dev.vars` 已被 Git 忽略。部署时在平台的服务端配置中设置模式开关，并将两个账户值写入 secrets。原生 SciencePal 模式使用固定官方 API 地址，无需配置 `RESEARCH_PROVIDER_URL` 或 `RESEARCH_PROVIDER_API_KEY`。

配置后重启本地服务：

```powershell
node scripts/run-framework.mjs dev
```

凭据始终由服务端读取。浏览器、任务导出、报告和代码仓库只保存研究内容及运行标识。

本次项目已配置本地 `.dev.vars` 和 Cloudflare 服务端 Secrets：`RESEARCH_PROVIDER=sciencepal`、`SCIENCEPAL_API_KEY`、`SCIENCEPAL_AGENT_ID`。当前选择 Biology Agent，ID 为 `10000000-0000-0000-0000-000000000002`。此处只记录配置名称和非秘密 Agent ID，实际 Key 保留在上述配置位置。

## 3. 可选：用官方 SDK 查询 Agent ID

官方 Python SDK 需要 Python 3.11 或更高版本，安装命令为：

```powershell
python -m pip install "https://sciencepal.ai/downloads/sdk/sciencepal_sdk-0.2.1-py3-none-any.whl"
```

在运行终端中设置 `SCIENCEPAL_API_KEY` 环境变量后执行：

```powershell
python scripts/list-sciencepal-agents.py --search CrossLab
```

脚本只查询 Agent 列表，打印名称、ID 和分页信息；省略 `--search` 可查看当前页全部 Agent。它从进程环境读取 Key，不自动读取 `.dev.vars`。官方 SDK 对应的只读 HTTP 请求是 `GET https://sciencepal.ai/api/agents?page=1&limit=100`，通过 `Authorization: Bearer …` 鉴权。

### 列表为空时，查询现有线程绑定的 Agent

2026-10-24 的真实账户检查中，`GET /agents?page=1&limit=100` 返回 HTTP 200、`agents: []`、`pagination.total: 0`；同一账户的现有研究线程仍绑定可访问的内置 Biology Agent。此时按官方接口查询：

1. `GET /thread/{thread_id}/agent`：读取该线程实际绑定的 `agent`；本次响应的 `source` 为 `thread`。
2. `GET /agents/{agent_id}`：确认当前 API Key 有权读取该 Agent 详情；本次返回 HTTP 200。
3. 将核对过的 ID 填入 `SCIENCEPAL_AGENT_ID`，继续运行验证。

本次核对的线程为 `7146aaa5-80be-43f1-8488-0bdc27289322`，Agent 为 `Biology Agent`，ID 为 `10000000-0000-0000-0000-000000000002`。列表为空不能单独判断账号没有可用 Agent；其他账户应核对自己的线程与权限。只读列表脚本仍只调用 `/agents`，不会自动查找或创建研究线程。证据见 [账户接口摘要](../outputs/sciencepal-pilot/01-agent-access.json)。

官方安装包及校验文件：[SDK 0.2.1](https://sciencepal.ai/downloads/sdk/sciencepal_sdk-0.2.1-py3-none-any.whl)、[SHA256SUMS](https://sciencepal.ai/downloads/sdk/SHA256SUMS)。本次核对的 wheel SHA-256 为 `9b732dbd779332c4064088a1f00efd1348f29758bb26d7aed86ec172589d559e`。

## 4. 官方接入方式及项目选择

| 官方能力 | 已核实内容 | CrossLab 用法 |
|---|---|---|
| HTTP API / Python SDK | 发起任务、查询状态、流式事件；SDK 也定义了同线程消息与启动接口 | 原生接入使用独立任务；各阶段携带完整上下文 |
| SciencePal Skills | OpenClaw、Claude Code 可发起任务、查询进度、下载结果；配置入口为用户中心的「平台集成 → SciencePal Skills」 | 可供外部研究工具使用，本项目接入无需安装 Skills |
| 网页科研工作流 | 附件、Workspace、资料库和研究流程设置；关闭自动执行后可确认或修改计划 | 可核对原始研究过程与产物 |

证据：[API 与 SDK](https://sciencepal.ai/help/sdk)、[平台集成](https://sciencepal.ai/help/integration)、[对话与科研工作流](https://sciencepal.ai/help/conversation)。官方公开文档未给出可直接配置的 MCP 服务地址，本项目按已公布的 HTTP API 接入。

原生异步接口和通用网关契约见 [工作流接入文档](workflow-integration.md)。`asked` 表示 Agent 等待用户补充信息；回答时将原问题、研究上下文和回答带入新任务。任务超时或流断开后先查询原运行，避免重复发起任务。

### 实测采用独立任务承接各阶段

2026-10-24，官方同线程消息接口 `POST /thread/{thread_id}/messages` 在本账户测试中返回 HTTP 409，包括使用新 UUID 的请求。网页可见消息，但原线程只有首轮运行，没有产生新运行；同 ID 重试的错误说明为 `message_id is already in use for another message`。因此当前实现通过官方 `/agent/initiate` 为每个阶段或回答新建任务，携带完整 `context` 及适用的 `plan`、`result` 和问答历史，保留前后运行记录供对照。

原生接口的计划运行 `4a782f7c-dde1-46e4-ade1-2143d690922d` 随后进入 `asked`；真实回答带入新任务 `127e597a-7ac0-43fa-9280-ffc565fe0125`，计划已完成并取回。确认后的深研与最终评估也已完成，维持“仅审查 5 篇文献与方法，数据未知时不计算”的范围，最终建议为“补充条件后继续”。5 条实际运行已整理为可载入案例。[实测接口依据](sciencepal-sdk-contract.md)

## 5. 真实运行验收

配置就绪只说明变量存在。按下面的链路确认真实接入：

1. 在站点描述研究问题、选择跨界方向，触发一次真实文献分析。
2. 保存 SciencePal 的 `thread_id`、`agent_run_id`、输入版本与指纹、起止时间和原始产物。
3. 检查站点已收到结果，文献链接可核对，论文贡献与系统推论分开，建议包含迁移前提。
4. 修改一项影响结论的条件，将完整的新版本输入交给新的 SciencePal 任务。保存前后线程与运行 ID，并比较修订前后的依据和建议。
5. 确认当前研究计划后启动深研，完成方案评估；核查报告与真实来源和产物一致。
6. 保存可向评委展示的项目或工作流记录、演示视频和说明材料，覆盖 SciencePal 对研究决策的实质贡献。[比赛要求](https://sciencepal.ai/hackathon)

验收记录应分别注明「代码／模拟测试通过」与「真实 SciencePal 运行通过」。后者填入实际运行标识、产物和核对日期后才能确认完成。

| 常见状态 | 处理 |
|---|---|
| 401 | 检查 Key 是否缺失、到期或已撤销 |
| 403 / 404 | 检查 Agent ID、当前账号访问权限和接口是否可用 |
| 429 | 检查账号额度或频率限制 |
| 等待补充信息 | 携带原问题、上下文和回答新建任务，保留前后记录 |
| 运行中断或超时 | 保留原任务并查询，未知启动结果到平台核对 |
| 结果结构或引用校验失败 | 保留原始产物，修正 Agent 输出并重新取回 |
