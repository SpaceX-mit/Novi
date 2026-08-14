# Novi 实现进度

最近更新：2026-08-14

## 当前结论

Novi 的 Web、本地服务端、Linux Electron 基线以及 Knowledge Builder、Deep Research、Paper Author 三条核心产品路径已经实现并具有本地自动化验证证据。正式收费商用发布尚未完成，剩余工作主要是目标环境、真实供应商、跨平台签名安装、容量与安全验收等外部门禁。

当前开发机上的源码位于 NTFS/FUSE 挂载的 `/data`。该文件系统无法保存 Electron `chrome-sandbox` 所需的 `root:root 4755` 权限，因此直接执行 `npm run desktop` 仍不能显示 UI；需要将项目迁移到 ext4，或把 Electron runtime 安装到 `/opt` 后再完成一次真实窗口验收。这是当前环境问题，不是 UI 功能缺失。

## 已完成

| 范围 | 已实现内容 | 当前证据 |
| --- | --- | --- |
| 核心产品 | Knowledge Builder、Deep Research、Paper Author；成果版本、导出、Research/Knowledge/Writing/Review provenance | 默认测试与浏览器核心旅程覆盖 |
| Web 与 API | 共享 REST API/UI、工作区、知识导入与检索、异步 Job、来源刷新、成果历史、指标 | OpenAPI 3.1 契约共 35 paths / 40 operations；语法检查覆盖 38 modules |
| 账户与商业边界 | Cookie-only Web 会话、OIDC 边界、组织与 RBAC、配额、支付 provider 边界、审计与生命周期取消 | 本地 HTTP/provider 契约和领域测试通过；未配置真实支付 provider 时明确返回 503，不创建模拟订单 |
| 知识与生成 | 文本/Web/PDF/GitHub 导入、离线向量、RAG 上下文、来源连接器、Browser Agent/MCP 接口、连续更新 | 本地契约、集成和浏览器 smoke 已覆盖；真实来源仍需生产级人工核验 |
| 存储接口 | JSON 文件、PostgreSQL/pgvector、对象存储、Neo4j、持久 outbox | 本地 PostgreSQL/MinIO/Neo4j 路径已验证；目标托管实例仍待验收 |
| Web/容器交付 | Web 本地运行、Docker 多阶段非 root 运行、健康与就绪检查 | Docker 镜像已构建并检查；最近记录的镜像为 `sha256:5af027f80df589bc4f7fe746e3464669576e6c5bf28a3b8fd3b9300f7f0e0cb1` |
| Electron 构建兼容 | Node.js 商业开发基线设为 22.12+，`.nvmrc` 固定 22.22.2，desktop lifecycle 增加版本预检 | 已消除旧 Node 加载 `@noble/hashes` 时的 `ERR_REQUIRE_ESM` |
| Linux 桌面制品 | electron-builder 配置、安全 BrowserWindow、Linux unpacked/AppImage 构建与打包态 smoke | AppImage 已生成；最近记录 SHA-256 为 `b956734a2233861e8feb160ae7941142bb87a80559217f33efd715f5a403016d` |
| 自动化门禁 | 测试、语法、OpenAPI、供应商/存储契约、SBOM、依赖与镜像扫描、release-check | 最近记录：66 passed + 1 PostgreSQL 条件跳过；npm audit/Grype 0 vulnerabilities；SBOM 144 components；release-check 13 artifacts |

## 未完成

### 当前本地开发环境

- [ ] 将源码/`node_modules` 迁移到支持 Unix 权限的 ext4，或按 README 将 Electron 43.4.0 runtime 安装到 `/opt/novi-electron-43.4.0`。
- [ ] 在当前真实桌面会话运行 `npm run desktop`，确认窗口、内置服务和核心 UI 可见。自动化 Xvfb smoke 已通过，但不能代替这次人工桌面验收。

### 正式收费商用发布门禁

- [ ] 使用真实 LLM、支付、OIDC、Browser Agent、MCP 账号或目标服务完成端到端验收，归档供应商环境和回调证据。
- [ ] 在目标托管 PostgreSQL/pgvector、S3-compatible 对象存储和 Neo4j 上验证 TLS、IAM/最小权限、容量、生命周期、备份与恢复。
- [ ] 完成引用级领域专家抽检、失败来源处置规则和正式内容质量验收。
- [ ] 完成目标规模并发、向量/图检索、长时间 worker 和公网压力测试。
- [ ] 在托管 Git 仓库运行 CI，归档测试、SBOM、依赖/镜像扫描和发布证明；当前仅建立本地 Git 仓库，尚无远程托管和 CI 运行记录。
- [ ] 构建并验证 Windows NSIS 与 macOS DMG/ZIP 的真实签名、公证、安装、启动和升级 E2E。
- [ ] 为 Linux AppImage 采用组织批准的签名策略，并在干净的受支持发行版完成安装/启动验收。
- [ ] 完成外部渗透测试、许可证法律审核、生产监控告警和正式灾难恢复演练。

## 已知问题与处理状态

| 问题 | 根因 | 状态/处理 |
| --- | --- | --- |
| electron-builder 报 `ERR_REQUIRE_ESM`，无法加载 `@noble/hashes/blake2.js` | Node 20.18.1/22.11.0 等旧版本不支持该依赖组合所需的同步 ESM 加载边界 | 已修复：要求 Node 22.12+，使用 `.nvmrc` 的 22.22.2，并在 desktop 命令前预检 |
| `npm run desktop:dist` 后没有出现 UI | `desktop:dist` 是制品构建命令，只生成安装包，不负责启动应用 | 已澄清：开发启动使用 `npm run desktop`，构建后需单独运行产物 |
| `chrome-sandbox` 即使执行 `chmod 4755` 仍显示 `777` | `/data` 为 `fuseblk`/NTFS，不保存 Linux setuid 权限；Ubuntu AppArmor 同时限制非特权 user namespace | 环境待处理：推荐迁移到 ext4；或使用 README 中 root 管理的 `/opt` runtime。不得把正式启动默认改成 `--no-sandbox` |

## 下一步优先级

1. 完成当前机器 ext4 或 `/opt` Electron runtime 设置并人工确认桌面 UI。
2. 把源码置于真实 Git 托管仓库，运行已经配置的持续集成门禁并归档结果。
3. 接入真实供应商和目标基础设施，按 `docs/COMMERCIAL_READINESS.md` 第 3 节逐项关闭外部门禁。
4. 在 Windows、macOS 和干净 Linux 环境完成签名制品的安装、启动和升级验收。

## 更新记录

- 2026-08-14：建立实现进度文档；记录 Node/electron-builder 兼容修复、Linux AppImage 构建证据、当前 NTFS sandbox 阻塞和正式商用发布门禁；已建立本地 Git 初始提交，远程托管与 CI 仍未完成。
