# Claude Code 插件

此目录是 Habblaud 的 Claude Code marketplace：仓库根目录的 `.claude-plugin/marketplace.json` 声明三个插件，分别负责观察、审批和消息。主安装流程见 [中文 README](../README.md)；上游葡语细节保留在 [README.pt-BR.md](README.pt-BR.md)。

```bash
npm run mod:install
npm run mod:status
npm run mod:uninstall
```

`mod:install` 经 Claude Code 官方 `claude plugin` 命令安装插件，会保留已有配置并在修改前备份。Claude Code 2.1.287 起支持这里的 mod 接口；更新后，已打开的会话运行 `/reload-plugins` 或重新打开。安装器支持 `-- --sem-permissoes` 和 `-- --sem-mensagens`。旧版 Claude Code 可用 `npm run usage:install` 和 `npm run hooks:install`，分别装用量采集和权限 hook；有对应 `:status` / `:uninstall` 命令。

| 插件 | 文件夹 | 作用 |
| --- | --- | --- |
| `habblaud` | `mod/habblaud` | 观察会话、抓取额度、显示其他 Agent 等待提示和 `/habblaud` 命令 |
| `habblaud-permissoes` | `mod/habblaud-permissoes` | 当前 Claude 会话的 `PermissionRequest` 通过本地服务器待答 |
| `habblaud-mensagens` | `mod/habblaud-mensagens` | 从本地服务器领取网页消息并以用户消息送入当前会话 |

## 观察 mod

`habblaud/hooks/register.ts` 不读取完整对话，也不修改模型提示。会话开始和用量变更时，从 Claude Code 原生 session API 读取 5 小时/每周额度及重置时间，写入 `~/.habblaud/usage/<账户>.json`，或 `HABBLAUD_USAGE_DIR` 指定目录；更新频率有限制。账户由 `CLAUDE_CONFIG_DIR` 或默认 `~/.claude` 决定。旧的 `usage:install` statusline tap 可提供同样数据，安装新 mod 时会清理旧 tap 并备份设置。

mod 定时请求本地 `GET /api/mod/summary`，在 Claude Code 界面提示其他 Agent 是否等待你处理；Habblaud 不在运行时提示消失并降低轮询频率。`/habblaud` 由 mod 本地回答办公室摘要，不发模型请求。mod 本身只观察，不批准工具、发送用户消息或替 Agent 改写对话。

## 权限插件

`habblaud-permissoes` 的 `PermissionRequest` hook 把当前请求送到本机 Habblaud，等待网页允许、拒绝或回答；操作仍在 Claude Code 原生终端可见，先收到的答复有效。若 Habblaud 不在运行、页面无人打开或请求到期，hook 退出且不替用户批准。端口由 `HABBLAUD_PORT` 指定，默认 `4747`；`HABBLAUD_PERMISSION_TIMEOUT` 控制等待时长（默认 300 秒，受 Claude Code hook 的 330 秒上限约束）。

权限详情包含工具名、必要输入和 diff，因此只在 Habblaud 本机回环访问时开放。网页可用操作取决于 Claude Code 为本次请求提供的建议；“始终允许”不会伪造新的持久规则。

## 消息插件

`habblaud-mensagens` 在交互式会话内轮询 `POST /api/mod/inbox` 并报到，页面有当前在线会话后才出现可用的消息输入。收到消息时用 Claude Code 的 `$.prompt.submit({text, asUser: true})` 送入原会话，随后经 `POST /api/mod/inbox/ack` 确认或报告错误。消息文本按用户输入原样投递，不翻译、不加模型提示前缀。已送达表示 Claude Code 接受了消息，不能推断模型已完成处理。

消息插件与观察 mod 分开，因为它会在你的名义下实际投递用户指令。若不需要这项能力，用 `npm run mod:install -- --sem-mensagens`，或从账户移除 `habblaud-mensagens@habblaud`，也可将服务器 `HABBLAUD_MENSAGENS=0`。

## 运行条件与安全

三个插件都只访问本机 `127.0.0.1:<HABBLAUD_PORT>`；服务器对网页写入、终端和桥实行回环地址、Host、Origin 及 JSON 内容检查。开放局域网后，网页不能读取完整对话、发消息或批准权限。插件不需要读取 DSH、Pi 或 Codex 的模型配置和凭据。

插件和旧 hook 在 Claude Code 会话中以当前账户权限运行。装之前可用 `claude plugin validate --strict mod/habblaud` 等命令静态查看各插件调用范围；使用官方 `claude plugin test` 跑 mod 专属测试。普通 `npm test` 和 `npm run typecheck` 不覆盖 Claude Code mod API 类型生成。

```bash
claude --plugin-dir mod/habblaud
claude plugin validate --strict mod/habblaud
claude plugin validate --strict mod/habblaud-permissoes
claude plugin validate --strict mod/habblaud-mensagens
cd mod/habblaud && claude plugin test
```

上游更详细的事件、静态验证输出与旧版本行为见 [葡语技术文档](README.pt-BR.md)。DSH 与 Pi 使用各自的[原生插件](../integrations/dsh/README.md)和[扩展](../integrations/pi/README.md)，不通过本目录模拟 Claude Code。
