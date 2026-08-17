# Novi 架构设计

## 1. 总体架构

```text
Browser / Electron
        |
HTTP + REST
        |
Novi Application Server
  |-- Project API
  |-- Agent Session API + conversation/run persistence
  |-- Tenant LLM Provider API + encrypted credential store
  |-- Tenant Agent Tools/MCP/Skills/Plugins API + encrypted credential store
  |-- LangGraph Agent Runtime (intent router / Workflow / ReAct / Plan & Execute / Supervisor)
  |-- Knowledge Intelligence Engine
  |-- Export Service
  |-- Knowledge Ingestion + Retrieval (chunk/embed/HNSW/entity/graph)
  |-- Acquisition Adapters (API catalogs / Browser Agent / MCP Streamable HTTP)
        |
Repository interface
        |
JSON (local/desktop) -> PostgreSQL JSONB envelope + pgvector/HNSW and relational knowledge projections (production baseline); optional object storage and Neo4j projections
```

当前采用模块化单体，避免在业务尚未稳定前引入分布式复杂度。`server.mjs` 是传输层，`src/engine.mjs` 是无状态领域层，`src/store.mjs` 是持久化层，`public/` 和 `desktop/` 是两个客户端交付面。

桌面交付由 electron-builder 将同一服务/UI 封装为 Linux AppImage、Windows NSIS 与 macOS DMG/ZIP。打包态服务仅监听随机回环端口，状态写入 OS `userData`，单实例锁避免两个本地服务争用同一状态；发布 workflow 强制 Windows/macOS 签名验证、公证和版本 tag 对齐。容器交付采用多阶段最小运行时并在 CI 归档镜像 SBOM/漏洞扫描结果。

`src/repository.mjs` 定义领域所需的最小 Repository 合约；`src/postgres-store.mjs` 提供可选 PostgreSQL JSONB 适配器和事务锁语义。生产切换通过 `NOVI_STORAGE=postgres`、`NOVI_PG_URL` 完成；本地默认 JSON 不变。PostgreSQL 初始化并维护 `novi_tenants`、`novi_projects`、`novi_jobs`、`novi_documents`、`novi_chunks`、`novi_knowledge_entities` 和 `novi_knowledge_edges` 的带租户/项目索引投影表，JSONB envelope 作为迁移兼容和原子备份源；高规模部署可将这些投影逐步替换为专用关系、向量和图索引。

## 2. Knowledge Intelligence Engine

引擎对三种产品共享主题清洗、成果版本、来源地图、图数据和导出能力。当前生成器默认是确定性离线实现，保证无 API Key 也能验证产品流程；设置 `NOVI_LIVE_SOURCES=true` 可启用内置 OpenAlex、arXiv、Wikipedia、Crossref、IEEE/ACM/Springer DOI-prefix 定向目录、GitHub、Semantic Scholar、Hugging Face、Stack Exchange、Reddit、RFC Editor，以及可选 YouTube、Internet Archive、Hacker News、官方文档连接器（每源独立失败并自动回退）。`src/source-adapters.mjs` 提供两个受控扩展：Browser Agent 只对用户显式选择的公开 URL 执行隔离 JS 渲染并返回提取文本；MCP 通过 Streamable HTTP 协商管理员指定的 source tool，把结构化 concrete URL 并入统一检索。生产扩展采用以下流水线：

```text
Query planning -> Connectors -> Parse/deduplicate -> Validate URL -> Rank evidence
-> Chunk/embed -> Tenant/project vector retrieval -> Entity/relation extraction -> Synthesis
-> Citation verification -> Artifact snapshot
```

Agent Runtime 以 `Goal → Reference Discovery → Research → Knowledge → Writing → Review → LLM Wiki Finalizer` 为受控生成骨架：Goal Agent 根据问题和产品范围生成专家级目标、成功标准和四个领域角色；Reference Discovery 随后用 Goal 的问题、领域、结果与范围构造有界查询，再通过受控连接器搜索论文、GitHub 和 Web/文档；四个 specialist 只负责各自白名单字段；Finalizer 必须把共享 Goal、参考资料、知识体系、体系文档和 Review 汇编为最终 Wiki。关闭实时来源时 Reference 节点记录 `offline`，已有受控快照记录 `provided`，检索失败记录 `fallback` 并退还来源额度，不把搜索入口伪装成已核验证据。外层提供意图路由与四种执行模式。Workflow 按固定顺序执行；ReAct controller 每次根据当前观察决定下一职责或结束（结束也只能先进入 Finalizer）；Plan & Execute 先产生最多 8 步的受限计划再执行；Supervisor 可重新分派职责。Controller 可返回新模式，Specialist fallback 也会触发 Supervisor，因此运行中可重新调度；总 Specialist 执行次数上限为 8，单职责最多两次。每个节点仍只能修改字段白名单内、与离线草稿结构相同的数据。来源、个人知识上下文和 evidence 始终由 Novi 控制，不允许模型添加来源或执行检索片段中的指令。

Project 固化默认 `wikiLanguage`，Generate 和 Composer 可按 allowlist 覆盖；Prompt 要求所有面向读者的 Wiki 字段使用目标语言，同时保留来源标题、专有名词、URL、代码和引用标识。默认 `zh-CN`，支持中英日韩法德西和巴西葡语；这是生成内容 i18n，不代表整个 Web UI 已本地化。每个不可变成果保存实际语言、Expert Goal、reference provenance、expertRoles、knowledgeSystem、systemDocument、llmWiki、initial/final mode、mode history、plan、controller event、provider/model、职责状态和 token 使用，并带一个与 Markdown 导出一致的 `llm-wiki.md` 文档快照。Composer 每轮以前一 Artifact 内容及累积来源为基线运行同一完整图，新 Markdown 以 `agent-wiki` 文档索引回 Workspace knowledge，并在 Artifact runtime 保存文档 ID、内容哈希、来源数和复用状态。异步 Job/Session 同步暴露 Goal、当前模式、阶段、进度和参考检索状态。未配置 Web Provider 时直接 Generate 保留确定性 Wiki 基线和诚实的离线运行标记，Composer 则在扣费前明确要求 Provider。

`src/agent-tools.mjs` 向自主模式提供统一的租户/项目工具注册表，包含 workspace read/write、通用 Web 检索、论文检索/公开内容获取、自定义 HTTP 工具和已授权 MCP 工具。`src/paper-tools.mjs` 将 DOI、arXiv 标识和公开论文 URL 归一化，在 DNS/SSRF、重定向、超时和 8 MB 边界内获取元数据或公开内容，并区分摘要、公开页面文本和成功解析的 PDF 全文，不能访问的正文不获得 evidence 身份。`src/mcp-runtime.mjs` 使用官方 MCP SDK 连接租户配置的 Streamable HTTP server，发现后生成稳定的 `mcp__...` 命名空间别名；新发现工具默认关闭，只有 owner/admin 逐项启用后才会进入 ReAct、Plan & Execute、Supervisor 的 tool node。每次运行仍共享最多 6 次工具调用的硬上限，调用记录进入 Job、Session 和 Artifact。MCP 返回值是不可执行、不可信 observation，不直接进入 verified evidence；图片和音频不会送入模型上下文。MCP Tasks、OAuth browser flow、stdio、prompts/resources 直接注入暂不支持。

`src/skill-runtime.mjs` 管理租户级受限 playbook。owner/admin 最多配置 20 个 Skill；运行开始时按产品范围，从显式 `/skill name`、always、触发词三种来源确定性选择最多 3 个。只有存在 Web LLM Provider 时才把指令注入 Planner、Controller 和 Specialist；Skill 不能改变工具注册表、来源集合、evidence 身份、字段 schema 或运行硬上限。Job 与 Session 保存当次选择，Artifact 只固化 Skill 元数据、匹配原因和指令 SHA-256，避免把可变配置误当作成果内容；完整指令仍保存在租户配置与备份中。

`src/plugin-runtime.mjs` 提供声明式组合：每次最多选择两个 manifest，把引用 Skill 合入既有上限，并把推荐工具与当次 registry 取交集。它不加载代码、凭据或远程包，不能授予工具/来源权限；远程 marketplace 和签名可执行包需要独立供应链与沙箱架构。

`src/agent-sessions.mjs` 在 Project 之上提供持久研究迭代边界。项目创建时生成默认 Session；同步/异步生成把用户消息、目标语言、Goal、参考检索状态、当前 mode/stage/progress、失败信息和 Artifact 引用写入同一个 Session，Job 保存 `sessionId` 和用户消息 ID。Composer 消息使用 `refine` Job 并把 Project 标记为 generating，因而不同 Session 不能并发覆盖同一 Wiki；完成后助手消息直接关联本轮 Artifact。Session 同时约束 `tenantId + projectId`，跨项目或跨租户查询统一 404，运行中不可删除；项目/账户删除级联清理。服务重启不会恢复 LangGraph 节点，但会把中断 Job 对应 Session 写成失败并解除 active run，使会话可继续使用。Web 工作区以 Session rail、Conversation composer 和 Files/LLM Wiki/Document inspector 三个可响应区域呈现该状态；运行时先显示 Goal，再显示 Reference Discovery；生成后 Files 提供不可变 `llm-wiki.md` 的转义纯文本预览。页面重开时若 active run 仍存在，会从 Job API 恢复轮询。

`src/llm-providers.mjs` 提供主流厂商目录和 LangChain chat model 适配，包括国内 MiniMax（固定 `https://api.minimaxi.com/v1`）和 DeepSeek。Provider 配置按租户保存且只允许 owner/admin 访问；API Key 使用 AES-256-GCM 加密，响应和账户导出只暴露 `hasApiKey` 与末四位。固定厂商 endpoint 不允许改写，Ollama 仅回环，自定义远端 endpoint 必须是 HTTPS 且主机列入部署 allowlist。Web 配置优先于旧 `NOVI_LLM_*` 单次网关。当前 LangGraph 使用 `MemorySaver`，用于单次执行的 thread checkpoint；Job 和最终阶段状态由 Novi Repository 持久化，但图节点 checkpoint 尚不能跨服务重启恢复。

## 3. 生产存储映射

- PostgreSQL：用户、组织、项目、Agent Session/消息、Tools/MCP/Skills 配置、任务、成果元数据、权限、审计和计费。
- Knowledge ingestion/retrieval：文档、内容哈希、分块、embedding、实体和关系写入 Repository envelope，并在 PostgreSQL 模式投影到带租户索引的知识表；始终维护 `novi_chunk_vectors` JSONB migration 投影，pgvector 可用时维护 24 维原生表与 HNSW cosine 索引。`Repository.searchKnowledge` 在生产走带 tenant/project 条件的 `<=>` 查询；同步和异步生成均检索最多 6 个片段，截断后随成果固化。JSONB/内存余弦只用于桌面、开发或迁移回退，生产门禁强制 `NOVI_REQUIRE_NATIVE_VECTOR=true`。单文档删除在主事务移除 document/chunk/entity/edge，关系投影的 orphan 清理同步删除 JSONB/native vectors；对象和图删除 intent 同事务写入持久 `externalProjectionJobs` outbox，提交后由 worker 幂等执行，失败按退避重试，过期租约在启动/轮询时恢复。已经固化到不可变成果的 excerpt 不受活跃知识删除影响。
- 对象存储：原始文档、解析结果、导出文件和图像；`src/object-store.mjs` 支持受控本地目录、Bearer HTTP gateway 或带 AWS SigV4 的 S3-compatible HTTP endpoint，原文写入和删除均采用安全对象键。
- PostgreSQL pgvector：`novi_chunk_vectors_native` 提供当前生产基线的带租户过滤 HNSW/余弦片段索引；LanceDB/Milvus 保留为目标规模超过单 PostgreSQL 边界后的 Repository 适配选项。
- Neo4j/兼容图存储：`src/graph-store.mjs` 通过 HTTP Transaction API 幂等同步实体与关系；所有节点和关系带租户、项目、文档标识，单文档、项目或账户删除均按对应范围执行 DETACH DELETE。
- Redis/队列：异步采集、生成、限流、去重和进度事件；当前 HTTP 节点也提供可关闭的轻量 Job consumer，多个实例通过事务性 queued→running claim 竞争任务，生产建议把同一 claim 升级为 Redis/队列消费。
- Observability：服务维护请求、生成和刷新计数，通过 admin-only `/api/metrics` 暴露；生产应接入 Prometheus/OTel，不把租户内容写入指标。
- Refresh Worker：单实例内按 `NOVI_REFRESH_INTERVAL_MS` 扫描 daily/weekly watch，声明 `refreshing` 互斥后执行来源查询。快照与最近 `autoUpdateStatus=completed` 的已应用基线比较；变化经过 generation quota、项目互斥、RAG 检索和 `continuous-update` Job 后生成绑定 snapshot ID 的新成果。busy/quota/failed/disabled 不推进基线，因此下一周期仍可重试；生产多实例应迁移到队列和分布式租约。
- Billing/Usage：按租户和自然月记录生成与来源查询用量；生产计费 provider 通过同一服务边界替换。
- Payment Adapter：checkout 只代理已配置 provider，webhook 在 HMAC 验证和事件去重后更新订阅；本地未配置时不模拟收费。
- Browser Agent：主服务不加载远程脚本；目标 URL 先做 DNS/SSRF 校验，再交给隔离 HTTP worker。worker 使用独立 bearer credential、阻断高成本资源并返回有界纯文本；最终 URL 再次校验后才进入普通摄取流程。
- MCP Source Adapter：主服务作为 MCP Streamable HTTP client 执行 initialize/list/call，只允许配置的已公布工具和固定 `{query,limit}` 参数；只采纳结构化无凭据 HTTP(S) URL，MCP 元数据不绕过 Novi 的排序与 evidence verification。
- Agent MCP Runtime：每个租户最多保存 5 个 Streamable HTTP server，通过官方 SDK 发现最多 100 个工具/server，管理员逐工具授权后并入 Agent registry；Bearer token 加密保存，远端 endpoint 受 HTTPS/host allowlist 约束，调用受 schema、超时和响应大小限制。它不替代固定来源 MCP adapter，普通 tool observation 也不自动获得 evidence 身份。
- External projection worker：对象存储和 Neo4j 的 upsert/delete intent 与文档事务同写 outbox；每次任务有状态、尝试次数、下一次执行时间和错误摘要，外部调用成功后回写 `objectProjection`/`graphProjection`，删除任务即使主数据已删除仍保留至完成；任务审计不包含原文内容。
- Organization/RBAC：用户通过 membership 绑定 tenant，owner/admin/editor/viewer 由服务端在每次请求重新计算；移除 membership 立即使现有会话失效，生成 worker 提交成果前也复核 active membership；Web 根据同一角色矩阵隐藏越权写控件，但不把客户端判断当作安全边界。
- OIDC SSO：服务端 discovery、code exchange 和 userinfo 均通过 HTTPS provider；state/nonce 哈希仅存服务端且一次性消费，回调不把 token 放入 URL。
- Browser CSRF：写请求若使用 `novi_session` Cookie 且没有 Bearer Authorization，服务端校验 `Origin` 与当前请求 origin，并拒绝 `Sec-Fetch-Site: cross-site`；显式 Bearer API 保持无状态调用语义。
- Web UI 不把会话 token 写入 localStorage，浏览器使用 HttpOnly/SameSite Cookie；外链仅渲染和打开 `http(s)` URL。刷新任务使用带 TTL 的 `refreshToken` 租约，旧任务不能覆盖新租约的快照或状态。

## 4. 安全架构

当前 API 在强制认证模式下按 `tenantId` 隔离项目、Job、向量检索、导出和审计，支持用户数据导出与账户删除；生产版所有查询仍必须在数据库策略层强制隔离。连接器运行于网络和文件系统受限的 worker；Browser Agent/MCP endpoint 仅允许 HTTPS（回环开发例外），生产非回环服务必须使用独立 token。固定来源 adapter 响应受超时与 1 MB 上限约束，Agent MCP POST 响应上限为 256 KB、超时最多 30 秒。远程/工作区/MCP 内容视为不可信输入，模型 system/user 消息明确禁止执行片段指令，且片段与 verified web evidence 分离；密钥进入 secret manager；成果保留来源、许可证、采集时间与内容哈希。

## 5. 扩展与可靠性

HTTP 节点无状态化后可横向扩容。当前已提供可轮询的异步 Job、项目级幂等保护和重启恢复；普通生成和持续更新均把额度、Job 与项目状态放在事务边界内。工作空间/成员删除与 Job 清理、原周期退款同事务完成，worker 在外部模型调用和成果提交边界检查 Job/项目/membership，避免删除后的无效供应商调用和幽灵提交。持续更新的数据流为 `watch claim → verified source snapshot → diff against last applied snapshot → quota/Job → workspace RAG → artifact commit → applied baseline`。生产扩展为队列消费者、幂等 Job ID 和 SSE 阶段进度。每阶段保存 checkpoint，供应商调用设置超时、退避、熔断和预算上限。PostgreSQL 每日备份并定期恢复演练。
