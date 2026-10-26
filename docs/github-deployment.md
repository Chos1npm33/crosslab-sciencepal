# GitHub Actions 部署到 Cloudflare Workers

本文用于将 `Chos1npm33/crosslab-sciencepal` 部署到用户自己的 Cloudflare 账户。工作流文件为 `.github/workflows/deploy.yml`。配置和部署结果以 GitHub Actions 的实际运行记录为准；本文不代表账号配置或首次部署已经完成。

## 1. 配置部署凭据

在 GitHub 仓库的 **Settings → Secrets and variables → Actions → Repository secrets** 添加：

| Secret | 内容 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | 目标 Cloudflare 账户 ID |
| `CLOUDFLARE_API_TOKEN` | 对该账户具有 Workers Scripts 编辑权限的 API Token |

Token 的账户资源范围限定为目标账户。不要将凭据写入源码、工作流文件或提交记录。

## 2. 运行自动部署

工作流在推送到 `main` 时触发，也可在 GitHub 的 **Actions** 页面手动运行。安装依赖后依次执行：

```bash
node tests/run.mjs
node --test tests/sciencepal-worker.test.mjs
node node_modules/typescript/bin/tsc --noEmit
pnpm build
```

全部通过后，执行部署：

```bash
pnpm exec wrangler deploy --config dist/server/wrangler.json --name crosslab-sciencepal --keep-vars
```

缺少任一部署凭据、检查失败或部署命令失败时，工作流必须显示失败，不应报告发布成功。`--keep-vars` 保留在 Cloudflare 上配置的运行变量。

CI 的 GitHub 权限仅需 `contents: read`，不生成提交，也不写回源码。

## 3. 设置新站的访问范围



Cloudflare Workers 的访问范围由本项目的部署配置控制。用户尚未选择新站的访问范围，因此启用共享研究密钥前，应先通过 **Cloudflare Access** 保护新站，保持仅所有者可访问，并确认页面及 `/api/*` 都受到保护。检查 `workers.dev` 等其他可访问入口，避免绕过 Access；不需要的入口应关闭。

之后再按用户选择调整为受邀访问或公开访问。Cloudflare 部署成功与访问控制验收是两个独立步骤。

## 4. 配置 SciencePal 运行环境

完成 Access 验收后，在 Cloudflare 中打开 `crosslab-sciencepal` 的 **Settings → Variables and Secrets**，配置：

| 名称 | 类型及值 |
| --- | --- |
| `RESEARCH_PROVIDER` | 运行变量，值为 `sciencepal` |
| `SCIENCEPAL_API_KEY` | Secret，填写自己的 SciencePal API Key |
| `SCIENCEPAL_AGENT_ID` | Secret，填写可用的 SciencePal Agent ID |

这些值存放在 Cloudflare，不写入 Git 源码。SciencePal 配置来源见[配置清单](sciencepal-setup.md)。演示模式使用 `RESEARCH_PROVIDER=demo`，不需要研究服务密钥。

## 5. 首次验收

1. GitHub Actions 中的测试、构建和部署步骤均成功，部署日志给出实际 Worker 地址。
2. 未授权浏览器访问页面和研究 API 时被 Access 拦截；所有者能够登录并使用网站。
3. 在已授权会话中检查 `/api/sciencepal` 的配置状态，再运行一次研究请求，确认结果和运行记录返回网站。
4. 后续推送到 `main` 后，核对对应提交的 Actions 记录及新站更新。
