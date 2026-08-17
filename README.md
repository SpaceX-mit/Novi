# Novi

Novi 是一个 AI Knowledge Scientist 工作台，当前可运行基线覆盖三条核心路径：Knowledge Builder、Deep Research 和 Paper Author。Web 与 Electron Desktop 共用同一套 REST API 和 UI。

## 快速开始

需要 Node.js 22.12+；推荐使用 `.nvmrc` 固定的 Node 22.22.2。首次运行：

```bash
nvm install
nvm use
npm ci
npm start
```

浏览器打开 <http://127.0.0.1:4173>。开发时可使用自动重启模式：

```bash
npm run dev
```

### 局域网访问 Web

需要让同一网络中的其他主机通过服务器 IP 访问时，监听所有网卡并强制启用账户认证：

```bash
HOST=0.0.0.0 PORT=4173 NOVI_AUTH_REQUIRED=true NOVI_APP_ORIGIN=http://<服务器局域网IP>:4173 npm start
```

例如当前机器可使用 `NOVI_APP_ORIGIN=http://10.0.90.51:4173`，其他主机打开 `http://10.0.90.51:4173`。不要在未启用认证时将端口暴露给其他主机；`0.0.0.0` 只是监听地址，浏览器必须使用机器的实际 IP。若远程连接失败，还需要在主机防火墙或云安全组中仅向可信网段放行 TCP 4173。公网部署必须使用反向代理 HTTPS，并按生产部署章节启用 Secure Cookie 和生产存储，不能直接暴露此开发 HTTP 服务。

### 在 Web 配置 LLM Provider

以组织 owner/admin 登录后，点击顶部的模型设置按钮即可选择 OpenAI、Anthropic、Google Gemini、DeepSeek、MiniMax、OpenRouter、Mistral、xAI、Groq、Azure OpenAI、Ollama 或自定义 OpenAI-compatible 服务，填写模型和 API Key 后点击 `Save & test`；该操作会先加密保存当前表单，再测试已经激活的配置，避免测试未保存表单时出现 `No active LLM provider`。MiniMax 使用国内官方 OpenAI-compatible endpoint `https://api.minimaxi.com/v1`，默认模型为 `MiniMax-M3`，也可以在 Web 中改成账号可用的模型。viewer/editor 看不到设置入口，服务端也会对 Provider API 返回 403。选择 Offline mode 会停用当前 Web Provider，并恢复离线生成或下述旧环境变量网关。

Web 中保存的租户配置优先于 `NOVI_LLM_BASE_URL`、`NOVI_LLM_API_KEY`、`NOVI_LLM_MODEL` 旧配置。启用 Web Provider 后，LangGraph.js 会根据生成提示词在 Workflow、ReAct、Plan & Execute 和 Supervisor 之间选择有界执行模式；控制节点可在运行中重新调度模式。每次 Generate 都按 `Goal → Reference Discovery → Research → Knowledge → Writing → Review → LLM Wiki Finalizer` 协作：Goal Agent 先把问题变成专家级目标和四个领域角色，Reference Discovery 再使用 Goal 的问题、领域、结果和范围查询论文、GitHub 与 Web/文档，Knowledge/Writing 分别产出知识体系和体系文档，Finalizer 汇编最终 LLM Wiki；四个 specialist 仍只能修改各自字段白名单。异步 Job 和工作区先显示 Goal，再显示参考检索状态及当前模式、阶段和进度；单阶段调用或响应校验失败时保留受控离线草稿，并转由 Supervisor 进行有界恢复。未保存 Web Provider 时，旧环境变量仍走原有单次 OpenAI-compatible 网关；两者都未配置时完全离线运行。`GET /api/agent/modes` 返回可用模式，生成请求可传 `{prompt,mode,language}`，其中 `mode=auto` 为默认。

创建 Workspace 时可选择 Wiki 内容语言，默认是简体中文；当前支持 `zh-CN`、`en`、`ja`、`ko`、`fr`、`de`、`es` 和 `pt-BR`，每次 Generate 也可覆盖项目默认值。这里的 i18n 指生成内容语言，Novi 操作界面本身仍以英文为主。设置 `NOVI_LIVE_SOURCES=true` 才会执行真实参考检索，并继续受来源额度、URL 验证和 evidence 门禁约束；未开启时 Reference Discovery 明确记录 `offline`，不会把离线搜索入口描述为已检索或已核验的证据。

每个新项目同时创建一个持久 Agent Session，并直接打开对话式工作区。左栏可新建、切换和删除空闲 Session；中栏保存用户/助手消息，composer 可选择 Auto、Workflow、ReAct、Plan & Execute 或 Supervisor，并设置 Wiki language；`Generate now` 和 composer 都在当前 Session 启动任务。右栏通过 Files、LLM Wiki、Document 切换工作区文件、不可变成果与文档片段，原有版本比较、导出、知识导入和来源更新仍可使用。每个完成的 Artifact 在 Files 中提供 `llm-wiki.md`，点击后在 Document 以转义纯文本安全预览，其内容与 Markdown 下载一致。`GET/POST /api/projects/:id/sessions` 可列出或新建会话，`GET/DELETE /api/projects/:id/sessions/:sessionId` 可读取或删除空闲会话；运行中的会话返回 409。同步和异步生成都可传 `{prompt,mode,language,sessionId}`，并把 Goal、参考检索状态、运行模式/阶段/进度、失败信息以及最终 Artifact 链接写回 Session。Session 按项目和租户双重隔离，随工作空间或账户删除，并包含在账户导出和 v3 备份中；服务重启会把中断 Session 置回 idle、写入失败消息并按原规则退款。

### 配置 Agent Tools

组织 owner/admin 可从左侧 `Customize` 进入 Tools，启停 `workspace_read`、`workspace_write`、`web_search`，或增加自定义 HTTP 工具。ReAct、Plan & Execute 和 Supervisor 会在控制循环中决定是否调用工具，把观察结果作为不可信数据交给后续 Specialist；Workflow 保持固定的四 specialist 顺序，不自主调用工具，外层 Goal 和 Finalizer 仍会执行。每次运行最多调用 6 次工具，自定义响应最多 32 KB，默认超时 10 秒且最多 30 秒。调用状态和截断后的输入/结果会保存在 Job、完成 Session 消息和 Artifact runtime provenance 中。

`workspace_read` 只能检索当前租户、当前工作空间的文档；`workspace_write` 默认关闭，启用后只能向当前工作空间写入受限文本知识；`web_search` 只在 `NOVI_LIVE_SOURCES=true` 且本次来源额度已取得时向模型公布。editor 可以在生成任务中调用管理员已启用的工具，viewer 只读，只有 owner/admin 可以修改配置。配置 API 为 `GET/PUT /api/agent/tools`。

远端自定义工具固定使用 `POST application/json`，必须使用 HTTPS，主机必须列入逗号分隔的 `NOVI_TOOL_ALLOWED_HOSTS`；本地非生产开发可使用回环 HTTP。输入 schema 必须是 `type: object`、`additionalProperties: false`，属性只允许 string/number/boolean。可选 Bearer token 使用与 Provider 相同的 AES-256-GCM 密钥加密，API、账户导出和浏览器均不返回明文或密文。超时可通过 `NOVI_TOOL_TIMEOUT_MS` 调整。

### 配置通用 Agent MCP

组织 owner/admin 可在 `Customize → MCP` 添加最多 5 个 MCP Streamable HTTP 服务器。先执行 `Save & discover`，Novi 会通过官方 `@modelcontextprotocol/sdk` 完成 initialize 和分页 `tools/list`；新发现的工具默认关闭，管理员逐项勾选并保存后，才会以 `mcp__服务器__工具_哈希` 命名空间进入 ReAct、Plan & Execute 和 Supervisor。相同服务器最多接纳 100 个工具，输入 schema 限制为 16 KB/12 层且在调用前通过 JSON Schema 校验；每次协议请求默认超时 10 秒、最多 30 秒，POST 响应最多 256 KB，图像/音频结果不会进入模型上下文。

远端 MCP endpoint 必须使用 HTTPS 且主机列入 `NOVI_MCP_ALLOWED_HOSTS`；本地非生产开发可使用回环 HTTP。可选 Bearer token 以 AES-256-GCM 加密，更改 endpoint 时不会沿用旧 token。调用结果按不可信 tool observation 处理，不会自动成为 claim evidence；调用名称、服务器、状态和截断结果沿用 Job/Session/Artifact provenance。当前支持 Streamable HTTP 的普通即时 Tools；需要 MCP task lifecycle 的工具会显示为不可启用，OAuth 浏览器授权、stdio 和 MCP prompts/resources 直接注入仍待后续实现。配置 API 为 `GET/PUT /api/agent/mcp`，连接发现为 `POST /api/agent/mcp/servers/:serverId/sync`。

现有 `NOVI_MCP_SOURCE_*` 仍是来源检索管线中的固定 source adapter，用于将 concrete URL 纳入来源排序；它与上述可由 Agent 自主选择的通用 MCP tools 相互独立。

### 配置 Agent Skills

组织 owner/admin 可在 `Customize → Skills` 创建最多 20 个租户级 playbook。每个 Skill 包含稳定名称、用途说明、最多 4000 字符的指令、Knowledge Builder/Deep Research/Paper Author 产品范围，以及 `Always for product scope` 或按触发词匹配的激活方式；用户也可在生成提示中用 `/skill skill_name` 显式激活。每次运行最多应用 3 个 Skill，优先级为显式指令、always、触发词匹配。

Skill 只在已配置 Web LLM Provider 的 LangGraph 运行中生效；完全离线的确定性生成不会伪装成已应用 Skill。Skill 指令会进入 Planner、ReAct/Supervisor controller 和 Research/Knowledge/Writing/Review prompt，但始终低于 Novi 的安全与数据边界：不能增加工具权限、添加来源、绕过字段 schema 或把 observation 变成 evidence。实际选择结果写入异步 Job、Session 和 Artifact，只固化 Skill 元数据、匹配原因与指令 SHA-256，不复制完整指令到成果 provenance。配置 API 为 `GET/PUT /api/agent/skills`；所有组织成员可审查会影响成果的指令，只有 owner/admin 可修改。

Workspace 中的对话框与成果按钮是两条独立路径：发送对话调用 `POST /api/projects/:id/sessions/:sessionId/messages`，必须先在当前 Web/桌面实例中配置并激活 LLM Provider，由 LangGraph chat Harness 返回自然语言消息；ReAct、Plan & Execute 和 Supervisor 可使用已授权 Tool/MCP，但不会创建 Artifact。`Generate now`、`Generate asset` 和 `Regenerate` 调用成果生成 API，产出 Knowledge/Research/Paper Artifact；没有 Provider 时允许离线确定性成果，但不会把模板摘要伪装成 LLM 对话。Web 的 `data/novi.json` 与 Electron OS `userData/novi.json` 是独立状态，Provider 必须在实际使用的实例内 `Save & test`。

### 配置 Agent Plugins

`Customize → Plugins` 提供声明式组合层：每租户最多 10 个版本化 manifest，每次最多激活 2 个，可按 `/plugin plugin_name`、always 或触发词选择，并引用现有 Skill 与当前已授权 Tool/MCP。引用 Skill 进入同一 3-Skill 上限；推荐工具在运行时再次与实际 registry 取交集。Plugin 不下载 npm 包、不执行租户 JavaScript、不保存密钥，也不能启用被关闭的工具。Job、Session、Artifact 只固化 manifest 元数据、实际推荐工具和 SHA-256。远程 marketplace、第三方签名包和可执行沙箱不属于当前实现。配置 API 为 `GET/PUT /api/agent/plugins`。

API Key 以 AES-256-GCM 加密保存在租户状态中，API、账户导出和浏览器都不会收到明文或密文。生产必须通过 Secret Manager 设置稳定的 `NOVI_CONFIG_ENCRYPTION_KEY`（至少 32 字符）；本地开发会在数据文件旁生成权限为 0600 的 `data/.novi-config-key`。已知 Provider 使用固定官方 endpoint；Ollama 只允许回环地址；远端自定义 OpenAI-compatible 主机必须使用 HTTPS 并列入逗号分隔的 `NOVI_LLM_ALLOWED_HOSTS`。每阶段超时由 `NOVI_LLM_TIMEOUT_MS` 控制，最大输出 token 由 `NOVI_LLM_MAX_OUTPUT_TOKENS` 控制，完整示例见 `.env.example`。

### Electron 桌面端

启动开发态桌面应用：

```bash
npm run desktop
```

该命令会启动 Electron、内置本地服务和应用窗口。Linux 上项目与 `node_modules` 应位于 ext4 等支持 Unix owner/mode/setuid 的文件系统；正式启动不会默认关闭 Chromium sandbox。

未启用认证的本地开发租户每月允许 1000 次生成，便于持续调试；`NODE_ENV=production` 的 Web 服务和 electron-builder 打包后的桌面制品自动收紧为每月 100 次。该边界只适用于 `tenantId=local`，不会改变 Free/Personal/Pro/Enterprise 登录账户的套餐额度；不得通过修改本地开发上限改变正式套餐。

生成 Linux x64 目录或 AppImage：

```bash
npm run desktop:dir -- --linux --x64
npm run desktop:dist -- --linux --x64
```

输出位于 `dist/desktop/`。`desktop:dist` 只构建制品，不会自动打开应用 UI；构建成功后需要单独运行 `linux-unpacked/novi` 或生成的 AppImage。真实打包产物可使用以下命令验证：

```bash
npm run desktop-package-smoke -- <executable-or-appimage>
```

Windows 使用 `--win --x64`；macOS 使用 `--mac --x64` 或 `--mac --arm64`。正式制品必须按照 `docs/RELEASE.md` 在目标平台签名、公证和验收。

### 测试与质量门禁

```bash
npm test
npm run check
npm run openapi-check
npm run release-check
```

其他门禁包括 `npm run sbom-check`、`npm run perf-check`、`npm run stress-check`、`npm run browser-smoke`、`npm run provider-contract-check` 和 `npm run storage-contract-check`。`npm run live-source-integration-check` 会访问真实公共来源并要求至少一个 concrete URL 通过内容哈希验证；设置 `NOVI_RUN_LIVE_SOURCE_INTEGRATION=true` 可将其纳入 release-check。配置真实 S3-compatible endpoint 与 Neo4j 后，可运行 `npm run infrastructure-integration-check` 验证写入、读取和删除清理；发布时设置 `NOVI_RUN_EXTERNAL_INTEGRATION=true` 可将其纳入 release-check。

## Electron 常见问题

### electron-builder 报 `ERR_REQUIRE_ESM`

典型错误为 CommonJS `require()` 无法加载 `@noble/hashes/blake2.js`。当前 electron-builder 依赖组合要求 Node.js 22.12+；使用项目固定版本并重新安装依赖：

```bash
nvm install
nvm use
node --version
npm ci
```

`node --version` 应为 v22.12.0 或更高版本，推荐与 `.nvmrc` 一致的 v22.22.2。`predesktop`、`predesktop:dir` 和 `predesktop:dist` 会在启动或打包前执行版本检查。

### Linux `chrome-sandbox` 要求 `root:root 4755`

若出现以下类型错误：

```text
The SUID sandbox helper binary was found, but is not configured correctly
chrome-sandbox should be owned by root and has mode 4755
```

先检查文件系统和权限：

```bash
findmnt -T node_modules/electron/dist/chrome-sandbox -o TARGET,SOURCE,FSTYPE,OPTIONS
stat -c '%U:%G %a %n' node_modules/electron/dist/chrome-sandbox
```

在 ext4 上可执行：

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
npm run desktop
```

如果项目位于 NTFS/FUSE（`findmnt` 显示 `fuseblk`），该文件系统可能让 `chmod 4755` 成功返回但权限仍显示 `777`。推荐把项目迁移到 `~/workspace/Novi` 等 ext4 目录，重新执行 `npm ci`，再设置上述权限。

暂时保留项目在 NTFS 时，可以把 Electron runtime 安装到支持 setuid 的 root 管理目录：

```bash
sudo install -d -o root -g root -m 755 /opt/novi-electron-43.4.0
sudo cp -R node_modules/electron/dist/. /opt/novi-electron-43.4.0/
sudo chown -R root:root /opt/novi-electron-43.4.0
sudo find /opt/novi-electron-43.4.0 -type d -exec chmod 755 {} +
sudo find /opt/novi-electron-43.4.0 -type f -exec chmod 644 {} +
sudo chmod 755 /opt/novi-electron-43.4.0/electron /opt/novi-electron-43.4.0/chrome_crashpad_handler
sudo chmod 4755 /opt/novi-electron-43.4.0/chrome-sandbox
ELECTRON_OVERRIDE_DIST_PATH=/opt/novi-electron-43.4.0 npm run desktop
```

升级 Electron 后应使用新版本目录重新安装 runtime。不要把 `--no-sandbox` 写入正式 `desktop` 或 AppImage 默认参数；测试脚本中的显式 `--no-sandbox` 仅用于隔离的自动化 smoke 环境。

## 数据、生产服务与容器

数据备份与恢复：`npm run backup`、`npm run restore`（生产环境应将目标路径挂载到加密备份卷并定期演练恢复）。原始 `goal.md` 的逐项范围、实现证据和外部门禁见 [`docs/GOAL_TRACEABILITY.md`](docs/GOAL_TRACEABILITY.md)。

Web/服务端数据默认保存在 `data/novi.json`，打包后的 Electron 默认保存在操作系统 `userData/novi.json`；可通过 `HOST`、`PORT`、`NOVI_DATA_FILE` 覆盖。设置 `NOVI_LIVE_SOURCES=true` 后，生成流程会尝试从 OpenAlex、arXiv、Wikipedia、Crossref、GitHub、Semantic Scholar、Hugging Face、Stack Exchange、Reddit、RFC Editor，以及可选 YouTube、Internet Archive、Hacker News 和官方文档搜索获取实时来源；每个来源独立超时/容错，默认关闭以保证离线、自测和隐私友好。YouTube 需要 `YOUTUBE_API_KEY`；GitHub 可通过 `GITHUB_TOKEN`、Semantic Scholar 可通过 `SEMANTIC_SCHOLAR_API_KEY` 提高速率限制。可通过 `NOVI_MCP_SOURCE_URL`、`NOVI_MCP_SOURCE_TOKEN`、`NOVI_MCP_SOURCE_TOOL` 接入返回结构化来源的 MCP Streamable HTTP 工具；它会加入同一去重、排序和 concrete URL 核验链。生产环境可设置 `NOVI_STORAGE=postgres` 与 `NOVI_PG_URL`，PostgreSQL 适配器使用带行锁事务的 JSONB envelope，并维护租户/项目/Job/知识关系投影；安装 pgvector 后额外维护 24 维 HNSW cosine 索引并用于工作区语义搜索。`NOVI_REQUIRE_NATIVE_VECTOR=true` 会在原生向量扩展不可用时拒绝生产启动。容器部署：

生产 HTTPS 部署请设置 `NOVI_AUTH_REQUIRED=true`、`NOVI_COOKIE_SECURE=true`、`NOVI_STORAGE=postgres`、`NOVI_PG_URL`、`NOVI_REQUIRE_NATIVE_VECTOR=true`、`NOVI_LIVE_SOURCES=true`、来源验证、对象存储 (`NOVI_OBJECT_STORE_URL` 或 `NOVI_OBJECT_STORE_DIR`) 和 Neo4j (`NOVI_GRAPH_URL`)（生产对象/图谱 URL 必须使用 HTTPS；本地回环测试允许 HTTP；Docker 镜像在 `NODE_ENV=production` 下默认开启认证和 Secure Cookie）；发布门禁会拒绝缺少生产存储、原生向量、实时来源、对象文档或图谱配置的构建。对象/图谱摄取与删除 intent 通过持久 `externalProjectionJobs` outbox 写入主事务，worker 负责幂等执行、退避重试和启动恢复；文档返回 `objectProjection`/`graphProjection` 状态。通过反向代理终止 TLS；只有在可信反向代理清洗 `X-Forwarded-Proto` 时才设置 `NOVI_TRUST_PROXY=true`，否则服务端按实际 socket 协议计算 CSRF 同源边界。容器通过多阶段构建使用 `npm ci` 按 `package-lock.json` 安装生产依赖，并从最终运行时移除 npm/corepack 构建工具链。

企业 SSO 配置 `NOVI_OIDC_ISSUER`、`NOVI_OIDC_CLIENT_ID`、`NOVI_OIDC_CLIENT_SECRET` 和 `NOVI_OIDC_REDIRECT_URI`；生产存储可设置 `NOVI_STORAGE=postgres`、`NOVI_PG_URL`，镜像已包含 `pg` 适配依赖。OIDC 与 PostgreSQL 均默认关闭，不影响离线桌面运行。

支付 checkout 仅允许当前组织 owner/admin 发起；`returnUrl` 仅在配置 `NOVI_APP_ORIGIN` 后接受同源地址，避免 provider 回跳被用作开放重定向。

OIDC 生产 issuer 和 discovery 返回的 authorization/token/userinfo/JWKS endpoint 必须使用 HTTPS（本地回环地址允许 HTTP）；支付 webhook 仅接受已签名且在订阅事件白名单中的事件。

```bash
docker build -t novi .
docker run --rm -p 4173:4173 -v novi-data:/app/data novi
```

## 文档

- [实现进度](docs/IMPLEMENTATION_PROGRESS.md)：已完成能力、未完成事项、已知问题和下一步。
- [PRD](docs/PRD.md)：产品范围、用户、优先级和商业边界。
- [SRS](docs/SRS.md)：功能/非功能需求、接口和验收追溯。
- [架构设计](docs/ARCHITECTURE.md)：Knowledge OS、存储、安全和扩展方案。
- [详细设计](docs/DETAILED_DESIGN.md)：模块、状态、错误和生产适配接口。
- [原始范围追溯](docs/GOAL_TRACEABILITY.md)：逐项映射 `goal.md`、实现证据和外部门禁。
- [商用就绪审计](docs/COMMERCIAL_READINESS.md)：逐项验证证据与仍需目标环境完成的正式发布门禁。
- [发布手册](docs/RELEASE.md)：三平台打包、签名/公证 Secret、SBOM、校验和及发布后验收。

当前生成器默认是离线确定性实现，目的是让完整产品流程可演示、可测试；实时连接器仅补充来源，不替代生产级引用核验。Knowledge Builder 输出 Wiki/路线/Practice Lab/图谱；Deep Research 分别输出 Report/Wiki/Graph/SOTA/机会；Paper Author 输出完整章节、research gap、novelty、方法、实验、图表和审稿，并可导出 IEEE/ACM LaTeX。每个不可变成果同时保存 Expert Goal、领域专家角色、Knowledge System、System Document、最终 LLM Wiki，以及四个 specialist 的模式切换、Skill/Plugin 与工具调用 provenance；配置 Web Provider 后由 LangGraph.js 的 Workflow/ReAct/Plan & Execute/Supervisor 调度职责，自主模式可使用管理员启用的工具，四种模式都可应用匹配的组织 Skills 和声明式 Plugins。当前 LangGraph checkpoint 不能跨进程重启恢复图节点；Plugin 不加载第三方可执行包。正式商业发布仍必须完成真实供应商/目标服务验收和其他外部门禁，详见商用就绪审计。

Web 操作与组织角色对齐：viewer 可浏览、搜索、查看历史和导出；editor 可创建、生成、置顶、导入知识、刷新来源、删除单个知识文档并在生成中使用已启用工具与匹配 Skills；admin/owner 还可配置组织 LLM Provider、Agent Tools/MCP/Skills、删除工作空间并发起付费 checkout。服务端会对每个写请求重新校验 membership。删除工作空间或发起任务的成员账户会取消关联未完成 Job、按原计费周期只退款一次，并阻止运行中的 worker 在删除后提交成果。

浏览器 Cookie 会话的写请求（POST/PUT/PATCH/DELETE）执行同源 `Origin`/Fetch Metadata 校验；跨站请求返回 403。显式 `Authorization: Bearer` 的 API 客户端不依赖浏览器 Cookie，因此不受该 CSRF 检查影响。

Web UI 不将会话令牌写入 `localStorage`，且以 Cookie-only 模式登录，登录和组织切换响应均不会向 Web JavaScript 暴露 Bearer token；切换组织会轮换并撤销旧会话。外部 API 客户端仍可选择 Bearer token。请求体限制按 UTF-8 字节计算，知识来源 URL 必须是带主机的 `http(s)` 地址；远程导入和证据验证会拒绝私网、链路本地、CGNAT、文档/基准、组播及 IPv4-mapped IPv6 保留地址。外部来源链接和 Electron 新窗口仅允许 `http(s)` 协议。刷新任务使用 15 分钟租约 token，避免过期任务覆盖新刷新结果。

Cookie 会话写请求必须带同源 `Origin`；登录失败按客户端 IP 做 15 分钟专用限流（认证 API 客户端可不发送 Origin）。

项目工作区支持 `Import notes` 导入不超过 900 KB 的文本/代码笔记，自动生成内容哈希、分块、离线向量和知识图谱实体/关系；`Browse & search knowledge` 可浏览文档并检索片段。同步和异步生成都会检索与项目主题最相关的最多 6 个片段，把实际使用内容固化到不可变成果并在 UI/导出中展示；片段被标记为不可信用户上下文，不会自动成为已核验引用。PostgreSQL 会维护带租户索引的向量/图关系投影，配置对象存储和 Neo4j 时通过持久 outbox 同步原文和图数据，失败会退避重试并在启动后恢复；内容可通过 `GET /api/projects/:id/knowledge[?q=...]` 查询，editor 可在 UI 使用 `Remove` 或调用 `DELETE /api/projects/:id/knowledge/:documentId` 删除单个文档及其活跃关系/向量/外部投影。为保证成果版本不可变，已经生成的成果仍保留当时使用的 excerpt；需要完整清除敏感数据时应删除整个工作空间或账户。Paper Author 额外输出结构化图表：Web 显示 SVG，Markdown 输出 Mermaid，LaTeX 输出可编译的 picture figure。

编辑者还可通过工作区的 `Import web/PDF URL` 或 `POST /api/projects/:id/knowledge/import` 导入公开网页、纯文本、PDF 和 GitHub 代码库。服务端会阻断凭据 URL、私有/本机地址、危险重定向和超过 8 MB 的响应；远程内容仅作为待审查知识输入，不代表事实核验。对需要 JavaScript 的网页可提交 `render=browser`，并配置 `NOVI_BROWSER_AGENT_URL`、`NOVI_BROWSER_AGENT_TOKEN`；主服务先校验目标 URL，再由隔离 worker 渲染并对最终 URL/响应大小复核。Browser Agent/MCP 非回环生产 endpoint 必须使用 HTTPS 和独立 bearer token，未配置 Browser Agent 时渲染导入明确返回 503。

实时检索在所有供应商都失败时会返回错误并退回本次来源查询配额；部分供应商失败时保留其他成功来源。IEEE、ACM、Springer 分别通过 Crossref DOI prefix 定向检索具体出版物，并与 OpenAlex、arXiv、GitHub、Hugging Face、文档、社区、视频、图书和博客来源统一排序。启用实时来源时，生成和刷新会对 concrete URL 再做 DNS/SSRF、凭据、重定向、超时和响应大小验证，保存来源内容哈希；无法访问的来源不会进入 claim-level evidence。异步生成任务会在服务重启后恢复项目状态，并按任务记录的原计费月份退回未完成配额。

商业目录为 Personal Knowledge `$29/月`（30 次生成/150 次来源查询）、Pro Research `$99/月`（100/500）和 Enterprise `$1000+/月`（1000/5000）。owner/admin 可从 Web 比较并发起 checkout；未配置真实支付 provider 时返回 503，不创建模拟订单。

项目还支持手动/每日/每周更新配置：`PUT /api/projects/:id/watch` 接受 `enabled`、`frequency` 和 `autoUpdate`。手动或定时刷新会抓取并保存最多 20 次来源快照，按 URL、内容哈希和来源元数据识别新增/更新/移除；发现相对最近已应用快照的变化时，自动扣除一次生成额度、创建 `continuous-update` Job、检索工作区知识并追加绑定 snapshot ID 的不可变成果版本。相同来源不会重复生成；项目忙碌、额度不足、自动更新关闭或生成失败不会推进已应用基线，后续周期仍可重试。来源查询和生成各自按原计费周期失败退款，删除或 membership 失效会在模型调用和提交前取消任务。来源历史 UI 展示差异与 artifact 更新状态。服务默认启动单进程刷新 worker，可通过 `NOVI_REFRESH_WORKER=false` 关闭，轮询间隔由 `NOVI_REFRESH_INTERVAL_MS` 配置；多实例生产应接入分布式队列/锁。

管理员可通过 `GET /api/metrics` 查看进程级请求、生成和刷新计数；该接口在强制认证模式下需要 admin membership，指标不包含租户内容。
