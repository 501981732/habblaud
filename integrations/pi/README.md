# Pi 原生接入

本扩展接入 Pi 的原生 session、agent、message、tool 和 UI 事件。适用 `@earendil-works/pi-coding-agent` 1.2.0 起的接口；实际版本以本机 `pi --help` 和已安装包的类型声明为准。扩展不启动模型，也不修改 Pi 配置。

先构建 Habblaud，启动其本地服务并让其生成 `~/.habblaud/bridge.json`。随后在要观察的 Pi 进程中显式加载构建产物：

```sh
pi --extension /绝对路径/habblaud/integrations/pi/dist/index.js
```

开发时也可直接 `pi --extension /绝对路径/habblaud/integrations/pi/extension.ts`。也可由用户自行把扩展加入 Pi 的 extension 配置。扩展只上报当前进程加载的会话；历史列表由 Habblaud 只读扫描 Pi 的 session JSONL。消息由扩展在原会话调用 `pi.sendUserMessage()`；“已送达”表示 Pi 接受了消息，运行完成以 `agent_settled` 为准。网页和 Pi 进程必须能够访问同一台机器的本地 Habblaud 接口。Pi 尚未安装时，Habblaud 仍可运行，其 Pi 来源显示为不可用或空。

工具审批默认关闭。需要通过 Habblaud 审批 Pi 工具调用时，在启动 Pi 前设置 `HABBLAUD_PI_APPROVALS=1`。只有本地页面和桥可用时，审批请求才由 Habblaud 处理；桥失联或返回“在 Pi 中回答”时，扩展调用 Pi 的 `ctx.ui.confirm()`。无交互 UI、超时或取消均拒绝该工具调用。这里仅提供单次允许或拒绝，不实现 Claude Code 的“始终允许”、中断及 AskUserQuestion 能力。开启此模式后所有 Pi `tool_call` 均需审批，包括第三方工具；是否需要启用由使用者决定。

扩展在 `session_shutdown` 清理轮询、心跳和待决审批，并通知 Habblaud。进程意外退出时，由 Habblaud 的心跳过期机制下线。Pi 的 session 文件是树状 JSONL，冷历史按当前叶节点的祖先路径显示；弃用分支不会混入终端。

验证入口：`npm test -- integrations/pi`，类型检查随项目的 `npm run typecheck`。真实 Pi 联调需本机安装 Pi，检查会话切换、并行工具、续跑后空闲、消息队列和审批回退；纯测试不能证明真实模型链路。
