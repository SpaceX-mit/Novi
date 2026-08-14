# Novi 详细设计

## 1. 模块职责

- `server.mjs`：路由、JSON 解析、输入校验、响应、静态文件和错误边界。
- `server.mjs` 在 API 路由入口执行 Cookie 会话 CSRF 边界：POST/PUT/PATCH/DELETE 检查同源 `Origin` 与 Fetch Metadata；Bearer Authorization 请求跳过该浏览器防护。注册/登录若浏览器带 `Origin` 也执行同源校验；外部 webhook 不依赖浏览器会话。
- `src/store.mjs`：状态读取、串行事务队列、原子文件替换、项目创建。
- `src/engine.mjs`：Knowledge Builder 的 Wiki/路线/Practice Lab/图谱、Deep Research 的 Report/Wiki/Graph/SOTA/机会、Paper Author 的完整章节/gap/novelty/方法/实验/审稿；提供来源建议、四阶段 workflow provenance、Markdown Mermaid 和 article/IEEE/ACM LaTeX picture 序列化；Web 将同一节点/边模型渲染为内联 SVG。
- `public/app.js`：单页状态、API 客户端、视图渲染、表单和交互。
- `desktop/main.cjs`：默认选择空闲回环端口，使用单实例锁，管理服务子进程，将默认状态写入 Electron OS `userData`，等待 200 健康响应，创建 sandbox/contextIsolation 安全窗口并限制导航/外链，在窗口或应用退出时终止子进程。electron-builder 从同一代码生成 Windows NSIS、macOS DMG/ZIP 和 Linux AppImage；`desktop-package-smoke` 从真实 `app.asar`/AppImage 验证服务、userData、窗口和 UI。
- `src/auth.mjs`：账户注册、scrypt 密码哈希、可撤销 Bearer/HttpOnly 会话和租户身份解析；组织切换原子轮换 token，Web 客户端只接收新 HttpOnly Cookie。
- `src/model.mjs`：OpenAI-compatible 结构化 JSON 网关，超时、未知字段、类型/数组边界或 schema 错误时回退离线生成；模型不能改写来源、工作区检索上下文和证据。最多 6 个、每个 700 字符的检索片段以明确的 UNTRUSTED DATA 边界传入，system message 禁止执行片段指令。
- `src/llm-providers.mjs`：租户 Provider 目录、输入规范化、endpoint allowlist、AES-256-GCM API Key 加解密、LangChain 模型构造和连接测试。支持 OpenAI、Anthropic、Google、DeepSeek、MiniMax、OpenRouter、Mistral、xAI、Groq、Azure OpenAI、Ollama 与自定义 OpenAI-compatible 服务；MiniMax 使用国内官方 `https://api.minimaxi.com/v1`。
- `src/agent-runtime.mjs`：LangGraph.js 四节点有向图；每阶段建立有界 prompt、单独调用模型、校验 JSON 和现有字段形状，记录状态/时间/token。阶段错误保留上一版内容并记录 `fallback`，取消信号终止整条工作流。
- `src/oidc.mjs`：OIDC discovery、PKCE S256、授权码交换、JWKS/RS256 ID Token 校验；HTTP start/callback 还用短时 HttpOnly 状态 Cookie 将授权响应绑定到发起浏览器。
- `src/payments.mjs`：checkout provider 边界与 HMAC webhook；事件类型和 active plan 均白名单校验后才改变订阅。
- `src/postgres-store.mjs`：可选 PostgreSQL JSONB Repository 迁移适配器，使用事务和连接池；pgvector 可用时维护 24 维原生向量表、HNSW cosine 索引，并通过租户/项目过滤的 `<=>` 查询实现 `searchKnowledge`。
- `/api/metrics`：仅 admin 可访问的进程级运行计数；不包含租户内容或凭据。
- `src/connectors.mjs`：OpenAlex、arXiv、Wikipedia、Crossref、GitHub、Semantic Scholar、Hugging Face、Stack Exchange、Reddit、RFC Editor，以及可选 YouTube、Internet Archive、Hacker News、官方文档搜索连接器；每个供应商独立超时，统一证据字段并通过 `Promise.allSettled` 容错。
- `src/source-adapters.mjs`：隔离 Browser Agent HTTP contract 与通用 MCP Streamable HTTP source client；统一校验 HTTPS/回环例外、生产 bearer credential、禁止供应商重定向、超时、1 MB 响应、目标/最终 URL 和结构化字段白名单。Browser Agent 只允许字符串文本进入普通知识摄取；MCP concrete sources 进入 connectors 去重排序与 evidence verification。
- `src/knowledge.mjs`：文本/代码笔记摄取、内容哈希、分块、离线确定性 embedding、实体提取、共现关系和本地余弦检索；向量/图供应商可在 Repository 边界后替换。
- 持续更新：`watchConfigs` 保存项目关注频率和 `autoUpdate`；`sourceSnapshots` 保存最多 20 次项目来源快照、added/updated/removed 差异、自动更新状态和 artifact 关联。`src/refresh.mjs` 提供单进程定时 worker，使用带 15 分钟 TTL 的内部 `refreshToken` 租约互斥（外部 watch API 和数据导出不暴露该字段）、按来源配额计费、失败退款，并随 HTTP server close 停止。变化只与最近 `autoUpdateStatus=completed` 的快照比较；changed snapshot 原子扣生成额度并创建 `continuous-update` Job，检索最多 6 个工作区片段后生成不可变成果。模型调用前和成果提交前均复核 Job/项目/membership；busy、quota、disabled、failed 不更新已应用基线，后续刷新会重试。多实例生产必须替换为队列/分布式锁。

## 2. 状态模型

```text
Project {
  id, title, topic, type, description,
  status: draft | ready,
  pinned, createdAt, updatedAt,
  artifacts: Artifact[]
}
Artifact { id, type, title, createdAt, content: { ..., knowledgeContext[] } }
Workflow { strategy, product, completedAt, runtime?, agents[4]: { order, name, responsibility, status, usage?, outputs } }
LlmProviderConfig { tenantId, provider, model, baseUrl, apiVersion?, encryptedApiKey?, active, createdBy, updatedBy }
SourceSnapshot { id, projectId, tenantId, sources[], changeStatus, changes, autoUpdateStatus?, artifactId? }
```

创建后状态为 `draft`；用户生成或持续更新成功后追加成果并变为 `ready`。持续更新成果额外保存 `trigger=continuous-update` 与 `snapshotId`。每个版本的 `workflow` 只包含 Research/Knowledge/Writing/Review 四个有界阶段，`knowledgeContext` 保存 chunk/document ID、标题、片段、来源 URL 和相关分数，说明当次生成实际使用的个人知识。UI 默认使用最新成果，也可选择任意不可变历史版本。写操作进入同一 Promise 队列；更新后的完整状态先写 0600 临时文件，再用 rename 原子替换，状态目录使用 0700。

## 3. 任务与模型调用

Web 端生成使用 `POST /api/projects/:id/generate?async=true`，先取得 Job，再轮询 `/api/jobs/:id`；任务阶段为 queued → running → completed/failed。配置 Web Provider 后，Job 还持久化 `agentStages`、`currentStage` 和 20–100 的实际进度；每个阶段状态为 running → completed/fallback，并保存有界错误摘要与 token usage。项目状态在任务创建前原子切换到 `generating`，同一项目重复请求返回 409；额度扣减与任务创建在同一串行存储队列中完成，Job 保存 generation/source 计费周期，失败或服务重启时按原周期退款且只执行一次。成果提交成功后即使 Job 状态更新失败也不会重复退款。服务启动时会把遗留 queued/running Job 标记失败并恢复项目状态。每个消费者先通过 Repository 的事务性 `claimJob` 将 queued 原子变为 running 并写入 workerId，多个 HTTP 实例不会重复执行同一 Job。删除工作空间或发起任务的成员账户时，删除事务按 Job 的 charged/refunded 标记退款并移除 Job；运行中的 worker 在每个 LangGraph 节点前确认 Job 仍存在，并在成果提交事务再次确认 running Job、项目和 active membership，删除竞态不会重复退款或把成果写回共享项目。同步/异步执行都会以项目 topic + description 查询 `Repository.searchKnowledge`，再把经过字段白名单和长度限制的结果交给领域层。领域层先生成离线结构；租户存在 Web Provider 时优先用 LangGraph 四阶段补全，否则由旧 OpenAI-compatible `ModelGateway` 单次补全。外部调用超时、非 2xx 或 schema 不合法时回退到受控离线结构，避免外部服务故障破坏工作区。

Provider 管理接口只允许 owner/admin。保存时固定厂商忽略客户端 base URL；Azure 只接受批准的 Azure AI hostname，Ollama 只接受回环，自定义非回环 hostname 必须出现在 `NOVI_LLM_ALLOWED_HOSTS` 且使用 HTTPS。API Key 使用 `NOVI_CONFIG_ENCRYPTION_KEY` 派生的 256 位 key 做 AES-GCM；生产缺少稳定密钥时拒绝保存，本地生成数据目录下 0600 key 文件。连接测试只返回 provider/model/latency，不返回凭据。当前 `MemorySaver` 不提供跨进程图恢复；服务重启仍按现有 Job 恢复规则将中断任务失败并退款，而不是从某个 Agent 节点继续。

## 4. 错误处理

- 400：JSON 无法解析。
- 404：路由、项目或成果不存在。
- 405：资源存在但方法不支持。
- 413：请求超过 1 MB。
- 422：字段级业务校验失败。
- 500：未预期错误，客户端只接收通用信息，详细错误写服务日志。

## 5. UI 设计

信息架构固定为 Overview 与三种核心路径。创建弹窗只收集完成任务所需信息；项目卡片用于重复资产；工作空间通过标签承载不同成果视图，避免多级页面跳转。Workspace knowledge 弹窗展示文档/片段/概念数量、导入文档和语义匹配片段；成果主视图展示当次使用的个人知识及免责声明。Web 从 `/api/org` 获取当前实时角色：viewer 只显示浏览、搜索、历史和导出，editor 增加创建、生成、置顶、摄取、刷新和单文档删除，admin/owner 额外显示 Provider 设置、工作空间删除和付费升级；服务端仍逐请求重新计算 membership，UI 隐藏不是安全边界。Provider 弹窗从服务端目录渲染选择器，根据厂商切换 base URL/API version 字段，API Key 只允许覆盖而不能读取；保存、测试连接和 Offline mode 分别对应 PUT、POST test 和 DELETE。桌面端与 Web 共用 UI 和 API，避免功能分叉。

## 6. 生产适配接口

`PostgresStore` 使用单行 JSONB migration envelope、`BEGIN`/`COMMIT`/`ROLLBACK` 与 `SELECT ... FOR UPDATE`，并将 documents、chunks、knowledge entities/edges 投影到带租户/项目索引的关系表；始终维护 `novi_chunk_vectors` JSONB embedding 迁移投影，检测到 pgvector 时额外维护 24 维原生向量表和 `vector_cosine_ops` HNSW 索引。搜索 SQL 同时约束 tenant/project，并按 `<=>` 排序、限制最多 50 条；生产 `NOVI_REQUIRE_NATIVE_VECTOR=true` 会在扩展或索引不可用时拒绝启动。外部来源返回统一 `Evidence {name,kind,url,authority,publishedAt,snippet,mapped,relevanceScore}`；IEEE、ACM 和 Springer 目录分别通过 Crossref prefix `10.1109`、`10.1145`、`10.1007` 获取具体 DOI，不冒充需要商业凭据的出版商官方 API。连接器和领域层均过滤非法协议和主机，再按查询词重叠、权威度、来源类型和新旧程度计算确定性相关性分数排序；启用 live sources 时，`src/evidence.mjs` 对 concrete mapped URL 重新执行 SSRF/DNS、凭据、3 次重定向、超时和 1 MB 响应限制，并保存内容哈希、HTTP 状态和验证时间；无法验证的来源不会进入 claim evidence。LLM gateway 仅允许 HTTPS（本地回环可 HTTP）。只有通过验证的 `mapped=true` 具体检索条目进入 claim evidence，工作区知识不会被误标为已核验引用。对象存储支持本地目录、Bearer HTTP gateway 或 AWS SigV4 S3-compatible endpoint；生产远端 endpoint 必须使用 HTTPS。

知识摄取接口限制单文档 900 KB（与全局 1 MB JSON 请求体门槛一致），拒绝非 HTTP(S) 来源 URL，并按租户项目和内容 SHA-256 幂等去重；当前 embedding 是离线可重复的 24 维 hash 向量，PostgreSQL 模式写入带租户索引的 `novi_chunk_vectors`，适合本地演示和可测试性，不等同于语义模型质量。配置对象存储时原文以租户/文档/哈希键原子写入，配置 Neo4j 时实体/关系按租户、项目、文档键幂等同步；生产对象存储和图谱 endpoint 必须为 HTTPS（仅本地回环允许 HTTP）。摄取/删除 intent 与主数据事务同写 `externalProjectionJobs` outbox，worker 以租约、尝试次数、下一次执行时间和错误摘要驱动幂等执行；失败按退避重试，进程启动和轮询会恢复过期 running 任务，单文档、项目或账户删除会保留删除任务直到对象键和 Neo4j `DETACH DELETE` 完成，状态变化写入审计且不导出原文内容。

`DELETE /api/projects/:projectId/knowledge/:documentId` 仅允许 editor 及以上角色；项目不存在、文档不属于当前租户/项目或已经删除统一返回 404，成功返回 204。事务先记录带 object key/content hash 的删除任务，再移除 document、chunks、entities 和 edges；`PostgresStore.projectProjection` 在同一提交中清除关系、JSONB embedding 和 pgvector native rows，提交后立即尝试一次对象/图清理，失败任务由 worker 恢复。该操作只改变活跃语义记忆：成果版本中的 `knowledgeContext` 是生成时的不可变审计快照，仍保留当时 excerpt；Web 确认文案明确提示完整敏感数据清除应删除工作空间或账户。

远程导入接口 `POST /api/projects/:id/knowledge/import` 只接受无凭据的 HTTP(S) URL；服务端解析 DNS 并拒绝回环、私网、链路本地、未指定、CGNAT、文档/基准、组播地址和 IPv4-mapped IPv6 保留地址。默认 `render=static` 手动跟随最多 3 次重定向且每一跳重新校验，限制响应为 8 MB；HTML 去除脚本和样式后抽取文本，PDF 通过 `pdf-parse` 提取文本，纯文本/代码按 UTF-8 读取；GitHub 仓库只读取受支持的文本文件，忽略 `.git`、依赖和构建目录，并限制文件数/单文件/总文本大小。显式 `render=browser` 时，主服务不执行页面脚本，而是把已校验 URL 交给配置的隔离 Browser Agent；请求阻断 image/media/font，超时限制 1–30 秒，worker 响应限制 1 MB、提取文本限制 880 KB，worker 返回的最终 URL 再次执行 DNS/SSRF 校验。提取结果进入同一内容哈希去重、分块、embedding、实体/关系事务；任何远程内容仍只是待审查知识输入。

MCP source adapter 使用协议版本 `2025-06-18`，按请求完成 `initialize → notifications/initialized → tools/list → tools/call`，传播 `Mcp-Session-Id`，同时支持 JSON 与 SSE JSON-RPC 响应。管理员通过 `NOVI_MCP_SOURCE_TOOL` 固定工具名；只有该工具在 `tools/list` 实际公布时才调用，参数固定为 `{query,limit}`。结果只从 `structuredContent.sources/results/items`、JSON text content 或 resource links 提取，拒绝非 HTTP(S)、URL 凭据和自由文本“来源”，authority 上限为 90；结果随后仍执行 Novi 的相关性评分、去重和 concrete URL 内容核验。

## 7. 恢复与发布

`npm run backup` 使用临时文件 + rename 生成 v3 数据快照，`npm run restore` 先校验版本、数组结构后原子替换目标文件。容器以 `/api/ready` 作为 readiness probe；收到 SIGTERM 后停止接收新连接并最多等待 10 秒。

项目的 `artifacts` 使用 newest-first 不可变数组。重新生成只追加新 ID/时间戳，不覆盖旧内容；Web 以 `activeArtifactId` 选择版本，将当前版与数组中紧邻的旧版按摘要、章节、方法、实验、图表和来源 URL 比较。导出 API 接受租户项目内的 `artifactId`，不存在或不属于该项目时返回 404，下载文件名携带稳定版本号。

备份、恢复和账户导出包含知识摄取与持续更新数组；备份/状态文件以 0600 保存，单文档删除清理活跃索引而保留不可变成果 excerpt，工作空间/账户删除则级联清理对应成果、Job、文档、chunks、实体/边、watchConfigs 和 sourceSnapshots；未完成 Job 在清理前按原计费周期单次退款。

发布前运行 `npm run openapi-check`、`npm run sbom-check` 和 `npm run perf-check`；三者分别验证 OpenAPI 3.1 schema/引用/核心路径、CycloneDX/SPDX 的完整与生产依赖边界及许可证元数据、40 次本地 `/api/health` 请求 P95 和小于 500 KB 的首页响应体。`npm run provider-contract-check` 使用本地 HTTP 供应商实现走通 LLM 成功/错误/超时、支付 checkout 与签名 webhook、OIDC discovery/PKCE/RS256/userinfo、Browser Agent 渲染和 MCP initialize/list/call；它验证协议和安全边界，但不替代真实第三方沙盒或目标 worker/MCP server 验收。`npm run infrastructure-integration-check` 对配置的 S3-compatible/Neo4j 做带清理的真实写读删，本地已用 MinIO SigV4 和真实 Neo4j 通过。性能检查不是公网压力测试替代品，生产仍需独立压测；本地 SBOM/镜像扫描快照也不替代持续发布 CI。
