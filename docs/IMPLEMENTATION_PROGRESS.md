# Novi 实现进度

最近更新：2026-08-17

## 当前结论

Novi 的 Web、本地服务端、Linux Electron 基线以及三条核心产品路径已经实现并具有本地自动化验证证据。Web 支持主流 LLM Provider、自适应 LangGraph 模式、Goal 驱动的参考发现与领域专家协作、最终 LLM Wiki、默认中文/可选多语言生成、Workspace Markdown 预览、持久 Agent Session、内置/自定义/MCP 工具、组织 Skills 和声明式 Plugins。正式收费商用发布尚未完成，剩余工作主要是持久 Agent checkpoint、目标环境和正式发布门禁。

当前开发机上的源码位于 NTFS/FUSE 挂载的 `/data`。该文件系统无法保存 Electron `chrome-sandbox` 所需的 `root:root 4755` 权限，因此直接执行 `npm run desktop` 仍不能显示 UI；需要将项目迁移到 ext4，或把 Electron runtime 安装到 `/opt` 后再完成一次真实窗口验收。这是当前环境问题，不是 UI 功能缺失。

## 已完成

| 范围 | 已实现内容 | 当前证据 |
| --- | --- | --- |
| 核心产品 | Knowledge Builder、Deep Research、Paper Author；成果版本、导出、Research/Knowledge/Writing/Review provenance | 默认测试与浏览器核心旅程覆盖 |
| Web 与 API | 共享 REST API/UI、工作区、知识导入与检索、异步 Job/Agent 模式与阶段、来源刷新、成果历史、Provider/Tools/MCP/Skills/Plugins 设置、指标 | OpenAPI 3.1 契约共 46 paths / 58 operations；语法检查覆盖 46 modules |
| 账户与商业边界 | Cookie-only Web 会话、OIDC 边界、组织与 RBAC、配额、支付 provider 边界、审计与生命周期取消；本地开发租户每月 1000 次生成，生产/打包态自动收紧为 100 次 | 本地 HTTP/provider 契约和领域测试通过；登录账户套餐额度保持独立；未配置真实支付 provider 时明确返回 503，不创建模拟订单 |
| 知识与生成 | 文本/Web/PDF/GitHub 导入、离线向量、RAG 上下文、来源连接器、Browser Agent/MCP 接口、Goal/专家角色/Knowledge System/System Document/LLM Wiki 生成、默认中文和 8 种生成语言、每版本 `llm-wiki.md`、连续更新 | 本地契约、集成和 desktop/mobile 浏览器 smoke 已覆盖；真实来源与多语言供应商质量仍需生产级人工核验 |
| Agent Runtime | 意图路由的 Workflow、ReAct、Plan & Execute、Supervisor 四模式 LangGraph.js StateGraph；Goal Architect → Goal 驱动 Reference Discovery → Research/Knowledge/Writing/Review specialist → 必经 LLM Wiki Finalizer；独立 LangGraph chat Harness；controller/阶段 fallback 可运行中切换模式，最多 8 个 Specialist 步骤；字段/形状校验、token、语言、参考 provenance、模式历史、计划和 Job 进度可追溯 | 本地 OpenAI-compatible HTTP 验证四种成果模式、7 节点 Goal/Reference/专家协作/Finalizer、论文/GitHub/Web 来源、检索失败退款、提前 finish 仍经 Finalizer、ReAct → Plan & Execute 运行中切换，以及对话模型调用/工具循环；Chromium 验证模式、语言、Markdown 与 Paper LLM Wiki |
| Agent Session | 项目默认 Session、会话 API、异步 LLM 对话与独立 Artifact generation、active run、Goal/reference 状态、Job/Artifact 关联、隔离/恢复/清理；Web 左栏 Session、中央对话与 mode/language composer、右栏 Files/LLM Wiki/Document，生成 Markdown 安全预览，viewer 只读 | Session 领域/HTTP/恢复测试通过；Chromium 完整旅程验证 Composer 返回 LLM 消息且不创建 Artifact，Generate now 独立生成成果，Session 创建/删除、8 种语言、`llm-wiki.md` 纯文本预览、inspector 与 RBAC |
| Agent Tools | 左侧 Customize/Tools；内置 workspace read/write/web search；最多 10 个 allowlisted 自定义 HTTP 工具、严格标量 input schema、可选 AES-GCM Bearer token；ReAct/Plan/Supervisor 工具节点、最多 6 次调用、超时/32 KB 响应限制、Job/Session/Artifact provenance | 领域测试覆盖端点/schema/加密/租户项目隔离/响应上限；LangGraph 测试覆盖三种自主模式和 6 次硬上限；异步 HTTP 测试验证 Job/Session/Artifact 三处记录；desktop/mobile Chromium 验证 Customize、RBAC 和无横向溢出 |
| Agent MCP | 左侧 Customize/MCP；最多 5 个租户级 Streamable HTTP server；官方 SDK 发现与调用、最多 100 tools/server、命名空间别名、新工具默认关闭、逐工具授权；AES-GCM Bearer token、endpoint allowlist、schema/超时/256 KB 响应边界；MCP tool 进入同一 LangGraph 工具节点和 provenance | 官方 SDK server/client 集成覆盖 initialize/list/call、输入校验和结果规范化；HTTP/RBAC/加密/备份删除测试通过；desktop/mobile Chromium 验证配置入口、显式授权和 viewer 只读边界 |
| Agent Skills | 左侧 Customize/Skills；最多 20 个租户 playbook，名称/用途/4000 字符指令、产品范围、always/auto 和触发词；按显式 `/skill`、always、触发词选最多 3 个注入 Planner/Controller/Specialist；不能授权工具/来源或覆盖 schema；Job/Session/Artifact 固化选择与指令哈希 | 领域测试覆盖校验、隔离、匹配优先级和上限；真实 HTTP+LangGraph 测试确认 prompt 注入及四处 provenance；desktop/mobile Chromium 验证保存和无横向溢出 |
| Agent Plugins | 左侧 Customize/Plugins；最多 10 个声明式版本化 manifest，每次选 2 个；组合现有 Skill 与已授权 Tool/MCP，运行时工具取交集；不加载代码/密钥/远程包；Job/Session/Artifact 固化 manifest 哈希 | 领域/HTTP 测试覆盖引用校验、组合、RBAC、生命周期和 prompt；desktop/mobile Chromium 覆盖即时 reference catalog 刷新和保存 |
| LLM Provider Web 配置 | OpenAI、Anthropic、Google、DeepSeek、MiniMax、OpenRouter、Mistral、xAI、Groq、Azure OpenAI、Ollama、自定义兼容服务；租户隔离、owner/admin RBAC、连接测试、Offline mode | Chromium smoke 与 API/RBAC 测试通过；API Key AES-256-GCM 加密且不进入 API/导出响应 |
| 存储接口 | JSON 文件、PostgreSQL/pgvector、对象存储、Neo4j、持久 outbox | 本地 PostgreSQL/MinIO/Neo4j 路径已验证；目标托管实例仍待验收 |
| Web/容器交付 | Web 本地运行、Docker 多阶段非 root 运行、健康与就绪检查 | Docker 镜像已构建并检查；最近记录的镜像为 `sha256:5af027f80df589bc4f7fe746e3464669576e6c5bf28a3b8fd3b9300f7f0e0cb1` |
| Electron 构建兼容 | Node.js 商业开发基线设为 22.12+，`.nvmrc` 固定 22.22.2，desktop lifecycle 增加版本预检 | 已消除旧 Node 加载 `@noble/hashes` 时的 `ERR_REQUIRE_ESM` |
| Linux 桌面制品 | electron-builder 配置、安全 BrowserWindow、Linux unpacked/AppImage 构建与打包态 smoke | AppImage 已生成；最近记录 SHA-256 为 `b956734a2233861e8feb160ae7941142bb87a80559217f33efd715f5a403016d` |
| 自动化门禁 | 测试、语法、OpenAPI、供应商/存储契约、浏览器、SBOM、依赖与镜像扫描、release-check | 最近记录：83 passed + 1 PostgreSQL 条件跳过；48 个 JavaScript 模块语法通过；OpenAPI 47 paths / 59 operations；锁文件 SBOM 422 components / 129 runtime；desktop/mobile 浏览器、Provider/存储契约和 release-check 通过；既有开发/打包 Electron smoke 证据保持有效 |

## 未完成

### 当前本地开发环境

- [ ] 将源码/`node_modules` 迁移到支持 Unix 权限的 ext4，或按 README 将 Electron 43.4.0 runtime 安装到 `/opt/novi-electron-43.4.0`。
- [ ] 在当前真实桌面会话运行 `npm run desktop`，确认窗口、内置服务和核心 UI 可见。自动化 Xvfb smoke 已通过，但不能代替这次人工桌面验收。

### Agent Runtime 后续

- [ ] 远程 Plugin marketplace、第三方签名包与可执行沙箱未实现；当前 Plugins 仅声明式组合现有能力，不运行租户代码。
- [ ] 将 LangGraph `MemorySaver` 换成生产数据库持久 checkpoint，并验证服务重启后的安全节点级恢复；当前只持久化 Novi Job/阶段状态，中断任务仍按失败退款处理。
- [ ] 使用真实账号评测工具选择质量、失败恢复、调用成本和 workspace write 审批策略；当前工具输出按不可信数据处理，只有 concrete verified sources 可进入 evidence。
- [ ] 旧 `NOVI_LLM_BASE_URL/API_KEY/MODEL` 环境变量路径仍使用原有单次模型网关；需要迁移为统一 LangGraph 配置或在后续版本弃用。

### 正式收费商用发布门禁

- [ ] 使用真实 LLM、支付、OIDC、Browser Agent、MCP 账号或目标服务完成端到端验收，归档供应商环境和回调证据。
- [ ] 在目标托管 PostgreSQL/pgvector、S3-compatible 对象存储和 Neo4j 上验证 TLS、IAM/最小权限、容量、生命周期、备份与恢复。
- [ ] 完成引用级领域专家抽检、失败来源处置规则和正式内容质量验收。
- [ ] 完成目标规模并发、向量/图检索、长时间 worker 和公网压力测试。
- [ ] 在已配置的 GitHub 远程仓库运行 CI，归档测试、SBOM、依赖/镜像扫描和发布证明；源码已提交至远程，但尚无托管 CI 运行记录。
- [ ] 构建并验证 Windows NSIS 与 macOS DMG/ZIP 的真实签名、公证、安装、启动和升级 E2E。
- [ ] 为 Linux AppImage 采用组织批准的签名策略，并在干净的受支持发行版完成安装/启动验收。
- [ ] 完成外部渗透测试、许可证法律审核、生产监控告警和正式灾难恢复演练。

## 已知问题与处理状态

| 问题 | 根因 | 状态/处理 |
| --- | --- | --- |
| electron-builder 报 `ERR_REQUIRE_ESM`，无法加载 `@noble/hashes/blake2.js` | Node 20.18.1/22.11.0 等旧版本不支持该依赖组合所需的同步 ESM 加载边界 | 已修复：要求 Node 22.12+，使用 `.nvmrc` 的 22.22.2，并在 desktop 命令前预检 |
| `npm run desktop:dist` 后没有出现 UI | `desktop:dist` 是制品构建命令，只生成安装包，不负责启动应用 | 已澄清：开发启动使用 `npm run desktop`，构建后需单独运行产物 |
| `chrome-sandbox` 即使执行 `chmod 4755` 仍显示 `777` | `/data` 为 `fuseblk`/NTFS，不保存 Linux setuid 权限；Ubuntu AppArmor 同时限制非特权 user namespace | 环境待处理：推荐迁移到 ext4；或使用 README 中 root 管理的 `/opt` runtime。不得把正式启动默认改成 `--no-sandbox` |
| MiniMax 表单填写后测试显示 `No active LLM provider configured` | 原 UI 的 Test 只测试已激活配置，不保存刚填写的表单；状态文件确认 `llmProviderConfigs` 为空 | 已修复：按钮改为 `Save & test`，先 PUT 加密保存/激活当前表单，再 POST 测试连接；已暴露的旧 Key 必须在供应商侧轮换 |
| 桌面手动测试提示达到本月限制次数 | 未认证桌面租户沿用 Free Preview 每月 5 次生成额度，开发测试很快耗尽 | 已修复：`tenantId=local` 在开发态为 1000 次；生产 Web 或 Electron 打包态自动为 100 次，登录账户套餐额度不变 |
| Composer 对话始终返回 `...is organized as a progressive knowledge system...` | Composer 错误复用 Artifact `/generate` API；无 Provider 时生成离线模板 Artifact，再把模板 `summary` 当作助手消息。桌面 `userData` 中同时没有激活 Provider | 已修复：Composer 使用独立异步 LangGraph chat Harness，必须有当前实例的激活 Provider，返回自然语言消息且不创建 Artifact；成果按钮保留 Artifact 路径；无 Provider 明确返回 `LLM_PROVIDER_REQUIRED`，不扣配额、不静默模板回退 |

## 下一步优先级

1. 将 LangGraph MemorySaver 替换为生产数据库 checkpoint，并验证节点级重启恢复。
2. 设计远程 Plugin 供应链/签名/沙箱门禁；没有明确生产需求前不加载第三方代码。
3. 完成当前机器 ext4 或 `/opt` Electron runtime 设置并人工确认桌面 UI。
4. 在已配置的 GitHub 远程仓库运行持续集成门禁并归档结果；随后接入真实供应商/目标基础设施并关闭正式发布门禁。

## 更新记录

- 2026-08-17：完成 Goal 驱动参考发现、多语言 LLM Wiki 与 Workspace Markdown 闭环：LangGraph 拓扑升级为 Goal → Reference Discovery → Research → Knowledge → Writing → Review → Finalizer，Reference 只在 Goal 完成后用 question/domain/outcome/scope 构造最长 300 字符查询；真实连接器覆盖论文、GitHub 和 Web，关闭实时来源记录 `offline`，使用既有快照记录 `provided`，检索失败记录 `fallback` 并退还来源额度。Job/Session 运行中保存并展示 Goal、查询、状态、来源数量/类型；Artifact/runtime 固化 reference provenance。Project 默认 `wikiLanguage=zh-CN`，Generate 可在 8 种 allowlist 语言间覆盖，Prompt 强制目标语言并保留 URL/代码/引用标识；这是生成内容 i18n，不宣称完整 UI 已本地化。每个不可变 Artifact 固化与导出一致的 `llm-wiki.md`，Web Files → Document 以转义纯文本预览。为使 DNS 重写环境中的导入测试保持安全可测，`createServer` 支持仅由测试注入 DNS lookup；生产默认仍使用系统 DNS，Browser Agent 的目标和最终 URL 均复核。验证：`npm test` 83 passed + 1 PostgreSQL 条件跳过，`npm run check` 48 modules，`npm run openapi-check` 47 paths / 59 operations，desktop/mobile `npm run browser-smoke`、`npm run release-check` 和 `git diff --check` 通过。真实供应商的多语言质量、实时来源内容质量、生产 checkpoint 和正式发布门禁仍未完成。

- 2026-08-17：完成 Generate 的 Goal 驱动专家协作与最终 LLM Wiki 闭环：新增结构化 `expertGoal`、`expertRoles`、`knowledgeSystem`、`systemDocument`、`llmWiki` 契约；LangGraph 统一执行 Goal Architect → Research → Knowledge → Writing → Review → LLM Wiki Finalizer，Workflow/ReAct/Plan & Execute/Supervisor 的提前结束和 specialist 上限路径均强制经过 Finalizer；Goal 阶段校验四个领域角色覆盖，Finalizer 校验 Wiki 完整性并同步兼容 `wikiSections`；离线生成保持同形状基线。Web 为三种产品展示 Goal、专家团队、知识体系、体系文档和最终 Wiki，Paper Author 新增 LLM Wiki 标签；Markdown/LaTeX、版本比较和 claim extraction 覆盖新字段。验证：`npm test` 81 passed + 1 PostgreSQL 条件跳过，`npm run check` 47 modules，`npm run openapi-check` 47 paths / 59 operations，`npm run browser-smoke` 通过（含 Paper LLM Wiki、研究套件、导出和响应式旅程）。真实供应商质量、生产 checkpoint 和发布门禁仍未完成。

- 2026-08-17：修复 Workspace Composer 未接入 LLM 对话的问题：新增 `POST /api/projects/:id/sessions/:sessionId/messages` 和独立 LangGraph chat Harness，使用当前 Provider、会话历史、Workspace knowledge、Skills/Plugins，并在 ReAct/Plan & Execute/Supervisor 下允许最多 6 次已授权 Tool/MCP 调用；响应保存为普通 Session message 和无凭据 runtime provenance，不创建 Artifact。Generate now/Generate asset 继续走独立成果路径。无激活 Provider 时在扣配额前明确返回 409 `LLM_PROVIDER_REQUIRED`，不再把离线模板摘要伪装为回答；chat/generation 在同一 Session 互斥并支持异步 Job 恢复/失败退款。桌面实际状态审计显示 `~/.config/Electron/novi.json` 的 Provider 列表为空，用户需在桌面实例内重新 `Save & test` MiniMax。验证：`npm test` 81 passed + 1 PostgreSQL 条件跳过，`npm run check` 47 modules，`npm run openapi-check` 47 paths / 59 operations，`npm run browser-smoke` 验证 Composer→LLM 且 Artifact 数不变，`npm run release-check`、隔离 userData 的开发 Electron smoke、`npm run desktop:dir -- --linux --x64` 和真实 packaged smoke 通过。
- 2026-08-17：调整未认证本地租户的生成配额：源码开发运行每月 1000 次，`NODE_ENV=production` Web 和 `app.isPackaged` Electron 制品自动使用每月 100 次；Free/Personal/Pro/Enterprise 登录账户套餐保持原值。补充开发/发布边界和 Electron 窗口断言，并将发布后 `/api/billing` 100 次核验写入发布手册。验证：`npm test` 80 passed + 1 PostgreSQL 条件跳过，`npm run check` 46 modules，`npm run openapi-check` 46 paths / 58 operations，`npm run browser-smoke`、`npm run release-check`、图形会话中的 `npm run desktop-smoke`、`npm run desktop:dir -- --linux --x64` 和真实 `linux-unpacked` package smoke 均通过。
- 2026-08-14：完成 Agent / Workspace 八项目标的逐项审计并补充 `docs/GOAL_TRACEABILITY.md`：四模式意图路由和运行中重新调度、当前模式显示、内置/自定义 Tool、MCP、Skills、声明式 Plugins、默认 Conversation Session、右侧 Files/LLM Wiki/Document、左侧 Customize 与 Generate now Session 旅程均有源码和自动化直接证据。验证：`npm test` 79 passed + 1 PostgreSQL 条件跳过、`npm run check` 46 modules、`npm run openapi-check` 46 paths / 58 operations、desktop/mobile `npm run browser-smoke` 和 `npm run release-check` 通过。OpenHands 仅作为交互与能力分层参考，Novi 保持独立的 LangGraph.js、有界权限和租户隔离实现。生产数据库 checkpoint、远程可执行 Plugin marketplace 和真实供应商验收仍作为后续项，不属于这八项本地功能完成判定。
- 2026-08-14：完成声明式 Agent Plugins：Customize/Plugins 可配置最多 10 个版本化 manifest，每次按显式 `/plugin`、always、触发词选择 2 个，组合最多 5 个现有 Skill 与 10 个已授权工具；运行时工具引用再次与 registry 取交集，失效引用不获权限。Plugin 不下载包、不执行租户代码、不携带密钥；Job、Session、Artifact 固化实际组合和 manifest SHA-256。引用目录在 Tools/MCP/Skills 保存后即时刷新。验证：`npm test` 79 passed + 1 PostgreSQL 条件跳过、`npm run check` 46 modules、`npm run openapi-check` 46 paths / 58 operations、desktop/mobile browser smoke、release-check/SBOM 通过。远程 marketplace、签名可执行包与持久 checkpoint 仍未实现。
- 2026-08-14：完成组织 Agent Skills 纵向闭环：Customize/Skills 可由 owner/admin 配置最多 20 个租户 playbook，限制名称、用途、4000 字符指令、产品范围、always/auto 和最多 12 个触发词；LangGraph 在运行开始按显式 `/skill name`、always、触发词确定性选择最多 3 个，注入 Planner、ReAct/Supervisor Controller 和四个 Specialist。Skill 不增加工具/来源权限，不覆盖 evidence/schema/运行硬上限；无 Web Provider 时不记录虚假应用。实际选择进入异步 Job、Session active run/完成消息和 Artifact runtime，成果只固化元数据、匹配原因和指令 SHA-256。配置、RBAC、账户导出/删除、JSON/PostgreSQL、备份恢复和 Web provenance 已覆盖。验证：`npm test` 78 passed + 1 PostgreSQL 条件跳过、`npm run check` 45 modules、`npm run openapi-check` 45 paths / 56 operations、desktop/mobile `npm run browser-smoke`、`npm run release-check` 与 SBOM 通过。Plugins 与数据库 checkpoint 仍未实现。
- 2026-08-14：完成通用 Agent MCP 纵向闭环：Customize/MCP 可由 owner/admin 配置最多 5 个租户级 Streamable HTTP server，通过官方 `@modelcontextprotocol/sdk` 发现最多 100 个工具；新工具默认关闭，逐项授权后才以稳定命名空间进入 ReAct、Plan & Execute、Supervisor 的既有 LangGraph tool node。远端 endpoint 强制 HTTPS/host allowlist，Bearer token AES-GCM 加密且 endpoint 变化时清除；schema 限制 16 KB/12 层并在调用前验证，请求超时最多 30 秒、POST 响应最多 256 KB，二进制结果不进入模型上下文，MCP observation 不自动成为 evidence。配置、发现、调用、RBAC、导出/删除/备份和 Job/Session/Artifact provenance 已覆盖；MCP Tasks、OAuth、stdio、prompts/resources 直接注入明确不支持。验证：`npm test` 77 passed + 1 PostgreSQL 条件跳过、`npm run check` 44 modules、`npm run openapi-check` 44 paths / 54 operations、desktop/mobile `npm run browser-smoke`、`npm run release-check`、SBOM 和 npm 官方 registry audit 通过。Skills、Plugins 与数据库 checkpoint 仍未实现。
- 2026-08-14：完成 Agent 内置/自定义工具纵向闭环：左侧 Customize/Tools 可由 owner/admin 配置 workspace read/write/web search 和最多 10 个 allowlisted 自定义 HTTP 工具，Bearer token 加密且不进入 API/导出；ReAct、Plan & Execute、Supervisor 已接入 LangGraph tool 节点，调用次数、超时、输入 schema、响应大小、租户/项目写入边界和取消检查受限；Job、完成 Session 消息和 Artifact 保存调用 provenance，Web 显示运行阶段、会话工具标签和 Artifact tool activity。验证：`npm test` 75 passed + 1 PostgreSQL 条件跳过、`npm run check` 43 modules、`npm run openapi-check` 42 paths / 51 operations、`npm run browser-smoke` 在 1360×900 与 390×844 通过、`npm run release-check` 通过。通用 MCP、Skills、Plugins 与数据库 checkpoint 仍未实现。
- 2026-08-14：完成 Conversation Session Web 工作区：创建项目直接进入默认 Session；左栏支持新建/切换/删除空闲 Session；中央持久显示消息、mode/stage/progress 与 Artifact 链接，composer 支持 Auto/Workflow/ReAct/Plan & Execute/Supervisor，并在 inspector 重绘时保留未发送草稿和 mode；`Generate now` 进入当前 Session；右栏提供 Files、LLM Wiki、Document inspector 并保留版本比较、知识和导出能力；active Job 可在重开页面后恢复轮询，viewer 为只读。验证：`npm test` 72 passed + 1 skip、`npm run check` 42 modules、扩展 `npm run browser-smoke` 在 1360×900 与 390×844 均通过，`npm run release-check` 通过，截图确认无横向溢出或控件遮挡；Tools/MCP/Skills/Plugins Customize 仍未实现。
- 2026-08-14：完成 Agent Session 后端纵向闭环：项目创建默认 Session；提供租户/项目隔离的列表、新建、详情、空闲删除 API；同步/异步生成保存用户/助手消息、active mode/stage/progress、Job 与 Artifact 关联；服务重启写失败消息并解除运行状态；项目/账户删除、账户导出、JSON/PostgreSQL 状态和备份恢复均包含 Session。同步生成的项目与 Session 开始状态合并为同一事务，避免删除竞态。验证：`npm test` 72 passed + 1 skip、`npm run check` 42 modules、`npm run openapi-check` 41 paths / 49 operations、`npm run browser-smoke`、`npm run release-check`（Provider/存储/SBOM）通过；Conversation Session UI 仍待下一独立功能实现。
- 2026-08-14：完成自适应 Agent 执行模式纵向闭环：中英文意图路由 Workflow/ReAct/Plan & Execute/Supervisor，controller 可在运行中转模式，阶段 fallback 升级 Supervisor；Job/成果保存模式、切换历史、计划、controller 事件与 token，Web 实时显示模式/阶段/进度并禁止运行中重复生成。验证：`npm test` 70 passed + 1 skip、`npm run check` 41 modules、`npm run openapi-check` 39 paths / 45 operations、`npm run browser-smoke` 及 1360×900/390×844 Chromium 截图通过，`npm run release-check` 及 Provider/存储/SBOM 契约通过；工具循环、MCP/Skill/Plugin 运行时与对话 Session UI 仍待实现。
- 2026-08-14：将功能交付节奏固化到 `AGENTS.md`：每个可独立验收的完整功能或修复必须单独完成验证、进度更新、commit 与 push，推送成功后再开始下一项功能。
- 2026-08-14：将 LangGraph 四阶段 Runtime、Web LLM Provider/MiniMax 配置及局域网监听改动提交并推送至 GitHub `origin/main`；变更文件未发现凭据形状的明文，本地运行数据和配置密钥保持忽略。托管 CI 运行与证据归档仍待完成。
- 2026-08-14：修复 Provider 初次配置的测试顺序；`Save & test` 现在先保存当前 MiniMax/其他 Provider 表单再测试，避免尚无 active 配置时返回 409。验证：`npm test` 68 passed + 1 skip、`npm run browser-smoke`、`npm run check`、`npm run openapi-check` 通过。用户在对话中暴露的 Key 未写入代码或状态文件，必须撤销轮换。
- 2026-08-14：记录认证式局域网启动方式；当前机器用 `HOST=0.0.0.0`、`NOVI_AUTH_REQUIRED=true` 监听 TCP 4173，并以 `http://10.0.90.51:4173` 作为局域网入口。`ss` 确认 `0.0.0.0:4173`，本机局域网地址与独立 Docker 网络命名空间访问 `/api/health` 均返回 200，未登录 `/api/projects` 返回 401。UFW 为 active，但当前账户无 sudo 权限读取具体规则；仍建议从目标物理主机验证，不将开发 HTTP 服务视为公网部署。
- 2026-08-14：增加国内 MiniMax Provider（`https://api.minimaxi.com/v1`，默认 `MiniMax-M3`）并接入 Web 目录、OpenAPI、浏览器 smoke 和加密配置验证。Provider 总数为 12 类；`npm test` 68 passed + 1 skip、`npm run browser-smoke`、`npm run check`、`npm run openapi-check`、`npm run release-check` 通过。真实 MiniMax 账号连接和模型质量仍属于正式商用外部门禁。
- 2026-08-14：采用 LangGraph.js 完成 Web Provider 驱动的 Research → Knowledge → Writing → Review 四阶段运行时；增加 12 类 Provider 的租户级 Web 配置、AES-GCM 密钥保护、endpoint allowlist、连接测试、RBAC 和 Job 阶段进度。验证：`npm test` 68 passed + 1 skip、`npm run browser-smoke`、`npm run check`、`npm run openapi-check`、`npm run provider-contract-check`、`npm run sbom-check`、`npm run release-check` 和 npm 官方 registry audit 通过。仍缺真实厂商账号 E2E、跨重启 LangGraph checkpoint 和阶段内工具循环。
- 2026-08-14：建立实现进度文档；记录 Node/electron-builder 兼容修复、Linux AppImage 构建证据、当前 NTFS sandbox 阻塞和正式商用发布门禁；已建立本地 Git 初始提交，远程托管与 CI 仍未完成。
