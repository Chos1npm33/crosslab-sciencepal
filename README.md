# CrossLab · 跨界研究器

本仓库是 CrossLab 网站的 GitHub 源码仓库，包含研究工作台、工作流接口和 SciencePal 接入代码。项目面向 SciencePal AI4Science Hackathon，帮助研究者从文献出发，判断其他学科的方法能否用于自己的研究问题。

核心流程：**描述研究问题 → 选择跨界方向 → 文献分析 → 交互修正 → 确认后深研 → 方案评估**。

界面采用卡片选择和分步填写。用户修改研究条件后，后续方案和确认状态会失效，避免沿用旧输入继续研究。草稿保存在当前浏览器，可导出、导入 JSON，并查看运行记录和来源。

## 本地运行

环境：Node.js ≥ 22.13.0、pnpm 11.25.0。

```bash
pnpm install --frozen-lockfile
node scripts/run-framework.mjs dev
```

默认地址：<http://localhost:5173>。

## 配置研究服务

将 `.env.example` 复制为本地 `.dev.vars`，选择一种模式：

| 模式 | 配置 | 用途 |
| --- | --- | --- |
| 演示 | `RESEARCH_PROVIDER=demo` | 使用预置结果体验流程，无需密钥 |
| SciencePal | `RESEARCH_PROVIDER=sciencepal` | 调用官方异步研究接口 |
| 外部工作流 | `RESEARCH_PROVIDER=remote` | 连接自建工作流网关 |

SciencePal 模式需要两项账户配置：

```dotenv
RESEARCH_PROVIDER=sciencepal
SCIENCEPAL_API_KEY=your-api-key
SCIENCEPAL_AGENT_ID=your-agent-id
```

在 SciencePal 用户中心的「连接与开发 → API 与 Python SDK」获取接入信息。密钥仅放在本地 `.dev.vars` 或部署平台的服务端 Secrets 中，不提交到 Git。配置过程不需要账户密码、会话 Cookie 或其他模型服务的密钥。

原生接入通过 `/api/sciencepal` 启动任务、查询进度、处理追问并取回结构化结果。各阶段及追问答复会创建独立的官方任务，并保留前后任务关系；启动结果未知时不会自动重复创建任务。深度研究需要用户确认当前方案。

外部工作流模式使用以下配置，网关请求和返回结构见[接入合同](docs/workflow-integration.md)：

```dotenv
RESEARCH_PROVIDER=remote
RESEARCH_PROVIDER_URL=https://your-workflow-gateway.example/research
RESEARCH_PROVIDER_API_KEY=your-private-gateway-key
```

## 已完成的实测

2026-10-24 已使用 SciencePal 跑通「马铃薯 bulk 多组学 × 最优传输」案例：首轮文献分析由 SciencePal 网页发起并通过官方 API 读回；后续修订、追问答复、方案生成、确认后的深研和最终评估均完成原生 API 运行。最终建议为「补充条件后继续」。

网站的「载入 SciencePal 实测案例」可查看这次完整记录；案例文件位于 [public/examples/sciencepal-pilot.json](public/examples/sciencepal-pilot.json)，包含五次实际运行记录（含一次追问状态）。载入案例本身不会发起新研究。

本次实测完成了指定五篇文献的方法与验证设计审查，没有执行真实数据计算或实验验证。文献内容和创新性判断仍需研究者逐项核验。详细过程、勘误和验收范围见[实测验收记录](docs/sciencepal-pilot-acceptance.md)。

## 检查与构建

```bash
node tests/run.mjs
node --test tests/sciencepal-worker.test.mjs tests/worker-access.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node scripts/run-framework.mjs build
```

2026-10-24 验收记录：63 项测试、1 项 Worker 测试及 TypeScript 检查通过，并完成浏览器案例载入、刷新恢复和生产接口结果回传验证。自动化测试与真实 SciencePal 运行分别记录。

## GitHub 自动部署

站点：[CrossLab 研究工作台](https://crosslab-sciencepal.hytao0591.workers.dev/)。使用网站访问口令登录。每次推送到 `main` 后，GitHub Actions 完成测试、类型检查和构建，再自动部署到 Cloudflare Workers。

页面、API 和静态文件均需口令登录，会话持续 8 小时；预览 URL 保持关闭。SciencePal 密钥保存在 Cloudflare Production Secrets。口令设置、部署凭据轮换和验收记录见[自动部署说明](docs/github-deployment.md)。

## 代码与文档

前端使用 React、Vinext 和 Vite，服务端兼容 Cloudflare Workers。

| 位置 | 内容 |
| --- | --- |
| `app/page.tsx` | 卡片式研究工作台 |
| `app/api/sciencepal/route.ts`、`server/lib/sciencepal.ts` | SciencePal 原生异步接入 |
| `app/api/workflow/route.ts` | 演示与通用外部工作流接口 |
| `lib/research.ts` | 研究输入、阶段结果及校验结构 |
| `public/examples/sciencepal-pilot.json` | 可载入的真实研究案例 |

- [SciencePal 配置清单](docs/sciencepal-setup.md)
- [工作流接入合同](docs/workflow-integration.md)
- [官方 SDK 核对记录](docs/sciencepal-sdk-contract.md)
- [功能验收清单](docs/acceptance.md)
- [真实研究验收记录](docs/sciencepal-pilot-acceptance.md)
