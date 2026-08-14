# Novi 软件需求规格说明（SRS）

## 1. 系统上下文

Web 浏览器或 Electron 客户端通过 HTTP REST API 访问 Novi 服务。服务管理个人/组织工作空间、调用知识智能引擎、保存成果并提供导出。单实例/桌面模式使用 JSON；生产模式使用带事务和租户投影的 PostgreSQL、pgvector/HNSW 片段检索，并可将原文投影到对象存储、实体关系投影到 Neo4j。目标规模 Vector/Graph 容量调优仍是部署验收边界。

## 2. 功能需求

| ID | 需求 | 验收条件 | 实现证据 |
| --- | --- | --- | --- |
| FR-01 | 创建工作空间 | 标题、主题、类型有效时返回 201；无效返回 422 | `POST /api/projects` |
| FR-02 | 列出并查看项目 | 列表按创建时间展示，详情返回全部成果 | `GET /api/projects[/:id]` |
| FR-03 | Knowledge Builder | 生成覆盖 What/Why/Architecture/Core Components/Usage/Advanced/Interview/Project 的 Wiki、四阶段路线、案例/分级练习及完成标准、知识图谱和机会；Web 与 Markdown 均可访问 | `src/engine.mjs`, `public/app.js` |
| FR-04 | Deep Research | 分别生成并展示 Research Report、LLM Wiki、Knowledge Graph、来源、SOTA 与研究机会，Markdown 保留全部输出 | `src/engine.mjs`, `public/app.js` |
| FR-05 | Paper Author | 生成题目、摘要、完整章节、research gap、所需证据、可证伪测试、novelty matrix、贡献、方法、实验、结构化图表和模拟审稿意见；图表在 Web 渲染为 SVG、Markdown 导出为 Mermaid、LaTeX 导出为可编译 picture figure；API/Web 支持 IEEE conference 与 ACM sigconf 模板 | `src/engine.mjs`, `public/app.js`, `artifactToLatex()` |
| FR-06 | 个人知识资产 | 数据重启后保留，可置顶；admin 删除工作空间时级联删除成果、Job、知识、关注配置和来源快照 | JSON Store 与 pin/delete API |
| FR-07 | 导出 | 有成果时导出 Markdown；论文可导出 LaTeX | export API |
| FR-08 | Web UI | 桌面和移动宽度可完成核心旅程 | `public/` |
| FR-09 | Desktop UI | 独立窗口启动内置服务并加载完整 UI | `desktop/main.cjs` |
| FR-10 | 健康检查 | 返回版本和 `ok` 状态；就绪检查验证存储可读 | `GET /api/health`, `GET /api/ready` |
| FR-11 | 可选实时检索 | 启用实时模式时查询 OpenAlex、arXiv、Wikipedia、Crossref，并通过 DOI prefix 定向查询 IEEE、ACM、Springer 目录，同时覆盖 GitHub、Semantic Scholar、Hugging Face、Stack Exchange、Reddit、RFC Editor，并可选接入 YouTube、Internet Archive Books & Reports、Hacker News Blogs、GitHub Official Docs；统一输出名称、类型、URL、权威度、发布时间、摘要、确定性相关性分数和证据映射状态，过滤非 HTTP(S) URL 并按质量排序；连接失败不阻断成果生成 | `GET /api/search`, `src/connectors.mjs` |
| FR-12 | 账户与隔离 | 注册、登录、注销；强制模式下项目和 Job 只能被所属租户访问 | `src/auth.mjs`, `/api/auth/*` |
| FR-13 | 异步生成 | `?async=true` 返回 202 Job；状态可查询 queued/running/completed/failed；消费者通过事务性 claim 防止重复执行 | `/api/jobs/:id`, `runGeneration`, `claimJob` |
| FR-14 | 模型网关 | 配置 OpenAI-compatible 环境变量后使用结构化 JSON 生成；调用失败回退且记录日志 | `src/model.mjs` |
| FR-15 | 数据可携带性 | 已认证用户可导出其账户、项目、Job、知识文档/分块/图、关注配置、来源快照和审计数据 JSON | `GET /api/me/export` |
| FR-16 | 账户删除 | 已认证用户可删除账户及其租户内项目、Job、知识资产、关注配置、来源快照、会话和审计数据 | `DELETE /api/me` |
| FR-17 | 计划与配额 | Free/Pro/Enterprise 计划记录生成和来源查询用量，超限返回 402 | `src/billing.mjs`, `/api/billing`, `/api/usage` |
| FR-18 | 证据溯源 | 成果包含通过 HTTP(S) 校验的来源 URL、内容哈希、claim 映射和核验状态/免责声明；live source concrete URL 在进入 claim 前执行 DNS/SSRF、重定向、大小和可访问性验证 | `src/evidence.mjs`, `src/engine.mjs` |
| FR-19 | 备份恢复 | v3 数据文件可通过原子 CLI 备份和格式校验恢复 | `src/backup.mjs`, `npm run backup/restore` |
| FR-20 | 任务恢复与幂等 | 同一项目同时只允许一个生成任务；服务重启将 queued/running Job 标记失败、按原扣费月份退款；删除工作空间或发起任务的成员账户时移除未完成 Job、只退款一次，worker 在模型调用和成果提交前重新确认 Job、项目及 membership，禁止删除后的幽灵成果提交 | `src/store.mjs`, `src/billing.mjs`, `runGeneration`, `removeJobs` |
| FR-21 | 订阅支付 | 仅 owner/admin 可请求 checkout；无 provider 明确返回 503；签名 webhook 幂等更新订阅和计划；工作台只向 owner/admin 显示升级入口 | `src/payments.mjs`, `/api/billing/*`, `public/app.js` |
| FR-22 | 组织 RBAC | owner/admin 可邀请、变更和移除成员；viewer 无法创建/生成/修改/删除项目或知识，editor 可写内容但不能删除工作空间或发起 checkout；Web 根据实时 membership 隐藏越权控件，成员可在 UI/API 中切换组织，切换时轮换会话且 Web 响应不暴露 token | `src/rbac.mjs`, `/api/orgs`, `/api/org/*`, `/api/auth/switch`, `applyRoleCapabilities` |
| FR-23 | OIDC SSO | 配置 issuer/client 后走 Authorization Code；state 一次性、10 分钟过期并绑定发起浏览器的 HttpOnly 状态 Cookie；userinfo 必须含 verified email；回调建立本地会话 | `src/oidc.mjs`, `/api/auth/oidc/*` |
| FR-24 | 可插拔持久化 | 保持 Repository 合约；本地 JSON 与可选 PostgreSQL 事务适配器可切换，写事务使用 `SELECT ... FOR UPDATE`，并维护租户/项目/Job/文档带索引关系投影 | `src/repository.mjs`, `src/postgres-store.mjs` |
| FR-25 | 知识摄取与结构化 | 项目可导入文本/代码笔记，生成内容哈希、分块、确定性离线向量、实体和关系；同一租户项目按内容哈希幂等去重；PostgreSQL 投影向量，配置对象存储/Neo4j 时通过持久 outbox 同步原文和图关系，失败按退避重试并在启动后恢复；数据按租户隔离并随项目/账户删除，删除任务同样可重试 | `src/knowledge.mjs`, `src/external-projection.mjs`, `src/object-store.mjs`, `src/graph-store.mjs`, `POST /api/projects/:id/knowledge` |
| FR-26 | 持续更新 | 项目可保存手动/每日/每周关注配置及 `autoUpdate` 开关；手动或后台刷新按 URL 和内容哈希/发布日期/更新时间/名称/摘要比较最近已成功应用的来源基线，记录新增、更新、移除数量和租户隔离快照；有变化且允许自动更新时，原子扣除生成额度、创建 `continuous-update` Job、检索最多 6 条工作区知识并生成新的不可变成果，成果绑定 snapshot ID；相同来源不重复生成，disabled/busy/quota/failed 不推进已应用基线并可在后续周期重试；来源查询和生成失败分别按原计费周期单次退款，删除或 membership 失效后不调用模型或提交幽灵成果 | `src/refresh.mjs`, `PUT /api/projects/:id/watch`, `POST /api/projects/:id/refresh`, `GET /api/projects/:id/snapshots` |
| FR-27 | 远程知识导入 | 编辑者可导入公开 HTTP(S) 网页、纯文本、PDF 或 GitHub 代码库；服务端阻断凭据 URL、私有/本机解析地址、过多重定向和超过 8 MB 响应，提取文本后复用内容哈希、分块、向量和图谱幂等流程 | `POST /api/projects/:id/knowledge/import`, `server.mjs`, `src/knowledge.mjs` |
| FR-28 | 成果版本历史 | 每次重新生成追加不可变成果；Web 可选择任意版本、与紧邻上一版比较逐节内容/来源变化并导出指定版本；非论文工作区不显示 LaTeX 操作 | `project.artifacts`, `public/app.js`, `GET /api/projects/:id/export?artifactId=` |
| FR-29 | 工作区语义记忆 | Web 可浏览导入文档并检索片段；生成同步或异步成果前按租户/项目检索最多 6 个相关片段，实际片段与分数固化到不可变成果并可导出；PostgreSQL 有 pgvector 时使用 HNSW/余弦查询，无扩展时仅开发回退，生产门禁强制原生向量；检索内容按不可信数据送入模型且不能成为已核验引用 | `GET /api/projects/:id/knowledge?q=`, `Repository.searchKnowledge`, `novi_chunk_vectors_native`, `content.knowledgeContext` |
| FR-30 | 知识文档生命周期 | editor 可删除租户项目内的单个知识文档；同一事务移除文档、片段、实体、关系及 PostgreSQL JSONB/pgvector 投影，并通过持久 outbox 清理对象存储和 Neo4j；不存在和跨租户访问均返回 404，重复删除幂等返回 404；不可变成果保留删除前已经使用的 excerpt，UI 必须提示完整清除需删除工作空间或账户 | `DELETE /api/projects/:id/knowledge/:documentId`, `enqueueDocumentDeletion`, `public/app.js` |
| FR-31 | 有界 Agent 职责 | 每个不可变成果记录 Research、Knowledge、Writing、Review 四个受控职责，包含责任、完成/回退/未运行状态和实际输出计数；自适应模式可调整顺序或重试，但不引入无边界 Agent 间对话 | `workflowFor()`, `artifact.workflow`, `artifactToMarkdown()` |
| FR-32 | 商业计划目录 | Billing API 与管理员 Web 显示 Free、Personal $29、Pro $99、Enterprise $1000 起的额度和目标用户；Personal/Pro/Enterprise 可提交真实 provider checkout，未配置 provider 明确 503，不模拟收费 | `PLANS`, `/api/billing`, `/api/billing/checkout`, `#billing-modal` |
| FR-33 | JavaScript 渲染 Browser Agent | editor 可对公开 HTTP(S) 页面显式选择 `render=browser`；服务端先对目标 URL 执行 DNS/SSRF 校验，再通过配置的隔离 HTTP worker 执行 JS 渲染，阻断图片/媒体/字体，限制超时、worker 响应 1 MB 和提取文本 880 KB，并对 worker 返回的最终 URL 再校验；未配置时返回 503，不在主服务执行远程脚本 | `src/source-adapters.mjs`, `POST /api/projects/:id/knowledge/import`, `public/app.js` |
| FR-34 | 通用 MCP 来源适配 | 配置 MCP Streamable HTTP endpoint 后执行 `initialize`、`notifications/initialized`、`tools/list`、`tools/call`；只调用管理员配置且服务端实际公布的 source tool，输入固定为 `{query,limit}`，只接纳 structured sources 中的无凭据 HTTP(S) URL，限制响应大小、超时和 authority 上限，再进入统一去重、排序与 concrete URL 证据核验 | `src/source-adapters.mjs`, `src/connectors.mjs`, `GET /api/search` |
| FR-35 | Web LLM Provider 配置 | owner/admin 可按组织选择主流 Provider（含国内 MiniMax）、模型和允许的 endpoint，保存/覆盖 API Key、测试连接或切回 Offline mode；viewer/editor 的 UI 隐藏且 API 返回 403，响应与数据导出不暴露明文或密文 API Key | `src/llm-providers.mjs`, `/api/llm/provider*`, `#provider-modal` |
| FR-36 | LangGraph Agent Runtime | 存在租户 Web Provider 时，根据 `{prompt,mode}` 进入 Workflow、ReAct、Plan & Execute 或 Supervisor；auto 模式识别中英文意图，controller 可在运行中切换模式，阶段 fallback 升级到 Supervisor。Specialist 只修改字段白名单内同形数据；Job 和 Web 暴露当前模式、阶段与进度，成果保存计划、模式历史、controller 事件和 token | `src/agent-modes.mjs`, `src/agent-runtime.mjs`, `generateArtifactAsync()`, `agentStages` |
| FR-37 | 持久 Agent Session | 创建项目时生成默认 Session；可按项目列出、新建、查看和删除空闲 Session。同步/异步生成接受 `sessionId`，保存用户/助手消息、active run 模式/阶段/进度、Job 与 Artifact 关联；Session 按 tenant+project 隔离并随项目/账户删除，运行中删除返回 409，服务重启把中断运行写为失败并解除占用 | `src/agent-sessions.mjs`, `/api/projects/:id/sessions*`, `agentSessions` |

## 3. 外部接口

- `POST /api/projects`：`{title, topic, type, description?}`。
- `POST /api/projects/:id/generate`：同步生成当前版本成果；请求可传 `{prompt,mode,sessionId}`，异步模式返回的 Job 绑定 Session。
- `GET/POST /api/projects/:id/sessions`：列出项目 Session 摘要或创建新 Session。
- `GET/DELETE /api/projects/:id/sessions/:sessionId`：查看完整消息或删除空闲 Session；跨项目/租户返回 404，运行中返回 409。
- `PATCH /api/projects/:id/pin`：切换置顶状态。
- `DELETE /api/projects/:id`：admin 删除项目，并级联取消未完成生成、单次退款及清理 Job/知识/关注数据。
- `GET /api/projects/:id/export?format=markdown|latex&artifactId=<uuid>&template=article|ieee|acm`：下载指定不可变版本；未传 `artifactId` 时下载最新成果，LaTeX 可选择出版模板。
- `GET /api/billing` / `GET /api/usage`：返回当前租户计划、自然月用量和额度。
- `GET /api/me/export` / `DELETE /api/me`：数据可携带和账户删除。
- `GET /api/jobs/:id`：查询异步任务状态。
- `GET /api/llm/providers`：owner/admin 获取 Provider 目录、脱敏租户配置和当前选择。
- `PUT /api/llm/provider`：owner/admin 保存并启用一个租户 Provider；API Key 只写。
- `DELETE /api/llm/provider`：owner/admin 停用当前 Web Provider，切回离线/旧环境变量路径。
- `POST /api/llm/provider/test`：owner/admin 测试当前 Provider 连接，不返回凭据。
- `GET /api/projects/:id/knowledge[?q=<query>&limit=1..50]`：列出工作区知识，或执行租户隔离的语义片段检索。
- `POST /api/projects/:id/knowledge/import`：`{title,url,render?: static|browser}`；browser 模式要求管理员已配置隔离 Browser Agent。
- `DELETE /api/projects/:id/knowledge/:documentId`：删除单个活跃知识文档及其检索/外部投影；历史成果 excerpt 保留。
- `PUT /api/projects/:id/watch`：`{enabled, frequency: manual|daily|weekly, autoUpdate?}`，配置来源刷新和变化驱动成果更新。
- `POST /api/projects/:id/refresh`：返回 `{snapshot, update}`；snapshot 包含来源差异，update 给出 completed/unchanged/disabled/busy/quota-exceeded/failed 状态。
- `GET /api/projects/:id/snapshots?limit=1..20`：读取来源差异、自动更新状态和所生成 artifact ID。
- `POST /api/billing/checkout`：`{plan, returnUrl?}`，返回外部 checkout URL。
- `POST /api/billing/webhook`：`X-Novi-Signature: sha256=...`，事件消费幂等。
- 所有错误以 `{error, fields?}` 返回；JSON 请求上限 1 MB。

## 4. 非功能需求

| ID | 类别 | 要求 |
| --- | --- | --- |
| NFR-01 | 可用性 | 首屏直接进入工作台；空状态包含明确下一步；移动端不横向溢出 |
| NFR-02 | 性能 | `npm run perf-check` 验证本地健康 API P95 小于 200 ms，`npm run stress-check` 在 240 请求/IP 限流内验证 199 个并发健康请求、40 个并发项目写入及最终读取，首屏静态资源小于 500 KB（不含 Electron） |
| NFR-03 | 可靠性 | 串行写队列与临时文件原子替换，避免并发写损坏 |
| NFR-04 | 安全 | 路径限制、按 UTF-8 字节计算的请求体上限、输入长度校验、HTML 转义、外链协议白名单；Cookie 会话写请求和带 Origin 的认证引导写请求执行同源 Origin/Fetch Metadata CSRF 校验 |
| NFR-05 | 可维护性 | UI、HTTP、领域生成、存储分层；Node 22.12+，`.nvmrc` 固定已验证开发/打包版本；运行时依赖锁定；desktop npm lifecycle 在调用 electron-builder 前拒绝不支持同步 ESM require 的旧 Node |
| NFR-06 | 可部署性 | 环境变量配置 HOST、PORT、NOVI_DATA_FILE；生产 Docker 默认开启认证和 Secure Cookie；支持以非 root 用户运行的容器，数据目录具备可写权限 |
| NFR-07 | 可观测性 | 健康检查、结构化服务端错误日志和 admin-only `/api/metrics` 运行计数；生产可接入 Prometheus/OTel |
| NFR-08 | 防护 | API 进程级每 IP 60 秒 240 请求限流；登录失败按 IP 15 分钟窗口限制；返回安全响应头 |
| NFR-09 | 会话安全 | 生产发布门禁强制 `NOVI_AUTH_REQUIRED=true` 和 `NOVI_COOKIE_SECURE=true`；Cookie 使用 HttpOnly/SameSite；Web UI 登录和组织切换仅接收 Cookie 会话、不接触 Bearer token，切换租户撤销旧 token；带 Cookie 的 POST/PUT/PATCH/DELETE 必须同源，Bearer API 不受浏览器 CSRF 检查影响；仅可信代理可启用 `NOVI_TRUST_PROXY=true` 解析转发协议 |
| NFR-10 | 并发一致性 | 额度扣减、普通/持续更新任务创建、项目状态转换、删除取消和失败退款通过串行存储事务完成；退款使用任务记录的计费周期和 charged/refunded 标记，删除与 worker 竞态不能重复退款、继续调用模型或提交幽灵成果 |
| NFR-11 | 支付安全 | Webhook 使用 HMAC SHA-256、事件 ID 去重，仅接受订阅/支付事件白名单和有效 plan，不接受未签名状态更新；checkout 回跳仅允许 `NOVI_APP_ORIGIN` 同源 URL |
| NFR-12 | 权限安全 | 每个写操作按当前会话 membership 重新计算角色；owner 不能被移除或降权 |
| NFR-13 | 身份安全 | OIDC 使用 HTTPS discovery/endpoint 校验、PKCE S256、一次性 state、nonce、issuer/audience/azp/exp 和 RS256 ID Token 校验；email 关联默认关闭 |
| NFR-14 | 存储可切换 | 本地 JSON 仅用于单实例/桌面；生产发布门禁要求 PostgreSQL，适配器使用事务、连接池和关系投影 |
| NFR-15 | 后台任务 | 定时刷新与外部投影 worker 可关闭、使用 unref 定时器、单进程互斥并在 HTTP server 关闭时停止；投影任务持久化、租约过期可恢复、失败按退避重试；多实例生产需迁移到分布式锁/队列 |
| NFR-16 | 检索与模型安全 | 工作区片段限制为最多 6 条、每条最多 700 字符；模型 system/user 提示将片段标记为不可信数据并禁止遵循其中指令；模型不能改写检索上下文、来源或证据，工作区片段与 verified web evidence 明确分离 |
| NFR-17 | 数据生命周期与可审计性 | 单文档删除必须原子移除活跃关系/向量检索数据并持久重试外部清理；成果版本作为不可变生成记录保留当时已使用 excerpt，删除确认明确提示该边界；需要完全清除时使用工作空间或账户删除 |
| NFR-18 | 外部采集适配器安全 | Browser Agent/MCP 远端 endpoint 必须为 HTTPS（仅回环开发允许 HTTP），生产非回环 endpoint 必须使用独立 bearer token；endpoint 禁止 URL 凭据/fragment，供应商调用禁止自动重定向并设置 1–30 秒有界超时和 1 MB 响应上限；适配器内容始终视为不可信输入，MCP 返回 URL仍须经过统一 evidence verification |
| NFR-19 | LLM 凭据与网络安全 | 租户 API Key 使用 AES-256-GCM；生产必须提供至少 32 字符的稳定配置密钥；API/导出不得返回密文；固定厂商使用批准 endpoint，Ollama 仅回环，自定义远端主机必须 HTTPS 且在 allowlist |
| NFR-20 | Agent 有界与恢复语义 | LangGraph recursion limit 为 40、Specialist 执行上限为 8 且单职责最多两次；不允许模型增加来源/字段/工具调用，计划和路由值使用白名单。单阶段错误显式标记 fallback。当前 checkpoint 为进程内存，服务重启按 Job 失败退款恢复，不宣称节点级续跑 |

## 5. 数据约束

项目包含 UUID、类型、标题、主题、描述、状态、置顶、时间戳和成果数组。每次重新生成追加不可变成果快照。当前文件存储适用于单实例和本地桌面版；不得以共享文件方式横向扩容。

## 6. 追溯与发布门禁

`test/` 覆盖引擎、持久化、认证/越权、历史版本导出、语义检索/RAG 上下文安全、单知识文档生命周期、Browser Agent 渲染导入、MCP Streamable HTTP、删除/生成竞态和异步 HTTP 核心流程；真实 pgvector 0.8.6 临时实例验证扩展初始化、HNSW 索引、租户过滤余弦查询以及单文档 JSONB/native 向量和项目 Job 清理。`npm run openapi-check` 使用 OpenAPI schema parser 校验 3.1 契约和核心路径；`npm run browser-smoke` 通过 Chromium CDP 驱动角色感知控件、创建、知识导入/浏览/语义搜索、检索上下文生成、两版本比较、单文档删除、历史 excerpt 保留、Markdown 导出和 Paper SVG 图表核心 Web 旅程；`npm run desktop-smoke` 验证开发态 Electron，`npm run desktop-package-smoke` 已在当前 Ubuntu + Xvfb 验证真实 Linux unpacked/AppImage 的内置服务、OS userData、安全窗口和共享 UI DOM；`npm run stress-check` 验证并发健康请求和项目写入；`npm run provider-contract-check` 通过本地 HTTP 供应商形态验证 LLM、支付、OIDC、Browser Agent 和 MCP 边界；`npm run live-source-integration-check` 已从真实公共连接器结果中完成 concrete URL 获取、SSRF 复核与内容哈希；`npm run storage-contract-check` 验证对象存储和 Neo4j HTTP/本地后端的写入、读取、删除和租户键；`npm run infrastructure-integration-check` 可在真实 S3-compatible/Neo4j 配置上验证写入、读取和清理，本地已使用真实 MinIO SigV4 与 Neo4j 服务通过；Docker 无缓存构建、健康检查、非 root、SBOM 和本地镜像漏洞快照已通过。生产发布仍必须增加真实 LLM/支付/OIDC/Browser Agent/MCP 账号或目标服务验收、目标规模向量/图检索与正式压力测试、托管 CI 运行与 SBOM 归档，以及三平台安装/签名/升级和 macOS/Windows Electron 窗口 E2E。
