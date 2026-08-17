# Novi 商用就绪审计

审计日期：2026-08-17。本文只记录可由当前源码、自动化命令或实际服务证明的状态；“已实现”不等于“已在目标生产环境验证”。

## 1. 需求与交付物追溯

| 范围 | 权威需求 | 当前证据 | 状态 |
| --- | --- | --- | --- |
| 产品范围 | `goal.md`、`docs/PRD.md`、`docs/GOAL_TRACEABILITY.md` | Knowledge Builder、Deep Research、Paper Author 三条路径；Knowledge Builder 含完整 Wiki、案例、练习题与 Practice Lab，Deep Research 含独立 Wiki/Knowledge Graph/SOTA，Paper Author 含完整章节、研究缺口/新颖性矩阵、证据链和 IEEE/ACM LaTeX；不提供通用聊天入口 | 已实现并有引擎/API/Web 测试，原始目标逐项追溯 |
| 软件规格 | `docs/SRS.md` | FR-01 至 FR-36、NFR-01 至 NFR-20 均有验收条件和实现位置 | 已文档化，自动化覆盖见第 2 节 |
| 架构与详细设计 | `docs/ARCHITECTURE.md`、`docs/DETAILED_DESIGN.md` | 模块化单体、Repository、PostgreSQL/pgvector HNSW、对象/图谱 outbox、认证/计费/刷新/恢复边界 | 已文档化且与当前模块一致 |
| API 契约 | `openapi.yaml` | `npm run openapi-check` 通过 OpenAPI 3.1 schema、引用、38 paths/44 operations | 已验证 |
| Web UI | `public/` | 创建/生成/指定版本导出、历史选择/逐节比较、来源搜索、静态或 Browser Agent JS 渲染知识导入、浏览/语义检索/单文档删除、RAG 上下文核查、变化驱动的持续更新、组织切换、Provider 配置、工作空间删除；可选 Wiki 语言；Files 内生成 `llm-wiki.md` 并在 Document 安全预览；Practice Lab、Deep Research Wiki/Graph/SOTA、Paper Gap & Novelty/Sources、IEEE/ACM 下载、套餐定价与真实 checkout 入口 | desktop/mobile Chromium smoke 已验证 8 种语言控件、Markdown 文件/转义纯文本预览、Provider 设置入口/目录与 viewer 隐藏、知识检索、生成、删除与历史 excerpt 保留闭环、两版本比较、来源变化自动生成第 3 个不可变版本、差异/更新状态、SVG、研究套件、论文缺口和出版模板；Provider API/真实 LangGraph 调用另由 HTTP 集成测试验证 |
| 生成工作流 | `src/agent-runtime.mjs`、`src/engine.mjs`、不可变 artifact | Web Provider 启用时 LangGraph.js 按 Goal → Reference Discovery → Research → Knowledge → Writing → Review → LLM Wiki Finalizer 执行；Goal 生成领域专家角色，Reference 再按 Goal 查询论文/GitHub/Web，Knowledge/Writing 产出知识体系/体系文档，Finalizer 必经并同步 `llmWiki`/`wikiSections`；每节点保存状态/token/实际输出计数，Artifact 固化目标语言、reference provenance 与 Markdown 快照；来源/evidence 不可由模型改写 | 本地 OpenAI-compatible HTTP 服务验证 6 次模型调用加 1 个无模型 Reference 节点、Goal 后检索、三类来源、失败退款、提前 finish 仍经过 Finalizer、Job 状态和 fallback；真实厂商账号仍待验收，checkpoint 目前仅进程内存 |
| 商业与来源集成 | `src/billing.mjs`、`src/payments.mjs`、`src/connectors.mjs`、`src/source-adapters.mjs`、`public/` | Free preview、Personal Knowledge、Pro Research、Enterprise 四档展示；未配置真实支付供应商时明确 503；IEEE/ACM/Springer 通过 Crossref DOI prefix 查询具体出版物；可选隔离 Browser Agent 和通用 MCP Streamable HTTP source tool 均带 HTTPS/凭据/超时/大小/字段边界 | 定价 UI/checkout、publisher catalogs、Browser Agent、MCP JSON/SSE 协议与运行时接线已测试；真实目标服务仍受第 3 节外部门禁约束 |
| Electron UI | `desktop/main.cjs`、`package.json` | 内置服务、安全 BrowserWindow、单实例、OS userData、同源导航；electron-builder 三平台配置 | Ubuntu AppImage 窗口 smoke 已通过；Windows/macOS 签名制品仍待托管 CI 取证 |

## 2. 当前可重复验证证据

| 门禁 | 验证范围 | 最近结果 |
| --- | --- | --- |
| `npm run check` | server、src、public、desktop、scripts、test 全部 JS 语法 | 48 modules 通过 |
| `npm test` | 领域引擎、LangGraph Goal/参考发现/专家协作/Finalizer、生成语言、Markdown 快照、Provider 加密/endpoint/RBAC、HTTP、认证、配额、支付、OIDC、摄取、RAG 安全、生成竞态、持续更新、恢复、投影、Browser Agent、MCP 和三条产品输出 | 83 passed，1 个 PostgreSQL 条件跳过 |
| `NOVI_PG_URL=... npm test` | 同上并包含真实 PostgreSQL 事务、关系、Job 清理和 JSONB 向量回退投影 | 67/67 passed |
| pgvector 0.8.6 实例测试 | 原生扩展、24 维表、HNSW cosine 索引、租户/项目过滤 `<=>` 查询及生命周期清理 | 固定 digest `sha256:ccc6e83d…d6b` 的真实 `pgvector/pgvector:pg16` 临时实例 67/67 通过；删除后 document/chunk/JSONB vector/native vector/项目 Job rows 均为 0，临时容器已删除 |
| `npm run openapi-check` | OpenAPI 3.1 schema 和引用 | 47 paths、59 operations 通过 |
| `npm run browser-smoke` | desktop/mobile Chromium 角色感知控件、8 种 Wiki 语言、创建、知识导入/浏览/语义搜索、检索上下文生成、两次异步生成、版本比较、生成 Markdown 预览、可控来源刷新/自动版本、单文档删除、历史 excerpt 保留、Markdown 导出、Paper SVG、Expert Goal/专家团队/知识体系/体系文档/最终 Wiki、定价、研究套件、论文缺口和出版模板 | 通过；`llm-wiki.md` 在 Files 可见，Document 使用无 HTML 执行的纯文本预览；desktop/mobile 均通过原完整旅程，来源变化生成第 3 个不可变版本，viewer 写控件隐藏，删除后搜索为空且不可变成果上下文仍可见 |
| `npm run desktop-smoke` | Electron 内置服务、安全窗口和共享 UI DOM | Electron 43.4.0 在当前 Ubuntu + 无 root 解包 Xvfb 下通过 |
| `npm run desktop-package-smoke` | `app.asar` 内置服务、OS userData、安全窗口和 UI | Linux unpacked 与 AppImage 均通过；正式 AppImage `.desktop` 不默认关闭 sandbox |
| `npm run perf-check` | 首页大小与本机 health P95 | 首页 10,547 bytes，P95 1.2 ms |
| `npm run stress-check` | 199 并发 health、40 并发项目写入 | 通过；本机 P95 125.8 ms |
| `npm run provider-contract-check` | LLM 成功/失败/超时、支付、OIDC、Browser Agent、MCP JSON-RPC/Streamable HTTP 协议边界 | 通过；不是第三方账号或目标 worker/MCP server 沙盒 |
| `npm run live-source-integration-check` | 真实公共连接器、concrete URL、SSRF 复核、内容哈希 | 4 results / 4 verified（本次网络环境） |
| `npm run storage-contract-check` | 文件/Bearer/SigV4 形态和 Neo4j HTTP 合约 | 通过 |
| `npm run infrastructure-integration-check` | 真实 S3-compatible/Neo4j 写、读、删及清理 | 真实 MinIO SigV4 + Neo4j 通过 |
| `npm run release-check` | 生产配置、迁移、恢复、API、SBOM、运维、Node 打包基线与目标追溯等发布必需制品，以及 provider/storage/SBOM 契约 | 13 artifacts present；全部契约通过 |
| Docker | 多阶段构建、healthcheck、readiness、默认认证、非 root、最小运行时 | 当前镜像 `sha256:5af027f80df589bc4f7fe746e3464669576e6c5bf28a3b8fd3b9300f7f0e0cb1`（284,819,481 bytes）无缓存且无 BuildKit warning 构建通过；readiness 200 并返回 Browser/MCP 配置状态；未显式设置 auth flag 时项目 API 返回 401；用户 `node`（UID 1000）；运行时无 npm/corepack，Node engine 基线已打包，并已直接确认包含禁止供应商重定向的 Browser/MCP adapters、Gap & Novelty、Personal 定价、有界四阶段 workflow、ACM prefix connector、Continuous Update、生命周期安全生成取消与 pgvector 代码 |
| `npm audit --audit-level=high --registry=https://registry.npmjs.org` | 当前锁文件生产与开发依赖 | Electron 43.4.0、ws 8.21.3 后 0 vulnerabilities |
| `npm run sbom-check` | 锁文件 CycloneDX/SPDX、生产依赖边界、许可证元数据完整性 | CycloneDX 1.5：352 components，runtime 59；SPDX 2.3：353 packages；通过 |
| Syft 1.51.0 + Grype 0.117.0 | 当前生产镜像的 OS/Node SBOM 与有修复版本的 High/Critical 漏洞 | 官方 SHA-256 校验；CycloneDX 1.7：144 components；0 vulnerabilities（2026-08-14 快照） |
| electron-builder 26.15.3 | 三平台配置、Node 22.12+ 前置门禁、图标、macOS hardened runtime/公证、Windows NSIS 签名门禁、Linux AppImage | 在 Node 20.18.1/22.11.0 复现并定位 ESM 加载失败，Node 20.19.0/22.12.0 验证依赖边界；商业基线采用仍受维护的 Node 22.12+，`.nvmrc` 固定 22.22.2。Linux AppImage SHA-256 `b956734a2233861e8feb160ae7941142bb87a80559217f33efd715f5a403016d`（160,965,398 bytes）经干净 `npm ci` 构建及无 root 解包 Xvfb 打包态窗口 smoke 通过，`app.asar` 包含加固 Browser/MCP adapters、Gap & Novelty、角色感知 UI、Continuous Update、单文档删除和生命周期安全生成取消；其他平台仅配置未实跑 |
| actionlint 1.7.7 | 固定 SHA 的商业门禁与签名发布 workflow 语义 | 官方 checksum 验证后的 actionlint 对两个 workflow 通过；CI PostgreSQL 服务已固定 pgvector 镜像 digest；当前目录非 Git 仓库，尚无托管 CI 运行记录 |

## 3. 仍未满足的正式收费发布证据

以下项目缺少目标供应商凭据、目标公网环境或目标操作系统，不能由本地 fake provider 代替，也不能据此宣称正式商用发布完成：

1. 真实生产候选 LLM 账号的质量、限额、超时、数据保留和成本验证；若部署启用 Browser Agent/MCP，还需对目标 worker/MCP server 的真实凭据、网络策略、容量、协议版本和内容质量取证。
2. 真实支付沙盒的 checkout、成功/失败/退款/取消、webhook 重放与对账验证。
3. 真实企业 OIDC 租户的 discovery、登录、退出、成员移除和密钥轮换验证。
4. 目标托管 PostgreSQL/pgvector、S3 和 Neo4j 的 TLS、IAM/最小权限、生命周期、备份与恢复演练；本地 pgvector/MinIO/Neo4j 只证明实现与协议路径。
5. 目标公网拓扑的容量/浸泡/故障注入测试，包括目标语料规模下的 HNSW 召回率/延迟/索引构建，以及 WAF、代理、日志、告警和灾备演练。
6. Windows NSIS 与 macOS DMG/ZIP 的真实构建、签名、公证、安装和升级 E2E，以及 Linux AppImage 的组织签名/干净系统安装验证；当前仅 Linux AppImage 构建与窗口 smoke 有本地证据。
7. 在真实托管仓库执行已实现的在线依赖/镜像/SBOM workflow，归档签名或证明化 SBOM，批准组织许可证策略并完成外部渗透测试；actionlint 和本地扫描不是托管 CI 记录或法律审核的替代品。
8. 领域专家对目标评测集的引用准确性、研究结论质量和论文输出质量验收。
9. 将 LangGraph `MemorySaver` 替换为与生产数据库一致的持久 checkpoint，并验证服务重启后从安全节点恢复；当前只持久化 Novi Job/阶段结果，中断任务按既有规则失败退款。
10. 评估并实现阶段内模型工具循环（如确有产品质量收益）；当前来源检索和 RAG 由受控 Novi adapter 预先提供，Agent 不会自主调用工具。

只有第 3 节全部在选定生产候选环境取得证据后，才能把整体状态从“可运行生产基线”改为“可正式收费发布”。
