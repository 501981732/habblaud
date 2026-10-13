# Habblaud 服务器

本目录是 Node HTTP 服务、会话来源、办公室模型、终端/历史流与本机桥。中文指南在 [中文 README](../README.zh-CN.md)；葡语服务器说明见 [README.pt-BR.md](README.pt-BR.md)。

```bash
npm run dev                 # 开发：同一 HTTP 端口运行服务器与 Vite
npm run build && npm start  # 生产：提供 dist/client
```

默认端口 `4747`、只监听 `127.0.0.1`。服务器尽可能让一个来源的坏记录或断线只影响该来源。前端从 `/api/stream` 接收 SSE 快照、活动和通知；消息键由浏览器按当前 `zh-CN` 或 `pt-BR` 本地化，原始对话和工具文本不翻译。

## 来源与职责

| 来源 | 在线发现 | 历史/终端 | 双向交互 |
| --- | --- | --- | --- |
| Claude Code | `sources/claude` 读取本机 session 注册、transcript；mod/hooks 可补充实时信号 | 原始 transcript，按限额解析 | Claude 消息插件、权限 hook |
| Codex | `sources/codex` 读取本机会话和 live 状态；hooks 可补充实时信号 | Codex rollout / archived sessions | 本机 `codex queue`，hooks 审批 |
| DeepSeek Harness | `integrations/dsh` 在当前 DSH Cordis 进程使用 `sessionQuery` / `sessionController` | 原生 query 解码后通过桥送来，保存在 Habblaud 私有缓存 | 原生 prompt 与实时 approval 回调 |
| Pi | `integrations/pi` extension 监听 Pi 事件 | 桥接实时对话；`bridge/pi-history.ts` 只读扫描 JSONL 当前分支 | 原生 `sendUserMessage`；工具审批默认关闭 |

`sources/source.ts` 定义统一的 `AgentSource` 与 `HistoryProvider`。`sources/codex` 和 Claude 的文件来源保持原实现；`bridge/source.ts` 为 DSH/Pi 建立明确 provider、账户和会话身份，避免把它们误分流到 Claude。`sources/terminal.ts` 与 `http/terminal.ts` 统一传输终端对话；原生来源可直接提供规范化对话，不要求伪造文件路径。

### Claude Code 与 Codex

Claude Code 读取 session 注册、主会话和 subagent transcript，按工具调用 ID 配对活动与结果；有明确父子信息才展示子 Agent。后台 shell 命令通过 `sources/shells.ts` 跟踪；活跃测试、构建等可呈现等待、持续时间、完成或失败。Github push、PR、CI、release 仅在真实成功或明确结果时产生房间效果。

Codex 读取 CLI/Desktop 写入的本地 sessions、archived_sessions 与 thread-writer-locks。没有 Habblaud hooks 时仍能看会话文件；安装 hooks 后可得到更及时的事件和审批。账户目录来自 `CODEX_HOME`、`~/.codex*` 或 `HABBLAUD_CODEX_DIRS`。Codex 桥 `npm run codex:bridge` 供 Docker 容器内服务向宿主机投递 `codex queue`。

### DSH 与 Pi 原生桥

只有服务器以回环地址绑定、终端敏感功能开启，且至少一种原生来源开启时，`server/index.ts` 才生成本机桥接配置并启用 `/api/bridge/*`。配置文件默认在 `<HABBLAUD_DATA_DIR>/bridge.json`，也可由 `HABBLAUD_BRIDGE_CONFIG` 指定。文件是私有配置，包含随机令牌；不要将其写入日志、截图、Git 或诊断输出。

原生桥接口位于 `bridge/http.ts`，按 Bearer 令牌验证、限制消息体、检查协议版本与事件字段，并仍服从 HTTP Host/Origin/本地访问保护。`bridge/source.ts` 对每个 provider、账户与会话保留稳定身份、实例所有权和事件序号；重试的相同序号不重复应用；新实例替代旧实例后，旧事件不能覆盖新状态。失联的会话退出在线办公室，已获取的历史可继续读取。终端对话和会话元数据会按限额写入 `<dataDir>/native/`，私有文件权限；缓存不是 DSH/Pi 的原始会话文件。

DSH 的 `session.v3/v4.jsonl.zstd` 是原生压缩格式，服务器**不直接解压猜测格式**。DSH 插件使用其 `sessionQuery.listSessions/readSession` 读取已解码内容和最近会话，再将规范化事件送到桥。消息经 `sessionController.prompt()` 进入 DSH 的原生收件箱；成功 ACK 是“已接受”，不是“模型已处理”。审批仅在有可用本地页面时暂时接管；无页面、断线或超时回退 DSH 原有 Web UI，取消/晚到决定不能自动批准。

Pi extension 随当前 Pi 进程监听 session、agent、message、tool 事件。实时状态以 `agent_settled` 等稳定信号判断，不能把一次 `agent_end` 后可能发生的续跑误判为最终空闲。`PiHistory` 的冷历史只读扫描 Pi 的 `sessions/`，解析当前叶节点祖先链；旧分支不混入终端。`HABBLAUD_PI_DIRS` 是 agent 目录列表，用 Node `path.delimiter` 分隔（macOS/Linux `:`，Windows `;`），每个目录下再找 `sessions/`。工具审批仅在 Pi 进程设置 `HABBLAUD_PI_APPROVALS=1` 后开启；无可用 UI、取消、超时均不能自动允许。

## HTTP API

| 路由 | 用途 |
| --- | --- |
| `GET /api/stream` | SSE：`snapshot`、`feed`、`notice` |
| `GET /api/snapshot` | 当前 `OfficeSnapshot` |
| `GET /api/health` | 版本、来源、账户和交互能力状态 |
| `GET /api/agents/:id` | Agent 详情与最近活动 |
| `GET /api/agents/:id/terminal` | 在线 Agent 的终端 SSE，`init` / `append` |
| `GET /api/sessions/recent` | 最近七天的历史会话 |
| `GET /api/sessions/:account/:sessionId/terminal` | 历史会话的终端 SSE |
| `GET /api/stats?day=YYYY-MM-DD&tz=<IANA>&source=real\|demo` | 「我的一天」聚合 |
| `GET /api/stats/days?tz=<IANA>` | 有统计的日期 |
| `GET /api/timeline/days`、`GET /api/timeline/:day` | 回放日期与当日 JSONL |
| `GET /api/updates`、`POST /api/updates/check` | 上游 release 检查及手动刷新 |
| `POST /api/demo` | 打开/关闭演示角色 |
| `GET /api/mod/summary` | Claude mod 的办公室摘要 |
| `POST /api/mod/inbox`、`POST /api/mod/inbox/ack` | Claude 消息插件领取、确认消息 |
| `POST /api/permissions`、`GET /api/permissions/:id[/wait]`、`POST /api/permissions/:id/decision` | 权限请求、等待与决定 |
| `POST /api/messages`、`GET /api/messages/:id` | 网页发送消息与查看投递结果 |
| `PUT/DELETE /api/agents/:id/character` | 选择/重置角色 |
| `/api/bridge/*` | DSH/Pi 原生事件、轮询、确认；仅内部插件、私有令牌及本机可用 |

`/api/bridge/*` 不是供浏览器或外部调用的公共 API。外部客户端不要读取或复用 `bridge.json` 的令牌。普通 Office SSE 与原生桥的协议分开，保持旧版本快照和来源兼容：没有 provider 的旧记录继续视为 Claude Code；新增本地化键是可选字段，旧纯文本仍可显示。

### 终端、消息、权限与历史的限制

终端可能含完整对话，因此仅在本机回环绑定时开放；访问时还要满足 Host、Origin/JSON 请求保护。长 transcript 和原生对话都按最近条数与字节数裁剪，客户端看到截断标记。历史只列最近七天的有限会话；Pi 只读取普通文件、校验根目录与大小；原生缓存存于 Habblaud 数据目录。Demo 的对话是虚构数据。

网页消息进入对应 provider 的原生链路，并显示 `queued` / `sent` / `delivered` / `failed`。成功投递不保证模型输出；失败和超时可见。权限决定只作用于当前请求；无页面、断线、过期或已取消请求不能让后台默认批准。Claude/Codex 原有 hook 与插件的回答流程保留；DSH/Pi 由各自运行时负责本地回退。

时间回放写入 `<dataDir>/timeline/YYYY-MM-DD.jsonl`，保存办公室摘要并清理旧日；不记录完整终端对话。`<dataDir>/stats/` 存储按天聚合的数字和项目/账户标识，不存对话。`<dataDir>/native/` 仅用于原生桥的有界缓存。

## 关键环境变量

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `HABBLAUD_PORT` | `4747` | HTTP 端口 |
| `HABBLAUD_HOST` | `127.0.0.1` | Node 监听地址；非回环关闭敏感能力 |
| `HABBLAUD_BIND` | Docker Compose 的回环绑定 | 宿主机发布地址；非回环关闭敏感能力 |
| `HABBLAUD_DATA_DIR` | `~/.habblaud`，Docker `/data` | 状态、统计、回放、原生缓存 |
| `HABBLAUD_BRIDGE_CONFIG` | `<dataDir>/bridge.json` | 原生桥令牌和本机 URL 的私有配置 |
| `HABBLAUD_CLAUDE_DIRS` | 自动发现 | Claude 账户目录，逗号分隔 |
| `HABBLAUD_CODEX_DIRS` | 自动发现 | Codex 账户目录，逗号分隔 |
| `HABBLAUD_CODEX_BIN` | `PATH` 的 `codex` | 本机 Codex 消息投递 |
| `HABBLAUD_DSH` / `HABBLAUD_PI` | 开启 | `0` 分别关闭来源 |
| `HABBLAUD_PI_DIRS` | Pi 默认 agent 目录 | 多个 Pi agent 目录，平台路径分隔符 |
| `HABBLAUD_TERMINAL` | 本机开启 | `0` 关闭终端与敏感操作 |
| `HABBLAUD_MENSAGENS` | 随终端开启 | `0` 只关闭网页消息 |
| `HABBLAUD_TIMELINE` | 开启 | `0` 停止记录回放 |
| `HABBLAUD_UPDATE_CHECK` | 开启 | `0` 停止 GitHub release 检查 |
| `HABBLAUD_DEMO` | 关闭 | `1` 添加虚构 Agent |
| `HABBLAUD_ALLOWED_HOSTS` | 无 | 额外允许的 Host；不会重新开放敏感路由 |

Pi 的 `HABBLAUD_PI_APPROVALS` 在**Pi 进程**读取，不是 Habblaud 服务端开关。DSH/Pi 插件读取的 `HABBLAUD_BRIDGE_CONFIG` 必须与服务器生成的位置一致；若未设置插件侧变量，插件默认读 `~/.habblaud/bridge.json`。

## 验证入口

```bash
npm run typecheck
npm test
npm run build
npm run test:installers
```

原生桥的协议、重复事件、实例替换、历史边界、审批取消/超时与原有 Claude/Codex 回归通过仓库测试验证。真实运行时与模型联调须另看 PR 验收记录：单元测试、SDK 模拟事件、实际插件加载和真实模型请求是不同证据。测试时使用独立工作目录和虚构内容，避免把私人会话导入公开仓库。
