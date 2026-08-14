# `goal.md` 原始范围追溯

审计日期：2026-08-14。本表以 `goal.md` 为权威产品方向，区分“源码与自动化已证明”“仅有适配边界”“必须在目标生产环境取证”。任何外部项未取证时，整体目标保持 active。

| 原始范围 | 可验收结果 | 当前实现证据 | 判定 |
| --- | --- | --- | --- |
| Novi / AI Knowledge Scientist 定位 | 产品只聚焦 Knowledge Builder、Deep Research、Paper Author，不出现万能聊天入口 | `docs/PRD.md`、Web 主导航、`artifactDefinitions` | 已实现 |
| Knowledge Builder | LLM Wiki、四阶段学习路径、知识图谱、Core Components、Usage、Advanced、Interview、Project | `knowledgeArtifact()`、Web Wiki/Path/Graph、引擎与 Chromium smoke | 已实现 |
| 知识结构化 | 概念、关系、案例、实践问题及完成标准 | `graph`、`caseStudies`、`practiceQuestions`、Web Practice Lab、Markdown | 已实现 |
| Deep Research | Research Report、LLM Wiki、Knowledge Graph、SOTA、Research Opportunity、Sources | `researchArtifact()` 与 Web 六个独立视图；Markdown 导出 | 已实现 |
| Paper Author 流程 | Idea → Research Gap → Novelty → Contribution → Method → Experiment → Draft → Review | `paperArtifact()` 的 sections/researchGaps/noveltyAnalysis/contributions/method/experiments/review；Web 与测试 | 已实现 |
| 学术交付 | 结构化论文、LaTeX、Figures、Experiment Plan，IEEE/ACM 风格 | Markdown、SVG/Mermaid/picture figure、`template=ieee|acm` 和浏览器模板验证 | 已实现 |
| 全球知识源 | arXiv、IEEE、ACM、Springer、GitHub、Hugging Face、Wikipedia、YouTube、Docs、RFC、社区、Books/Reports、Blogs | `src/connectors.mjs`；IEEE/ACM/Springer 使用 Crossref DOI prefix 定向目录，避免伪装成付费官方 API | 已实现；YouTube 等凭据型源需生产凭据取证 |
| 知识过滤 | 相关性、权威性、新旧程度、可信/可访问性 | 统一归一化/确定性评分、URL/DNS/SSRF/内容哈希验证、claim mapping | 已实现；领域准确性仍需专家验收 |
| Processing pipeline | Document → Parser → Chunk → Embedding → Entity → Graph | `src/knowledge.mjs`、远程导入、PostgreSQL/pgvector/Neo4j 投影 | 已实现 |
| Knowledge OS memory | Document、Semantic、Graph、Research memory | 文档/片段/向量/实体关系、项目成果与来源快照 | 已实现 |
| 存储 | PostgreSQL 工作区/任务，Vector DB，Neo4j | PostgreSQL Repository、pgvector HNSW、Neo4j outbox | 已实现；目标托管实例容量/灾备待取证 |
| 四 Agent 边界 | 仅 Research、Knowledge、Writing、Review 四个有界职责 | 每个不可变 Artifact 的 `workflow.agents` 记录四阶段状态与实际输出计数；无 Agent 间自由对话 | 已实现 |
| Personal Knowledge Asset | 知识库、研究、学习、论文及历史版本持续积累 | 项目持久化、语义记忆、版本比较、指定版本导出 | 已实现 |
| Workspace / Team / Enterprise | 项目空间、团队空间、企业知识隔离 | 组织、邀请、owner/admin/editor/viewer、组织切换、共享租户项目与 SSO 边界 | 已实现；真实企业 IdP 待取证 |
| Continuous Update | 每日发现论文、技术和 GitHub 变化后自动更新 Wiki/成果 | snapshot diff → quota/Job → RAG → immutable artifact；busy/quota/failed 重试 | 已实现 |
| 商业方案 | Personal $20–50、Pro Research 约 $100、Enterprise $1000+ | Personal $29、Pro $99、Enterprise $1000 起；额度目录、管理员定价 UI、真实 payment-provider checkout 边界 | 已实现；真实支付沙盒/对账待取证 |
| Web UI + Desktop UI | 两个交付面共享完整产品能力 | `public/`、Electron 安全窗口、AppImage 打包态 smoke | Linux 已实现；Windows/macOS 签名安装升级待取证 |
| 数据采集架构建议 | Crawler、API Connector、Browser Agent、MCP Connector | 安全 HTTP/PDF/GitHub crawler 与 API connectors；`src/source-adapters.mjs` 提供固定来源 MCP adapter，把 concrete URL 纳入统一 evidence 管线；`src/mcp-runtime.mjs` 另提供租户配置、逐工具授权的通用 Agent MCP Streamable HTTP runtime。两条路径均带 HTTPS/allowlist、凭据、超时、大小和不可信输入边界 | 源码与本地协议契约已实现；目标 Browser/MCP 服务仍需真实凭据与生产取证 |
| 可正式收费商用 | 真实供应商、目标基础设施、容量、灾备、安全、签名与领域质量均有证据 | `docs/COMMERCIAL_READINESS.md` 第 3 节 | 未完成，外部门禁 |

## Agent / Workspace 目标追溯

以下八项来自 Agent Runtime 与 OpenHands 风格 Workspace 交互目标。OpenHands 仅作为交互和能力分层参考；Novi 使用自己的 LangGraph.js、有界权限和租户隔离实现，不加载或复制 OpenHands 运行时代码。

| 目标 | 当前实现证据 | 判定 |
| --- | --- | --- |
| 根据提示词意图选择 Workflow、ReAct、Plan & Execute、Supervisor，并可在运行中重新调度 | `src/agent-modes.mjs` 完成显式模式和中英文意图路由；`src/agent-runtime.mjs` 的 router/controller 记录并执行模式切换；核心测试真实运行四种图并验证 ReAct → Plan & Execute | 已实现 |
| 运行时显示当前执行模式 | Job 和 Session 持久化 `currentMode/currentModeLabel`；`public/app.js` 在 Workspace 状态条与 Session run header 实时刷新模式、阶段和进度；Chromium smoke 验证可见模式 | 已实现 |
| 内置工具与新增工具 | `src/agent-tools.mjs` 提供 workspace read/write/web search 和 allowlisted 自定义 HTTP Tool；三种自主模式进入同一有界 Tool node；领域、HTTP 和 provenance 测试覆盖 | 已实现 |
| MCP | `src/mcp-runtime.mjs` 使用官方 SDK 接入 Streamable HTTP discovery/call，逐工具授权、命名空间、加密凭据和调用边界完整；Customize/MCP 与协议集成测试覆盖 | 已实现 |
| Skills 与 Plugins | `src/skill-runtime.mjs` 提供有界 playbook 选择和 prompt 注入；`src/plugin-runtime.mjs` 以声明式 manifest 组合现有 Skill 与已授权 Tool；两者均进入 LangGraph、provenance 和 Customize UI | 已实现 |
| Workspace 默认进入对话 Session，右侧提供 Files、LLM Wiki、Document | 项目创建即创建默认 Session；`public/app.js` 渲染 Session rail、conversation composer 和三页 inspector；desktop/mobile Chromium smoke 验证布局与核心交互 | 已实现 |
| 左侧 Customize 可设置 MCP、Skills、Plugins | `public/index.html` 提供权限控制的 Customize 导航；`public/app.js` 提供 Tools/MCP/Skills/Plugins 四个配置页；Chromium smoke 验证保存与响应式布局 | 已实现 |
| Generate now 进入并留在当前对话 Session | 创建 Workspace 后直接 `showWorkspace` 并加载默认 Session；`Generate now` 携带当前 `sessionId` 异步生成，运行消息、模式、Artifact 链接回写当前 Session；Chromium smoke 覆盖完整旅程 | 已实现 |

这八项的完成不包含远程 Plugin marketplace、第三方可执行包、生产数据库 LangGraph checkpoint 或真实供应商生产验收；这些扩展和门禁继续记录在 `docs/IMPLEMENTATION_PROGRESS.md`，不改变上述功能的本地实现判定。

## 判定原则

- `goal.md` 中三条产品路径、Knowledge OS、持续更新、商业方案、Web/Desktop 是交付范围，必须由运行行为或自动化证明。
- Browser Agent 与 MCP Connector 位于“技术架构建议”；当前 MCP 包含两种互不替代的能力：固定来源 adapter 只允许配置工具返回 concrete URL 并继续走 evidence verification，通用 Agent MCP runtime 则把管理员显式启用的普通 Tools 作为不可信 observation 交给自主模式。两者都已有本地协议契约；只有在目标 Browser worker/MCP server 完成真实凭据、网络策略、容量和内容质量取证后，才能宣称对应服务已在生产可用。
- 本地 fake provider 只能验证协议和安全边界，不能替代真实 LLM、支付、OIDC、托管存储或领域质量验收。
