# GitHub Actions 部署到 Cloudflare Workers

`Chos1npm33/crosslab-sciencepal` 通过 `.github/workflows/deploy.yml` 部署到自己的 Cloudflare 账户。首次部署创建关闭外部 URL 的 Worker；设置网站访问口令后，再开启生产地址。网站使用自己的口令页，无需开通 Cloudflare Access 或 Zero Trust。

## 1. 配置部署凭据

在 GitHub 仓库的 **Settings → Secrets and variables → Actions → Repository secrets** 添加：

| Secret | 内容 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | 目标 Cloudflare 账户 ID |
| `CLOUDFLARE_API_TOKEN` | 对该账户具有 Workers Scripts 编辑权限的 API Token |

Token 仅授予 **Account → Workers Scripts → Edit**，账户资源限定为目标账户。此权限覆盖该账户的 Workers。凭据保存在 GitHub Secrets 中。

当前部署 Token 名为 `CrossLab GitHub Deploy`，到期日为 **2027-01-25**。到期前轮换 Token，并更新 GitHub 的 `CLOUDFLARE_API_TOKEN` Secret。

## 2. 首次部署：创建 Worker，关闭外部 URL

保持仓库变量 `CROSSLAB_WORKERS_DEV` 未设置。推送到 `main` 或在 GitHub **Actions** 页面选择 `main` 手动运行工作流。PR 和其他分支的手动运行只执行检查与构建。安装锁定版本依赖后，工作流依次执行：

```bash
node tests/run.mjs
node --test tests/sciencepal-worker.test.mjs tests/worker-access.test.mjs
node node_modules/typescript/bin/tsc --noEmit
pnpm build
```

构建后，工作流将 `dist/server/wrangler.json` 中的 `workers_dev` 和 `preview_urls` 设为 `false`，启用 `CROSSLAB_AUTH_REQUIRED=true`，并配置 SQLite Durable Object 登录计数及 `ASSETS` 绑定。`assets.run_worker_first=true` 确保静态文件也先经过口令校验。随后执行：

```bash
pnpm exec wrangler deploy --config dist/server/wrangler.json --name crosslab-sciencepal --keep-vars
```

此次部署成功后，Cloudflare 中会出现 `crosslab-sciencepal`，生产和预览 URL 都保持关闭。GitHub 运行摘要标记为 Bootstrap，并记录对应提交。此时不配置 SciencePal 或外部研究网关密钥。

缺少部署凭据或检查失败会阻止部署。`--keep-vars` 保留 Cloudflare 上已有的运行变量，已保存的 Worker Secrets 也继续保留；URL 开关由上述工作流步骤控制。构建读取根目录 `wrangler.json`；CI 在构建产物中设置生产地址和访问开关。

CI 的 GitHub 权限仅需 `contents: read`，不生成提交，也不写回源码。

## 3. 设置访问口令并开启生产 URL

在 Cloudflare 打开 `crosslab-sciencepal` 的 **Settings → Variables and Secrets**，添加 **Secret**：`CROSSLAB_ACCESS_CODE`。使用密码管理器生成至少 16 字符的随机口令，建议 32 字符，最长 256 字符。口令保留在本人密码管理器和 Worker Secret 中；分享口令的人也会获得网站访问权限。

口令保存后，在 GitHub **Settings → Secrets and variables → Actions → Variables** 添加仓库变量：

| Variable | 值 |
| --- | --- |
| `CROSSLAB_WORKERS_DEV` | `true` |

再次运行 `main` 工作流，生成配置将使用 `workers_dev:true`、`preview_urls:false`。部署日志提供生产地址。未登录时页面显示口令卡片，API 和静态文件返回 401；输入口令后才能访问工作台。分别检查未登录窗口与已登录窗口，再配置研究服务。

登录会话有效期为 8 小时，使用 `HttpOnly`、`Secure`、`SameSite=Strict` Cookie。打开 `/__crosslab/logout` 可退出当前浏览器；修改 Worker Secret 会使已有会话失效。口令缺失或短于 16 字符时返回 503，保持访问关闭。登录计数绑定缺失、异常或返回无效结果时返回 503，拒绝登录。

登录尝试由 `CROSSLAB_LOGIN_GUARD` 绑定的 `LoginAttemptCounter` 计数。每个网站来源与客户端 IP 的组合使用访问口令进行 HMAC 后定位同一个 Durable Object；对象只存次数和到期时间，不存明文 IP 或口令。首次尝试开始一个 60 秒窗口，最多接受 5 次口令校验，包括错误口令；后续尝试返回 429 和剩余等待秒数。共用 IP 的访问者共用计数。同步 SQLite 事务保证并发请求按同一计数处理，计数在 Worker 重启后保留；窗口过期后由 alarm 清理存储。更换口令会切换计数对象并使旧会话失效。

CI 使用固定迁移 `crosslab-login-v1`，以 `new_sqlite_classes: ['LoginAttemptCounter']` 创建 SQLite 存储，后续部署保留该迁移。SQLite Durable Objects 支持 Workers Free，无需升级付费计划，适用其免费用量限制。原生限流在首次生产验收中未触发，已从配置移除；新实现上线后仍需确认连续第 6 次错误尝试返回 429。参见 [Cloudflare Durable Objects 限制与 Free 支持](https://developers.cloudflare.com/durable-objects/platform/limits/)及 [SQLite 存储 API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)。

开关只接受小写 `true`；未设置、`false` 或其他值均关闭生产 URL。要再次关闭地址，修改变量并运行工作流；修改变量本身不会立即改变线上状态。预览 URL 在两种状态下都关闭。

访问口令模块仅在 `CROSSLAB_AUTH_REQUIRED=true` 时启用，GitHub CI 固定写入该值。本地开发未设置此标志时直接访问工作台。

## 4. 配置 SciencePal 运行环境

完成口令登录验收后，在 Cloudflare 中打开 `crosslab-sciencepal` 的 **Settings → Variables and Secrets**，配置：

| 名称 | 类型及值 |
| --- | --- |
| `RESEARCH_PROVIDER` | 运行变量，值为 `sciencepal` |
| `SCIENCEPAL_API_KEY` | Secret，填写自己的 SciencePal API Key |
| `SCIENCEPAL_AGENT_ID` | Secret，填写可用的 SciencePal Agent ID |

这些值存放在 Cloudflare，不写入 Git 源码。SciencePal 配置来源见[配置清单](sciencepal-setup.md)。演示模式使用 `RESEARCH_PROVIDER=demo`，不需要研究服务密钥。

## 5. 验证自动更新

在已登录会话中检查 `/api/sciencepal` 配置状态，运行一次研究请求并核对返回结果。后续推送到 `main` 后，核对对应提交的 Actions 记录与网站更新。每次运行摘要都会明确生产 URL 是否开启，预览 URL 始终关闭。
