# DeepSeek Harness 原生桥接

本地 Cordis 插件用于 DSH `0.2.0-rc.2`（Cordis `4.0.4`）。入口是本包 `exports["."]` 指向的 `dist/index.js`，导出 `inject` 和 `apply(ctx)`；`cordis.patch.yml` 是可加入 DSH profile 的 bundle 层。运行时只依赖当前 DSH 进程中的 `sessionQuery`、`sessionController`、`agents` 服务，不调用公开 Web RPC，也不读取模型凭据。

启动构建完成的 Habblaud Node 服务，打开看板并点击顶部的**连接 DSH**，或在**设置 → Agent 连接**中连接。它会自动检测 DSH，安装并启用桥接；有多个配置时由你选择目标。只有收到真实桥接心跳后，页面才显示“DSH 已连接”。已打开的 DSH 若未自动加载插件，请等当前任务结束后重启一次，以后会自动加载并重连。

手动安装和诊断也可在 Habblaud 仓库运行：

```sh
npm run build:integrations
npm run dsh:install -- --profile web
npm run dsh:status -- --profile web
```

移除本地桥接使用 `npm run dsh:uninstall -- --profile web`。卸载前同样备份 profile 文件，只移除同源的 Habblaud 依赖和 bundle 选择，保留其他插件和用户字段；没有安装时重复运行不改动配置。

安装命令把仓库中的**本地包**交给 `dsh plugin --profile web add <本地绝对路径>`。它优先使用 `--dsh <可执行文件>`、`HABBLAUD_DSH_BIN` 或 PATH 中的 `dsh`；若均没有，则寻找本机 npm npx 缓存中版本匹配的 CLI，不会下载另一份 DSH。`--dsh-home <目录>` 可以指定另一个 DSH_HOME。安装前会备份 profile 下已有的 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 和需改动的 `cordis.patch.yml`，备份仅供本机恢复，请勿提交。原 `dsh:install` 命令保留禁用状态；页面的“连接 DSH”是明确的启用动作，会只恢复此 bundle 与桥接组件，保留其他字段、注释和插件。不同来源的同名包不会被覆盖。`status` 只报告是否安装、启用，不输出凭据或会话。

连接接口只在本机 Node 模式可用，要求 DSH 来源及本地终端已启用；不支持从代理、远程主机或 Docker 修改宿主机 DSH。状态轮询不写配置，安装操作异步执行，重复点击合并为同一操作，安装失败可以重试。

插件读取 `HABBLAUD_BRIDGE_CONFIG` 指定的本地桥接配置；未指定时读取 `~/.habblaud/bridge.json`。目前 `cordis.patch.yml` 没有 `configFile` 字段，插件 `apply(ctx)` 也不读取 Cordis config；测试服务使用自定义数据目录时，应在启动 DSH profile 的环境中设置 `HABBLAUD_BRIDGE_CONFIG=<该服务的 bridge.json>`。配置内容不能写入日志或提交到仓库。DSH profile 中已有的 Web UI 和审批监听器继续运行。Web profile 默认启用 HMR，安装后会尝试热重载；实际加载情况应在目标 profile 的插件页或 DSH 诊断中确认。

启动时，插件通过 `ctx.sessionQuery.listSessions/readSession` 读取最近 7 天内最多 150 个会话（包含活跃会话），重放事件以计算状态、工具活动和用量；离线会话标记 `historical: true`，不会变成办公室里的在线 Agent。每个会话的终端仅保留最近 500 条、序列化后不超过 4 MiB；文本先遮蔽常见密钥模式。实时 `session/event` 按 `(sessionId, seq)` 去重。只有 DSH 提供实际 token 用量时才累计 token，不推断价格或配额。

消息进入原生 `ctx.sessionController.prompt`，将桥接命令 ID 作为 DSH `requestId` 保持重试幂等。ACK `ok: true` 只代表 DSH 已接纳进 Agent 收件箱。审批使用 `approval/request` waterfall：有活跃且允许审批的 Habblaud 浏览器时临时接管；没有浏览器、连接断开或超时则调用 `next()` 回退原 DSH Web UI；原请求取消则返回 `cancelled`。插件卸载会取消自己的计时器和待答请求。

版本升级时需重新核对 DSH 事件、`SessionController` 和 Cordis waterfall 契约。`subagent/start/end` 的 payload 本身不含父 Agent ID，父子关系只在会话头明确为 `origin: subagent` 且带 `parentSession` 时建立。普通 fork 不会显示成子 Agent。
