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

Agent Runtime 保留 Research、Knowledge、Writing、Review 四种受控职责，并在外层增加意图路由与四种执行模式。Workflow 按固定顺序执行；ReAct controller 每次根据当前观察决定下一职责或结束；Plan & Execute 先产生最多 8 步的受限计划再执行；Supervisor 可重新分派职责。Controller 可返回新模式，阶段 fallback 也会触发 Supervisor，因此运行中可重新调度；总 Specialist 执行次数上限为 8，单职责最多两次。每个 Specialist 仍只能修改字段白名单内、与离线草稿结构相同的数据。来源、个人知识上下文和 evidence 始终由 Novi 控制，不允许模型添加来源或执行检索片段中的指令。每个不可变成果固化 initial/final mode、mode history、plan、controller event、provider/model、职责状态和 token 使用；异步 Job 同步暴露当前模式、阶段和进度。未配置 Web Provider 时保留确定性离线流程。

`src/agent-sessions.mjs` 在 Project 之上提供持久对话边界。项目创建时生成默认 Session；同步/异步生成把用户消息、当前 mode/stage/progress、失败信息和 Artifact 引用写入同一个 Session，Job 保存 `sessionId` 和用户消息 ID。Session 同时约束 `tenantId + projectId`，跨项目或跨租户查询统一 404，运行中不可删除；项目/账户删除级联清理。服务重启不会恢复 LangGraph 节点，但会把中断 Job 对应 Session 写成失败并解除 active run，使会话可继续使用。当前 Web 仍使用旧成果工作区；Conversation Session UI 是下一独立交付项。

`src/llm-providers.mjs` 提供主流厂商目录和 LangChain chat model 适配，包括国内 MiniMax（固定 `https://api.minimaxi.com/v1`）和 DeepSeek。Provider 配置按租户保存且只允许 owner/admin 访问；API Key 使用 AES-256-GCM 加密，响应和账户导出只暴露 `hasApiKey` 与末四位。固定厂商 endpoint 不允许改写，Ollama 仅回环，自定义远端 endpoint 必须是 HTTPS 且主机列入部署 allowlist。Web 配置优先于旧 `NOVI_LLM_*` 单次网关。当前 LangGraph 使用 `MemorySaver`，用于单次执行的 thread checkpoint；Job 和最终阶段状态由 Novi Repository 持久化，但图节点 checkpoint 尚不能跨服务重启恢复。

## 3. 生产存储映射

- PostgreSQL：用户、组织、项目、Agent Session/消息、任务、成果元数据、权限、审计和计费。
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
- External projection worker：对象存储和 Neo4j 的 upsert/delete intent 与文档事务同写 outbox；每次任务有状态、尝试次数、下一次执行时间和错误摘要，外部调用成功后回写 `objectProjection`/`graphProjection`，删除任务即使主数据已删除仍保留至完成；任务审计不包含原文内容。
- Organization/RBAC：用户通过 membership 绑定 tenant，owner/admin/editor/viewer 由服务端在每次请求重新计算；移除 membership 立即使现有会话失效，生成 worker 提交成果前也复核 active membership；Web 根据同一角色矩阵隐藏越权写控件，但不把客户端判断当作安全边界。
- OIDC SSO：服务端 discovery、code exchange 和 userinfo 均通过 HTTPS provider；state/nonce 哈希仅存服务端且一次性消费，回调不把 token 放入 URL。
- Browser CSRF：写请求若使用 `novi_session` Cookie 且没有 Bearer Authorization，服务端校验 `Origin` 与当前请求 origin，并拒绝 `Sec-Fetch-Site: cross-site`；显式 Bearer API 保持无状态调用语义。
- Web UI 不把会话 token 写入 localStorage，浏览器使用 HttpOnly/SameSite Cookie；外链仅渲染和打开 `http(s)` URL。刷新任务使用带 TTL 的 `refreshToken` 租约，旧任务不能覆盖新租约的快照或状态。

## 4. 安全架构

当前 API 在强制认证模式下按 `tenantId` 隔离项目、Job、向量检索、导出和审计，支持用户数据导出与账户删除；生产版所有查询仍必须在数据库策略层强制隔离。连接器运行于网络和文件系统受限的 worker；Browser Agent/MCP endpoint 仅允许 HTTPS（回环开发例外），生产非回环服务必须使用独立 token，响应受超时与 1 MB 上限约束。远程/工作区/MCP 内容视为不可信输入，模型 system/user 消息明确禁止执行片段指令，且片段与 verified web evidence 分离；密钥进入 secret manager；成果保留来源、许可证、采集时间与内容哈希。

## 5. 扩展与可靠性

HTTP 节点无状态化后可横向扩容。当前已提供可轮询的异步 Job、项目级幂等保护和重启恢复；普通生成和持续更新均把额度、Job 与项目状态放在事务边界内。工作空间/成员删除与 Job 清理、原周期退款同事务完成，worker 在外部模型调用和成果提交边界检查 Job/项目/membership，避免删除后的无效供应商调用和幽灵提交。持续更新的数据流为 `watch claim → verified source snapshot → diff against last applied snapshot → quota/Job → workspace RAG → artifact commit → applied baseline`。生产扩展为队列消费者、幂等 Job ID 和 SSE 阶段进度。每阶段保存 checkpoint，供应商调用设置超时、退避、熔断和预算上限。PostgreSQL 每日备份并定期恢复演练。
