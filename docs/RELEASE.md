# Novi 发布手册

本文描述源码已经实现的发布流程。只有托管 CI 的实际运行记录、签名验证结果和发布资产才能作为正式发布证据；本地构建成功不能替代它们。

## 1. 持续门禁

`.github/workflows/commercial-gates.yml` 在主分支、Pull Request 和手动触发时执行：

- Node 22 安装与固定镜像 digest 的真实 PostgreSQL + pgvector/HNSW 全测；
- 语法、OpenAPI、供应商/存储契约、CycloneDX/SPDX、在线 npm audit；
- Chromium 核心旅程、性能和并发检查；
- Linux/Windows/macOS x64/macOS arm64 的 Electron 发布制品构建；
- Linux AppImage 窗口级 smoke；
- 生产容器构建、Syft SBOM 归档及 Grype High/Critical 门禁。

第三方 GitHub Actions 均固定到审计时的完整 commit SHA。升级 action 版本时应重新运行 actionlint 和全套门禁。

生产部署若启用 JavaScript 渲染或 MCP 来源，分别把 `NOVI_BROWSER_AGENT_TOKEN`、`NOVI_MCP_SOURCE_TOKEN` 放入目标平台 secret manager；endpoint 使用 HTTPS，且不得把 token 拼进 URL。发布前对目标 Browser worker/MCP server 运行组织批准的协议、网络出口、容量和数据保留验收。本地 `provider-contract-check` 只验证 Novi 客户端边界。

## 2. 桌面签名发布

`.github/workflows/desktop-release.yml` 只接受与 `package.json` 版本严格匹配的 `v*` tag。发布仓库需配置：

| 平台 | 必需 Secret | 用途 |
| --- | --- | --- |
| Windows | `WINDOWS_CSC_LINK`、`WINDOWS_CSC_KEY_PASSWORD` | Authenticode 代码签名；流水线强制 `forceCodeSigning` 并复核签名为 `Valid` |
| macOS | `MACOS_CSC_LINK`、`MACOS_CSC_KEY_PASSWORD` | Developer ID Application 签名 |
| macOS | `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` | Apple 公证与 stapler 验证 |

发布流水线生成 Windows NSIS、macOS DMG/ZIP、Linux AppImage、完整/运行时 CycloneDX SBOM 和 `SHA256SUMS.txt`，所有矩阵任务成功后才创建或更新 GitHub Release。

Linux AppImage 当前不包含发行方密码学签名。正式发布前应选择组织批准的 Sigstore/GPG 策略，将验证公钥与安装说明发布到独立可信渠道。deb 目标暂未启用，因为项目尚未配置真实公开产品主页；不得以虚构 URL 绕过包元数据要求。

## 3. 本地预检

```bash
nvm install
nvm use
npm ci
npm run release-check
npm run desktop:dist -- --linux --x64
APPIMAGE_EXTRACT_AND_RUN=1 xvfb-run --auto-servernum npm run desktop-package-smoke -- dist/desktop/Novi-0.1.0-linux-x86_64.AppImage
```

Windows/macOS 的本地命令相同地使用 `--win --x64`、`--mac --x64` 或 `--mac --arm64`；正式产物必须由签名发布流水线生成，不能上传本地未签名构建。

## 4. 发布后验证

1. 在干净的目标操作系统安装并启动制品，确认首次运行数据写入 OS `userData`，卸载不删除用户数据。
2. 调用 `/api/billing` 确认未认证本地租户的 `limits.monthlyGenerations` 为 100；开发源码运行应为 1000。Electron 通过 `app.isPackaged` 自动设置发布边界，生产 Web 通过 `NODE_ENV=production` 设置，不依赖发布人员手工修改源码。
3. 验证签名、公证、下载校验和及 SBOM；从已发布 URL 重新下载后再验证一次。
4. 对登录、创建工作区、异步生成、导出、删除和升级/回滚执行 E2E。
5. 保留构建日志、签名主体、制品哈希、扫描数据库时间及回滚版本。
