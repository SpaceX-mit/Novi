# Novi 详细设计

## 1. 模块职责

- `server.mjs`：路由、JSON 解析、输入校验、响应、静态文件和错误边界。
- `server.mjs` 在 API 路由入口执行 Cookie 会话 CSRF 边界：POST/PUT/PATCH/DELETE 检查同源 `Origin` 与 Fetch Metadata；Bearer Authorization 请求跳过该浏览器防护。注册/登录若浏览器带 `Origin` 也执行同源校验；外部 webhook 不依赖浏览器会话。
- `src/store.mjs`：状态读取、串行事务队列、原子文件替换、项目创建。
- `src/engine.mjs`：Knowledge Builder 的 Wiki/路线/Practice Lab/图谱、Deep Research 的 Report/Wiki/Graph/SOTA/机会、Paper Author 的完整章节/gap/novelty/方法/实验/审稿；提供 Expert Goal、领域角色、知识体系、体系文档、最终 LLM Wiki、Goal 驱动参考发现、七节点 workflow provenance、Markdown Mermaid 和 article/IEEE/ACM LaTeX picture 序列化；每个 Artifact 固化与导出一致的 `llm-wiki.md`，Web 将图模型渲染为内联 SVG、将 Markdown 作为转义纯文本预览。
- `public/app.js`：单页状态、API 客户端、视图渲染、表单和交互。
- `desktop/main.cjs`：默认选择空闲回环端口，使用单实例锁，管理服务子进程，将默认状态写入 Electron OS `userData`，等待 200 健康响应，创建 sandbox/contextIsolation 安全窗口并限制导航/外链，在窗口或应用退出时终止子进程。electron-builder 从同一代码生成 Windows NSIS、macOS DMG/ZIP 和 Linux AppImage；`desktop-package-smoke` 从真实 `app.asar`/AppImage 验证服务、userData、窗口和 UI。
- `src/auth.mjs`：账户注册、scrypt 密码哈希、可撤销 Bearer/HttpOnly 会话和租户身份解析；组织切换原子轮换 token，Web 客户端只接收新 HttpOnly Cookie。
- `src/model.mjs`：OpenAI-compatible 结构化 JSON 网关，超时、未知字段、类型/数组边界或 schema 错误时回退离线生成；模型不能改写来源、工作区检索上下文和证据。最多 6 个、每个 700 字符的检索片段以明确的 UNTRUSTED DATA 边界传入，system message 禁止执行片段指令。
- `src/llm-providers.mjs`：租户 Provider 目录、输入规范化、endpoint allowlist、AES-256-GCM API Key 加解密、LangChain 模型构造和连接测试。支持 OpenAI、Anthropic、Google、DeepSeek、MiniMax、OpenRouter、Mistral、xAI、Groq、Azure OpenAI、Ollama 与自定义 OpenAI-compatible 服务；MiniMax 使用国内官方 `https://api.minimaxi.com/v1`。
- `src/agent-modes.mjs`：维护 Workflow、ReAct、Plan & Execute、Supervisor 目录，校验显式模式并从中英文提示词意图中选择自动模式。
- `src/agent-runtime.mjs`：LangGraph.js 自适应有向图；Router 强制先执行 Goal 和无模型调用的 Reference Discovery，再进入固定流水线、ReAct controller、Planner 或 Supervisor。Reference 查询只来自已完成 Goal 的 question/domain/outcome/scope，返回来源仍由 Novi 连接器和 evidence 层控制。controller 可切换模式，Specialist fallback 会升级到 Supervisor。每个 Specialist 建立含目标语言约束的有界 prompt、单独调用模型、校验 JSON 和现有字段形状，记录状态/时间/token。reasoning 模型返回的 `<think>`/`<analysis>` 与 Markdown JSON fence 会先被分离，解析器按平衡括号提取完整 JSON；仅当前阶段拥有且通过 schema 的字段可以合入状态，供应商返回完整草稿时的其他字段安全忽略。收到内容后的解析/校验错误记录为 `LLM response rejected`，与网络/超时的 `LLM request failed` 区分。最多执行 8 个 Specialist 步骤，单职责最多两次；取消信号终止整条工作流。
- `src/wiki-language.mjs`：集中维护生成语言 allowlist，默认 `zh-CN`，项目保存 `wikiLanguage`，单次 Generate 使用 `language` 覆盖。当前生成内容支持中英日韩法德西和巴西葡语；UI 文案本地化不在本能力范围内。
- `src/agent-tools.mjs`：把内置 workspace read/write/web search/paper search/paper fetch、自定义 HTTP 和已启用 MCP 工具合并为当次运行的受控注册表；执行输入校验、租户/项目/来源额度边界、取消检查和最多 6 次调用的硬上限，并把有界 observation/provenance 返回 LangGraph tool node。
- `src/paper-tools.mjs`：归一化 DOI、arXiv 标识和公开论文 URL，复用 evidence DNS/SSRF、重定向、内容哈希与大小限制；Crossref/arXiv 元数据和公开 PDF/HTML 内容分别返回访问状态，只有成功解析的公开 PDF 标记 `public-full-text`。
- `src/mcp-runtime.mjs`：使用官方 `@modelcontextprotocol/sdk` 的 Client、StreamableHTTPClientTransport 和 AJV validator；规范化租户 MCP server 配置、加密 Bearer token、验证 endpoint allowlist，执行工具发现/命名空间化/显式授权和有界调用结果转换。
- `src/skill-runtime.mjs`：校验最多 20 个租户 Skill 的名称、说明、4000 字符指令、产品范围、always/auto 激活和最多 12 个触发词；运行开始时按显式 `/skill name`、always、触发词优先级选出最多 3 个，并产生不含完整指令的哈希 provenance。
- `src/plugin-runtime.mjs`：校验最多 10 个声明式 manifest、语义版本、2000 字符编排指令及现有 Skill/已授权工具引用；每次最多激活 2 个，运行时丢弃已失效工具引用，不执行租户代码。
- `src/agent-sessions.mjs`：创建/查找租户项目 Session，追加最多 500 条、单条最多 20000 字符的消息，并维护 queued/running/completed/failed run 生命周期。每个 active run 与完成/失败助手消息保存最多 100 条规范化事件；单个模型请求/回复或工具详情限制约 12000 字符，覆盖路由、阶段、参考、LLM、工具和 Artifact 提交。Composer 每轮创建 `refine` Job，以上一 Artifact 和累积来源作为新 LangGraph 运行基线；助手成果消息保存 Artifact ID。最终 `llm-wiki.md` 以 `agent-wiki` 文档进入工作区分块/向量/图谱和外部投影，Artifact runtime 固化知识文档 ID/哈希/来源数；失败写入有界错误摘要且幂等，公开响应复制消息数组，避免传输层直接修改持久对象。
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
  id, title, topic, type, description, wikiLanguage,
  status: draft | ready,
  pinned, createdAt, updatedAt,
  artifacts: Artifact[]
}
Artifact { id, type, title, language, createdAt, content: { ..., knowledgeContext[] }, documents[{ name: llm-wiki.md, mediaType, language, content }] }
Workflow { strategy, product, completedAt, runtime?, agents[7]: { order, name, responsibility, status, usage?, outputs } }
LlmProviderConfig { tenantId, provider, model, baseUrl, apiVersion?, encryptedApiKey?, active, createdBy, updatedBy }
McpServerConfig { id, tenantId, name, endpoint, encryptedBearerToken?, bearerTokenLast4?, discoveredTools[<=100], updatedAt }
McpDiscoveredTool { name, alias, title?, description?, inputSchema, enabled, readOnly?, destructive?, unsupportedReason? }
AgentSkillConfig { id, tenantId, name, title, description, instructions, activation: auto | always, productTypes[], triggerTerms[<=12], enabled, updatedAt }
AgentPluginConfig { id, tenantId, name, version, title, description, instructions, activation, productTypes[], triggerTerms[], skillNames[], toolNames[], enabled, updatedAt }
SourceSnapshot { id, projectId, tenantId, sources[], changeStatus, changes, autoUpdateStatus?, artifactId? }
AgentSession { id, tenantId, projectId, createdBy, title, status: idle | running, activeRun?, messages[<=500], createdAt, updatedAt }
AgentMessage { id, role: user | assistant, kind, content, jobId?, artifactId?, mode?, status?, createdAt }
```

创建后状态为 `draft`；用户生成或持续更新成功后追加成果并变为 `ready`。持续更新成果额外保存 `trigger=continuous-update` 与 `snapshotId`。每个版本的 `workflow` 先记录 Goal/领域专家角色与 Reference Discovery，再记录 Research/Knowledge/Writing/Review 四个 specialist 和 LLM Wiki Finalizer，并保存目标语言、参考查询/状态/来源类型、运行模式、切换历史、计划和 controller 事件；成果内容同时保存 `expertGoal`、`expertRoles`、`knowledgeSystem`、`systemDocument`、`llmWiki`，兼容字段 `wikiSections` 由 Finalizer 同步维护。`knowledgeContext` 保存 chunk/document ID、标题、片段、来源 URL 和相关分数，说明当次生成实际使用的个人知识。UI 默认使用最新成果，也可选择任意不可变历史版本；`documents` 为每个版本保存独立 Markdown 快照。写操作进入同一 Promise 队列；更新后的完整状态先写 0600 临时文件，再用 rename 原子替换，状态目录使用 0700。

## 3. 任务与模型调用

Web 端生成使用 `POST /api/projects/:id/generate?async=true`，先取得 Job，再轮询 `/api/jobs/:id`；任务阶段为 queued → running → completed/failed。配置 Web Provider 后，Job 还持久化 `agentStages`、`currentStage` 和 20–100 的实际进度；每个阶段状态为 running → completed/fallback，并保存有界错误摘要与 token usage。项目状态在任务创建前原子切换到 `generating`，同一项目重复请求返回 409；额度扣减与任务创建在同一串行存储队列中完成，Job 保存 generation/source 计费周期，失败或服务重启时按原周期退款且只执行一次。成果提交成功后即使 Job 状态更新失败也不会重复退款。服务启动时会把遗留 queued/running Job 标记失败并恢复项目状态。每个消费者先通过 Repository 的事务性 `claimJob` 将 queued 原子变为 running 并写入 workerId，多个 HTTP 实例不会重复执行同一 Job。删除工作空间或发起任务的成员账户时，删除事务按 Job 的 charged/refunded 标记退款并移除 Job；运行中的 worker 在每个 LangGraph 节点前确认 Job 仍存在，并在成果提交事务再次确认 running Job、项目和 active membership，删除竞态不会重复退款或把成果写回共享项目。同步/异步执行都会以项目 topic + description 查询 `Repository.searchKnowledge`，再把经过字段白名单和长度限制的结果交给领域层。领域层先生成离线结构；租户存在 Web Provider 时优先用 LangGraph Goal/四 specialist/Finalizer 补全，否则由旧 OpenAI-compatible `ModelGateway` 单次补全。外部调用超时、非 2xx 或 schema 不合法时回退到受控离线结构，避免外部服务故障破坏工作区。

上述控制层采用自适应模式：生成请求接受 `{prompt,mode,language}`，`auto` 通过 `src/agent-modes.mjs` 识别意图；Job 持久化 `language`、`expertGoal`、`referenceDiscovery`、`requestedMode`、`currentMode`、`modeHistory`、`agentStages` 和 `currentStage`，工作区实时显示 Goal、参考检索状态、当前模式、阶段和进度。Goal 完成后 Reference Discovery 才调用可选 `referenceRetriever`；关闭实时来源为 `offline`，已有快照为 `provided`，失败为 `fallback` 且服务器退来源额度。成果 runtime 固化 language、reference provenance、initial/final mode、plan、controller events 与 token usage；Finalizer 是所有正常结束、提前结束和 specialist 上限路径的必经节点。

生成请求还接受项目内 `sessionId`；未提供时选择该项目最近更新的 Session，不存在则创建默认 Session。异步路径在同一存储事务中创建 Job、把项目置为 generating 并调用 `beginSessionRun`；同步路径同样原子设置项目和 Session，避免两步间删除竞态。阶段与模式回调更新 `activeRun`，成功时 `completeSessionRun` 追加带 Artifact ID 的助手消息，失败时 `failSessionRun` 追加一次错误消息并解除 active run。服务启动恢复对 queued/running Job 执行同一失败转换；项目、账户和备份/导出生命周期均包含 `agentSessions`。Session API 先用 tenant+project 查 Project，再以相同复合范围查 Session，避免通过 ID 探测其他租户数据。

Provider 管理接口只允许 owner/admin。保存时固定厂商忽略客户端 base URL；Azure 只接受批准的 Azure AI hostname，Ollama 只接受回环，自定义非回环 hostname 必须出现在 `NOVI_LLM_ALLOWED_HOSTS` 且使用 HTTPS。API Key 使用 `NOVI_CONFIG_ENCRYPTION_KEY` 派生的 256 位 key 做 AES-GCM；生产缺少稳定密钥时拒绝保存，本地生成数据目录下 0600 key 文件。连接测试只返回 provider/model/latency，不返回凭据。当前 `MemorySaver` 不提供跨进程图恢复；服务重启仍按现有 Job 恢复规则将中断任务失败并退款，而不是从某个 Agent 节点继续。

MCP 管理接口 `GET/PUT /api/agent/mcp` 仅由 owner/admin 修改，viewer 可读取去密钥配置；`POST /api/agent/mcp/servers/:serverId/sync` 在保存的 revision 上执行远端 initialize + 分页 tools/list，提交时复核 `updatedAt`，避免较慢的发现覆盖并发修改。每个租户最多 5 个 server、每个 server 最多接纳 100 个工具；新工具和 task-based 工具默认不可用，只有显式启用的普通即时工具进入生成注册表。重命名 server 会重算 alias，更改 endpoint 会清除旧 token 和发现结果。远端服务必须是 HTTPS 且 hostname 位于 `NOVI_MCP_ALLOWED_HOSTS`，本地开发仅回环 HTTP 例外；schema 最多 16 KB/12 层，SDK AJV validator 在调用前验证输入，协议请求默认 10 秒且上限 30 秒，POST 响应限制 256 KB。文本和结构化结果被截断并作为不可信 observation，图片/音频只记录省略标记，不会进入模型上下文。

Skills 管理接口为 `GET/PUT /api/agent/skills`：组织成员可审查指令，只有 owner/admin 可替换配置。选择在读取 Provider 与运行配置的同一阶段完成；无 Web Provider 时返回空选择，离线生成不记录虚假 Skill provenance。显式 `/skill name` 优先于 always，always 优先于触发词命中，同优先级保持配置顺序；最终最多 3 个。Skill prompt 前置固定边界，明确其不能授权工具/来源或覆盖 policy/schema；即使恶意管理员指令进入模型，Specialist 的字段形状校验、Novi 控制的 sources/evidence 和工具 allowlist 仍保持独立强制。实际 Skill 元数据写入 async Job、Session active run/完成消息和 Artifact runtime。

## 4. 错误处理

- 400：JSON 无法解析。
- 404：路由、项目或成果不存在。
- 405：资源存在但方法不支持。
- 413：请求超过 1 MB。
- 422：字段级业务校验失败。
- 500：未预期错误，客户端只接收通用信息，详细错误写服务日志。

## 5. UI 设计

信息架构固定为 Overview 与三种核心路径。创建弹窗只收集完成任务所需信息，成功后直接打开默认 Agent Session。工作区采用三栏：左栏列出 Session 摘要并提供新建/空闲删除；中栏按时间显示持久用户/助手消息、active mode/stage/progress、Artifact 链接，并由 composer 提交 prompt 和执行模式；右栏以 Files、LLM Wiki、Document 标签承载文件目录、成果版本/比较/导出和文档片段。宽屏为三栏，1100px 以下把 inspector 放到对话下方，760px 以下全部单列且 Session 列表横向滚动。Workspace knowledge 弹窗继续提供语义搜索和删除。Web 从 `/api/org` 获取当前实时角色：viewer 可读 Session、成果、知识和导出，但不显示 composer、新建/删除 Session 或其他写控件；editor 增加生成、置顶、摄取和刷新，admin/owner 额外显示 Provider 设置、工作空间删除和付费升级。服务端仍逐请求重新计算 membership，UI 隐藏不是安全边界。Provider 弹窗从服务端目录渲染选择器，根据厂商切换 base URL/API version 字段，API Key 只允许覆盖而不能读取。桌面端与 Web 共用 UI 和 API，避免功能分叉。

## 6. 生产适配接口

`PostgresStore` 使用单行 JSONB migration envelope、`BEGIN`/`COMMIT`/`ROLLBACK` 与 `SELECT ... FOR UPDATE`，并将 documents、chunks、knowledge entities/edges 投影到带租户/项目索引的关系表；始终维护 `novi_chunk_vectors` JSONB embedding 迁移投影，检测到 pgvector 时额外维护 24 维原生向量表和 `vector_cosine_ops` HNSW 索引。搜索 SQL 同时约束 tenant/project，并按 `<=>` 排序、限制最多 50 条；生产 `NOVI_REQUIRE_NATIVE_VECTOR=true` 会在扩展或索引不可用时拒绝启动。外部来源返回统一 `Evidence {name,kind,url,authority,publishedAt,snippet,mapped,relevanceScore}`；IEEE、ACM 和 Springer 目录分别通过 Crossref prefix `10.1109`、`10.1145`、`10.1007` 获取具体 DOI，不冒充需要商业凭据的出版商官方 API。连接器和领域层均过滤非法协议和主机，再按查询词重叠、权威度、来源类型和新旧程度计算确定性相关性分数排序；启用 live sources 时，`src/evidence.mjs` 对 concrete mapped URL 重新执行 SSRF/DNS、凭据、3 次重定向、超时和 1 MB 响应限制，并保存内容哈希、HTTP 状态和验证时间；无法验证的来源不会进入 claim evidence。LLM gateway 仅允许 HTTPS（本地回环可 HTTP）。只有通过验证的 `mapped=true` 具体检索条目进入 claim evidence，工作区知识不会被误标为已核验引用。对象存储支持本地目录、Bearer HTTP gateway 或 AWS SigV4 S3-compatible endpoint；生产远端 endpoint 必须使用 HTTPS。

知识摄取接口限制单文档 900 KB（与全局 1 MB JSON 请求体门槛一致），拒绝非 HTTP(S) 来源 URL，并按租户项目和内容 SHA-256 幂等去重；当前 embedding 是离线可重复的 24 维 hash 向量，PostgreSQL 模式写入带租户索引的 `novi_chunk_vectors`，适合本地演示和可测试性，不等同于语义模型质量。配置对象存储时原文以租户/文档/哈希键原子写入，配置 Neo4j 时实体/关系按租户、项目、文档键幂等同步；生产对象存储和图谱 endpoint 必须为 HTTPS（仅本地回环允许 HTTP）。摄取/删除 intent 与主数据事务同写 `externalProjectionJobs` outbox，worker 以租约、尝试次数、下一次执行时间和错误摘要驱动幂等执行；失败按退避重试，进程启动和轮询会恢复过期 running 任务，单文档、项目或账户删除会保留删除任务直到对象键和 Neo4j `DETACH DELETE` 完成，状态变化写入审计且不导出原文内容。

`DELETE /api/projects/:projectId/knowledge/:documentId` 仅允许 editor 及以上角色；项目不存在、文档不属于当前租户/项目或已经删除统一返回 404，成功返回 204。事务先记录带 object key/content hash 的删除任务，再移除 document、chunks、entities 和 edges；`PostgresStore.projectProjection` 在同一提交中清除关系、JSONB embedding 和 pgvector native rows，提交后立即尝试一次对象/图清理，失败任务由 worker 恢复。该操作只改变活跃语义记忆：成果版本中的 `knowledgeContext` 是生成时的不可变审计快照，仍保留当时 excerpt；Web 确认文案明确提示完整敏感数据清除应删除工作空间或账户。

远程导入接口 `POST /api/projects/:id/knowledge/import` 只接受无凭据的 HTTP(S) URL；服务端解析 DNS 并拒绝回环、私网、链路本地、未指定、CGNAT、文档/基准、组播地址和 IPv4-mapped IPv6 保留地址。默认 `render=static` 手动跟随最多 3 次重定向且每一跳重新校验，限制响应为 8 MB；HTML 去除脚本和样式后抽取文本，PDF 通过 `pdf-parse` 提取文本，纯文本/代码按 UTF-8 读取；GitHub 仓库只读取受支持的文本文件，忽略 `.git`、依赖和构建目录，并限制文件数/单文件/总文本大小。显式 `render=browser` 时，主服务不执行页面脚本，而是把已校验 URL 交给配置的隔离 Browser Agent；请求阻断 image/media/font，超时限制 1–30 秒，worker 响应限制 1 MB、提取文本限制 880 KB，worker 返回的最终 URL 再次执行 DNS/SSRF 校验。提取结果进入同一内容哈希去重、分块、embedding、实体/关系事务；任何远程内容仍只是待审查知识输入。

MCP source adapter 使用协议版本 `2025-06-18`，按请求完成 `initialize → notifications/initialized → tools/list → tools/call`，传播 `Mcp-Session-Id`，同时支持 JSON 与 SSE JSON-RPC 响应。管理员通过 `NOVI_MCP_SOURCE_TOOL` 固定工具名；只有该工具在 `tools/list` 实际公布时才调用，参数固定为 `{query,limit}`。结果只从 `structuredContent.sources/results/items`、JSON text content 或 resource links 提取，拒绝非 HTTP(S)、URL 凭据和自由文本“来源”，authority 上限为 90；结果随后仍执行 Novi 的相关性评分、去重和 concrete URL 内容核验。

## 7. 恢复与发布

`npm run backup` 使用临时文件 + rename 生成 v3 数据快照，`npm run restore` 先校验版本、数组结构后原子替换目标文件。容器以 `/api/ready` 作为 readiness probe；收到 SIGTERM 后停止接收新连接并最多等待 10 秒。

项目的 `artifacts` 使用 newest-first 不可变数组。重新生成只追加新 ID/时间戳，不覆盖旧内容；Web 以 `activeArtifactId` 选择版本，将当前版与数组中紧邻的旧版按摘要、章节、方法、实验、图表和来源 URL 比较。导出 API 接受租户项目内的 `artifactId`，不存在或不属于该项目时返回 404，下载文件名携带稳定版本号。

备份、恢复和账户导出包含 Agent Session、MCP server、Skills 配置、知识摄取与持续更新数组；账户导出只包含去密钥 MCP 摘要，不包含 Bearer token 的明文或密文。备份/状态文件以 0600 保存，单文档删除清理活跃索引而保留不可变成果 excerpt，工作空间/账户删除则级联清理对应 Session、成果、Job、MCP/Skills 配置、文档、chunks、实体/边、watchConfigs 和 sourceSnapshots；未完成 Job 在清理前按原计费周期单次退款。

发布前运行 `npm run openapi-check`、`npm run sbom-check` 和 `npm run perf-check`；三者分别验证 OpenAPI 3.1 schema/引用/核心路径、CycloneDX/SPDX 的完整与生产依赖边界及许可证元数据、40 次本地 `/api/health` 请求 P95 和小于 500 KB 的首页响应体。`npm run provider-contract-check` 使用本地 HTTP 供应商实现走通 LLM 成功/错误/超时、支付 checkout 与签名 webhook、OIDC discovery/PKCE/RS256/userinfo、Browser Agent 渲染和 MCP initialize/list/call；它验证协议和安全边界，但不替代真实第三方沙盒或目标 worker/MCP server 验收。`npm run infrastructure-integration-check` 对配置的 S3-compatible/Neo4j 做带清理的真实写读删，本地已用 MinIO SigV4 和真实 Neo4j 通过。性能检查不是公网压力测试替代品，生产仍需独立压测；本地 SBOM/镜像扫描快照也不替代持续发布 CI。
