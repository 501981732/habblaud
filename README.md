<p align="center"><img src="client/public/assets/brand/logo-mark@4x.png" width="96" alt="Habblaud 像素风格标志" /></p>

<h1 align="center">Habblaud</h1>

<p align="center"><b>把 Claude Code、Codex、DeepSeek Harness 和 Pi 的本机 Agent 放进同一座像素办公室。</b><br />一个项目一间房，一个会话一个角色，实时看到谁在工作、等待你回应，或已经完成。</p>

<p align="center">
  <img alt="Node.js 22.19+" src="https://img.shields.io/badge/Node.js-%E2%89%A522.19-5fa04e?logo=node.js&logoColor=white" />
  <img alt="默认简体中文" src="https://img.shields.io/badge/%E7%95%8C%E9%9D%A2-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-4aa8e8" />
  <img alt="MIT 许可证" src="https://img.shields.io/badge/%E8%AE%B8%E5%8F%AF%E8%AF%81-MIT-f08a3c" />
</p>

![中文办公室：项目房间、Agent 状态、侧栏和活动信息](docs/screenshots/zh-CN/office.jpg)

![中文办公室的实际运行画面](docs/screenshots/zh-CN/office.gif)

以上使用演示数据，来自实际运行的中文界面。[中文设置](docs/screenshots/zh-CN/settings.jpg)、[使用说明](docs/screenshots/zh-CN/help.jpg)和[移动界面](docs/screenshots/zh-CN/mobile-settings.jpg)也已更新；本机联调范围和结果见[验证记录](docs/zh-CN/验证记录.md)。

首次打开默认使用**简体中文**；在「设置 → 语言」可切换为 Português (Brasil)，选择会保存在浏览器中。项目名、模型名、你发给 Agent 的原始消息、命令与工具结果不会被翻译。葡语上游说明见 [README.pt-BR.md](README.pt-BR.md)。

## 功能与来源

| 功能 | Claude Code | Codex | DeepSeek Harness（DSH） | Pi |
| --- | --- | --- | --- | --- |
| 项目房间、在线状态、活动、对话 | 本机会话；插件补充实时信号 | 本机会话；hooks 补充实时信号 | 原生 Cordis 插件 | 原生 extension |
| 最近会话与对话历史 | 本机 transcript | 本机会话文件 | DSH 原生 session query，经桥接缓存 | Pi session JSONL 的当前分支 |
| 从网页发消息 | 消息插件 | 本机 `codex queue` | 原生 `sessionController.prompt()` | 原生 `pi.sendUserMessage()` |
| 从网页处理审批 | 权限插件 | hooks | 原生审批回调；失联回退 DSH Web UI | 可选工具审批；默认关闭 |
| 使用量 | 5 小时/每周额度与 token | Codex 可提供的额度与 token | DSH 报告的 token；未知价格/额度不估算 | Pi 报告的 token/费用；未知值不估算 |

“运行环境”是 Claude Code、Codex、DSH、Pi；GLM、DeepSeek 等是运行环境内选用的**模型**。例如 DSH 使用 GLM 时，办公室显示 DSH 来源和 GLM 模型，不伪装成 Claude Code 或 Codex。按钮按每个会话实际可用的能力显示；插件离线时，已缓存的历史仍可查看，离线会话不会被当作在线 Agent。

![Habblaud 中文分享图：支持四种 Agent 运行环境](client/public/assets/og-image-zh-CN.png)

## 安装与启动

需要 Node.js **22.19 或更新版**、npm，以及至少一种本机 Agent 运行环境。Pi SDK 要求 Node.js ≥22.19.0。macOS、Linux 可以直接用 Node；上游 Windows 与 Docker 路径仍保留给 Claude Code / Codex。新原生桥建议先在同一台机器使用 Node 模式。

```bash
git clone https://github.com/501981732/habblaud.git
cd habblaud
npm ci
npm run build
npm start
```

打开 <http://127.0.0.1:4747>。默认只监听本机回环地址。开发时用 `npm run dev` 启动带热更新的服务器。端口被占用时可用 `HABBLAUD_PORT=4848 npm start`；更换端口后还要让 Codex hooks 和插件访问相同端口。

只想先认识界面，可以运行 `npm run demo`，或启动后在设置中打开演示模式。演示 Agent、对话和账户都是虚构数据，可与真实会话同时出现。

### Claude Code

只要本机有 Claude Code 会话，Habblaud 就能读取本机记录并显示房间、活动、历史和终端。推荐安装插件，取得用量、实时等待、网页消息和审批能力：

```bash
npm run mod:install
npm run mod:status
```

`mod:install` 通过 Claude Code 官方插件命令为检测到的账户安装观察 mod、权限插件和消息插件，修改配置前保存备份。可用 `-- --sem-permissoes` 或 `-- --sem-mensagens` 排除对应插件。较旧的 Claude Code 可以分别使用 `npm run usage:install` 和 `npm run hooks:install`。细节见 [Claude 插件说明](mod/README.md)。

已打开的 Claude Code 会话可运行 `/reload-plugins`，或重新打开，让新插件生效。插件里的 `/habblaud` 命令可在终端查看办公室摘要。账户目录默认来自 `CLAUDE_CONFIG_DIR`、`~/.claude*`；也可用 `HABBLAUD_CLAUDE_DIRS` 指定。

### Codex

Codex CLI / Desktop 会话位于 `~/.codex`、`CODEX_HOME` 或自动发现的 `~/.codex*` 中。不装 hooks 也能读取已有会话；要看到更及时的步骤并在网页处理审批：

```bash
npm run codex:install
npm run codex:status
```

在 Codex 的 `/hooks` 中批准新 hooks，再重新打开受影响的会话。安装器只增加 Habblaud 自己的 hooks，先备份现有配置，保留其他 hooks。网页版消息通过本机 `codex queue` 投递；如果命令不在 `PATH`，设置 `HABBLAUD_CODEX_BIN=/绝对路径/codex`。自定义账户目录用 `HABBLAUD_CODEX_DIRS`（逗号分隔）；`HABBLAUD_CODEX=0` 可关闭此来源。

### DeepSeek Harness（DSH），包括在 DSH 中使用 GLM

DSH 需要原生插件：它从 DSH 进程读取状态和解码后的历史，以原生会话控制器投递消息，并在有本地网页时处理实时审批。DSH 原有 Web UI 继续存在；桥断开或无人打开 Habblaud 页面时，审批回到 DSH Web UI。

先启动上面的 Habblaud Node 服务，再在仓库目录安装插件。以下是常见的 `web` profile：

```bash
npm run dsh:install -- --profile web
npm run dsh:status -- --profile web
```

安装器把本地构建的插件通过 DSH 官方 `dsh plugin` 命令加入 profile，备份可能改动的清单文件；重复安装同一来源不会覆盖其他插件。若 `dsh` 不在 `PATH`，加 `--dsh /绝对路径/dsh`；另一个 DSH_HOME 用 `--dsh-home /目录`。已有进程可能热重载，以 `dsh:status` 和办公室实际会话为准。DSH 的模型、认证和工作目录仍由 DSH 管理。

Habblaud 为插件生成私有的本机桥接配置，默认在 `~/.habblaud/bridge.json`。**不要提交该文件或在问题报告中粘贴其内容。** 若使用独立数据目录或多个 Habblaud 实例，给服务器与 DSH 进程设置相同的 `HABBLAUD_BRIDGE_CONFIG=/绝对路径/bridge.json`。移除插件见 `npm run dsh:uninstall -- --profile web` 与 [DSH 说明](integrations/dsh/README.md)。

DSH 插件已在本机正在运行的 DSH + GLM 上观察到加载和会话。模型调用、消息与审批的实测范围以本次 PR 的验收记录为准。

### Pi

Pi 通过原生 extension 接入。构建后，在要观察的 Pi 进程中显式加载扩展；同一台机器上的 Habblaud 服务要已启动：

```bash
pi --extension /绝对路径/habblaud/integrations/pi/dist/index.js
```

扩展跟随 Pi 当前进程的会话、工具与消息事件；历史只读扫描 Pi 的 session JSONL，并沿当前分支还原对话。默认目录是 `PI_CODING_AGENT_DIR` 或 `~/.pi/agent` 下的 `sessions/`。多个数据目录可将 `HABBLAUD_PI_DIRS` 设置为**Pi agent 目录**列表：macOS/Linux 用 `:` 分隔，Windows 用 `;` 分隔；代码会在每个目录下找 `sessions/`。

Pi 工具审批默认**关闭**。若要让网页处理每次 Pi 工具调用，在启动 Pi 前设置 `HABBLAUD_PI_APPROVALS=1`。本地桥不可用时回退 Pi 自己的确认界面；无交互界面、取消或超时均不会自动允许。网页只提供单次允许/拒绝，没有 Claude Code 的“始终允许”或问答建议。详情见 [Pi 扩展说明](integrations/pi/README.md)。

Pi 扩展已按官方 SDK 做本机加载与事件测试。是否完成真实 Pi 模型调用，以本次 PR 验收记录为准；扩展加载通过不等于模型链路通过。

### Docker 与局域网

原有 Claude Code / Codex 的 Docker 路径仍可用 `npm run docker:up`、`npm run docker:logs`、`npm run docker:down`；容器只读挂载所需会话目录。Codex 网页消息在容器模式还需在宿主机运行 `npm run codex:bridge`。DSH / Pi 原生桥的推荐路径是上述 Node 模式；本分支没有把新的原生桥验证为 Docker 方案。

如果通过 `HABBLAUD_HOST=0.0.0.0` 或 Docker 的 `HABBLAUD_BIND=0.0.0.0` 向局域网开放页面，终端、历史对话、网页消息、审批、角色编辑及原生桥都会关闭。只读办公室状态仍可查看；敏感内容和操作只在本机回环访问时开启。

### 从旧版更新

已有仓库可以按原来的 Git 方式更新，再运行 `npm ci`、`npm run build` 并重启服务。Claude 插件目录发生变化时重跑 `mod:install`；Codex hooks 用 `codex:status` 核对；DSH 插件使用本地构建路径，移动仓库后应重新安装。Pi 命令中的 `--extension` 路径也应指向新位置。

来自更早的 CodeTown 安装时，环境变量已改为 `HABBLAUD_*`，不能继续用 `CODETOWN_*`。上游的数据迁移及旧插件替换规则详见 [葡语原版的迁移说明](README.pt-BR.md#vindo-do-codetown)。在旧数据目录里有自己保存的截图、导出或其他文件时，更新前先自行备份。

## 界面怎么用

- **办公室与侧栏：**每个活动项目一间房，每个会话一名角色。角色会工作、闲置、等待你的许可或回答，并在任务结束后离开。子 Agent 有标识；房间可重命名，角色可在详情中编辑外观和姓名。灯光与昼夜随状态变化。
- **活动与详情：**点击角色查看当前工作、工具活动、任务及最近时间线；侧栏可拖动排序。`DSH`、`Pi` 等标识代表运行环境，模型名另列。
- **终端与历史：**本机访问时点击 Agent 打开对话，含用户消息、回复、工具调用及结果；历史页可查看最近关闭的会话。长对话按条目数和字节数截取。会话原文原样呈现，只有界面生成的说明随语言切换。
- **网页消息：**在 Agent 详情或终端输入。界面区分排队、已送达、失败；“已送达”表示运行环境已经接受，**不表示模型完成任务**。按钮只在相应 Agent 和桥在线且有消息能力时出现。
- **权限与问题：**Agent 请求许可时角色举手，侧栏和通知提示；可在网页允许、拒绝或回到原终端处理。只展示来源实际支持的决定。无本地可用页面或桥断线时，由各运行环境原生流程处理。
- **用量与统计：**顶部显示有数据的账户用量；「我的一天」按项目、账户和 Agent 汇总工作时间、工具、token 与可用的费用。DSH/Pi 不套用 Claude 订阅额度。
- **时间回放：**每天办公室状态可记录并重放；默认仅保留最近七天摘要。`HABBLAUD_TIMELINE=0` 停止新记录。
- **GitHub 动效：**从本机会话识别 push、PR、CI、release 等实际结果时，房间可庆祝或告警；失败命令不算成功。
- **生活场景：**空闲角色会在休息区、茶水间等位置互动；人格与小动作按角色稳定生成。
- **移动屏幕：**侧栏与详情改为抽屉；桌面可拖动窗口在窄屏回到固定布局。

中文截图见 [docs/screenshots/zh-CN](docs/screenshots/zh-CN/)。葡语上游图片和描述保留在 [README.pt-BR.md](README.pt-BR.md)。
中文分享图、像素素材管线与更新注意事项见 [素材与中文图片](docs/zh-CN/素材与中文图片.md)。

### 房间、角色与状态

Agent 进入一个项目时，会从电梯走到该项目的房间；同一个项目里的 Claude Code 与 Codex 可以共用房间，但仍保留各自的来源标识。主 Agent 与有可靠父子证据的子 Agent 分别显示。项目的最后一个会话结束后，角色离开、房间熄灯，空房最终转为花园；新会话到来时重新布置。

`working`、`idle`、`waiting`、`shell` 等状态分别描述正在执行、暂时空闲、需要你回答以及有后台命令在运行。`shell` 的等待时间、完成和失败效果来自实际命令信号，不能仅凭一条旧对话猜测。DSH/Pi 的状态来自原生事件；断线时不会无限保持“工作中”。

侧栏可以拖动房间和主 Agent 排序；房间可右键重命名。点击主 Agent 详情里的铅笔，可给项目角色换名字、皮肤、头发、衣服等，或「返回随机外观」。房间名和角色保存在 Habblaud 数据目录，不写回 Agent 的项目仓库。角色编辑需要本机敏感功能可用。

### 活动、终端与消息

活动流展示工具、文件、命令、搜索与会话状态的简要信息。详情面板列出任务、子 Agent、工具次数及最近活动；长时间线可分批展开。终端显示当前会话的消息和工具结果，按来源读取真实记录或原生桥提供的规范化记录。断线重连时会重新发送 `init`，避免把另一轮/另一会话接到旧内容后面。

在详情或终端底部发消息，网页先显示发送状态。Claude Code 的消息插件会在它的交互式会话里提交用户消息；Codex 调用本机 `codex queue`；DSH/Pi 调用各自原生投递接口。队列可能要等当前任务完成后才处理。消息发送前确认 Agent 的工作目录和模型，尤其是在多个同名项目并行时。

终端中的用户提示词、命令、工具结果会保留原语言。切到葡语只会改变「发送」「已送达」「工具完成」等产品文案；不会改写这段对话，也不会翻译用户自己输入的任务。屏幕上显示的路径、用户名和模型名同样保持来源原值。

### 审批与等待

当某个运行环境明确发出实时审批请求，且有打开的本机 Habblaud 页面时，侧栏和角色会提示「需要你处理」。点击后可看本次工具/输入，再按该来源支持的选项决定。Claude Code 的 AskUserQuestion 可以按原生 hook 可提供的信息回答；Codex、DSH、Pi 不会伪造别的运行环境的选项。

在原终端或 DSH Web UI 中先处理了请求，网页中的待决卡片应随之消失。网页已关闭、桥断开、请求取消或到期时，插件必须回到原生流程或拒绝；没有通用的“自动批准”。如果你希望所有审批始终只留在 Pi 自己的 UI，不设置 `HABBLAUD_PI_APPROVALS` 即可。

### 账户、用量与「我的一天」

Habblaud 依据各运行环境的账户目录区分来源账户。Claude Code 的 mod 会写入 5 小时/每周窗口及重置时间；Codex 只显示它实际提供的额度信息。DSH/Pi 若报告 token 或费用就显示这些数字；它们没有提供订阅额度时，界面应显示未知或不出现额度卡，不用 Claude 额度冒充。

「我的一天」按本地日期汇总工作、等待、工具调用、token 和可用费用，支持按项目/账户/Agent 查看。统计只代表 Habblaud 观察到的会话，不是精确的模型平台账单；插件离线、旧会话未被发现或来源未提供费用时，相应数字不完整。切换语言会改变日期和数字格式，不改变底层值。

### 时间回放与社交动画

「时间回放」展示某天办公室从早到晚的变化，记录的是房间、状态、活动短句和用量摘要。默认保存最近七天，关掉 `HABBLAUD_TIMELINE` 后停止产生新记录。可用 `npm run demo:timeline` 生成虚构的回放数据，用来试界面与录制演示。

空闲角色会在休息区、茶水间和娱乐区相遇、交谈或玩游戏；它们的性格、小动作和金币只是办公室演出。GitHub push、PR、CI、release 的庆祝/警示效果来自会话中的工具结果，有时间窗和去重；历史重放不会把旧结果当作刚发生的事件重复通知。

### 页面布局和通知

顶部是账户用量与全局按钮，侧栏是房间和 Agent，底部是活动流。点击角色可打开详情；终端与详情在桌面可以拖动和改变大小，在移动宽度会回到适合触控的抽屉布局。设置提供语言、声音、浏览器通知等偏好；浏览器通知需由你授权浏览器权限。

画布的气泡、房间标记和 GitHub 横幅也走中文/葡语翻译层，并使用可显示汉字的字体回退。中文截图应来自实际渲染界面；可见图片里的产品文字也应是中文，品牌专名 `Habblaud` 可以保留。

## 简要架构与 API

`server/sources` 负责 Claude Code/Codex 文件来源，`integrations/dsh` 和 `integrations/pi` 运行在各自 Agent 环境中；`server/bridge` 校验原生事件、维护来源状态与私有历史缓存。`server/model` 把它们汇总成房间和 Agent，`client` 通过 SSE 渲染像素办公室。

| HTTP 入口 | 用途 |
| --- | --- |
| `GET /api/health`、`GET /api/snapshot` | 健康与当前办公室 |
| `GET /api/stream` | 服务器推送快照、活动和通知 |
| `GET /api/agents/:id/terminal` | 当前 Agent 的对话流 |
| `GET /api/sessions/recent` | 最近历史会话 |
| `GET /api/stats`、`GET /api/timeline/days` | 每日聚合与时间回放 |
| `POST /api/messages`、`POST /api/permissions/:id/decision` | 本机发送消息和处理当前审批 |

`/api/bridge/*` 只供 DSH/Pi 插件以私有令牌在本机访问，不是面向浏览器的公开接口。具体字段与限制见 [server/README.md](server/README.md) 和 [桥接协议](shared/native-bridge.ts)。

本机部署时，前端、HTTP API 与 SSE 使用同一个端口；DSH/Pi 插件通过同端口的本机桥上传事件并轮询命令。多窗口浏览器共用同一个办公室快照，但语言、面板位置等纯界面偏好由各自浏览器保存。即使一个 provider 的连接断开，其余来源仍应继续更新。

## 常用配置

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `HABBLAUD_PORT` | `4747` | HTTP 端口 |
| `HABBLAUD_HOST` | `127.0.0.1` | Node 监听地址；非回环时敏感功能关闭 |
| `HABBLAUD_DATA_DIR` | `~/.habblaud` | 房间/角色、统计、回放和原生桥缓存 |
| `HABBLAUD_BRIDGE_CONFIG` | `<HABBLAUD_DATA_DIR>/bridge.json` | DSH/Pi 的本机桥接配置；插件未显式设置时读取 `~/.habblaud/bridge.json` |
| `HABBLAUD_CLAUDE_DIRS` | 自动发现 | Claude Code 账户目录，逗号分隔 |
| `HABBLAUD_CODEX_DIRS` | 自动发现 | Codex 账户目录，逗号分隔 |
| `HABBLAUD_CODEX_BIN` | `PATH` 中的 `codex` | Codex 消息队列命令 |
| `HABBLAUD_DSH` / `HABBLAUD_PI` | 开启 | 各设为 `0` 可关闭来源 |
| `HABBLAUD_PI_DIRS` | Pi 默认 agent 目录 | 多个 Pi agent 目录，按系统 `path.delimiter` 分隔 |
| `HABBLAUD_PI_APPROVALS` | 关闭 | 在 Pi 进程中设为 `1` 才接管工具审批 |
| `HABBLAUD_TERMINAL` | 本机访问时开启 | 设为 `0` 关闭对话、审批、消息等敏感能力 |
| `HABBLAUD_MENSAGENS` | 随终端开启 | 设为 `0` 仅关闭网页消息 |
| `HABBLAUD_TIMELINE` | 开启 | 设为 `0` 停止时间回放记录 |
| `HABBLAUD_UPDATE_CHECK` | 开启 | 设为 `0` 不检查 GitHub release |
| `HABBLAUD_DEMO` | 关闭 | 设为 `1` 启动演示角色 |

`HABBLAUD_BRIDGE_CONFIG` 的默认路径取决于数据目录。若服务器用了临时 `HABBLAUD_DATA_DIR`，但运行中的 DSH/Pi 仍读 `~/.habblaud/bridge.json`，两者不会连到一起；在**启动插件进程前**让双方读取同一个配置路径。不要把桥接 token 写入命令行、日志、截图或仓库。

## 工作方式与安全边界

服务器把 Claude Code / Codex 的本机记录，以及 DSH / Pi 原生桥送来的事件，规范为同一个 Office 模型。浏览器通过 `/api/stream` 的 SSE 更新办公室，`/api/snapshot` 取得当前状态，终端通过独立流取得对话。Claude Code 和 Codex 继续使用原有读取器和安装器；DSH 用官方会话查询解码压缩历史，Pi 历史只读取 session 树当前分支。老记录缺少 provider 时仍按 Claude Code 处理。

原生桥仅对回环地址开放，必须持有本地私有配置中的随机令牌；服务端继续检查 Host、Origin 和本地绑定。事件与命令有大小上限；重复序号不会再次创建活动。原生消息、审批受既有终端的本机访问限制。桥断线后会话下线，已获取的历史仍可看；晚到审批不自动获准。

服务器默认不把会话发往外部服务。启用更新检查时定期向 GitHub 公共 API 查询 release；关闭方式见上表。对话可能含敏感信息：仅在本机打开终端，避免把真实对话截图上传公开 Issue/PR。时间回放保存办公室摘要，不保存完整对话；原生历史缓存位于本机私有数据目录。

更细的 HTTP 接口、缓存上限与边界见 [服务器说明](server/README.md)；原生插件运行时约束见 [DSH](integrations/dsh/README.md) 和 [Pi](integrations/pi/README.md)。

## 更新、移除与排错

更新代码后运行 `npm ci && npm run build`，重启 Habblaud。若 Claude Code 插件路径或版本改变，重新运行 `npm run mod:install`；Codex 用 `npm run codex:status`；DSH 用 `npm run dsh:status -- --profile web`，构建位置变化时重新安装。Pi 启动命令应指向当前 `integrations/pi/dist/index.js`。

```bash
npm run mod:uninstall
npm run codex:uninstall
npm run dsh:uninstall -- --profile web
```

这些命令各自只移除 Habblaud 添加的插件或 hooks。停用 Pi 扩展，移除启动 Pi 时的 `--extension` 参数。`npm run docker:down` 只停止容器。

**看不到 Agent：**确认真实会话已经产生消息、目标进程加载了插件/扩展。Claude Code/Codex 检查账户目录；DSH 检查 profile 和 `dsh:status`；Pi 确认 `--extension` 指向已构建文件。`GET /api/health` 可看服务状态与已启用来源。

**消息/审批不可用：**检查页面通过 `127.0.0.1` 或 `localhost` 访问、服务监听回环地址，`HABBLAUD_TERMINAL` 和 `HABBLAUD_MENSAGENS` 没被关闭。Codex 需要可运行的 `codex`，Claude Code 需要插件；DSH/Pi 需要运行中的桥。Pi 审批还需单独启用 `HABBLAUD_PI_APPROVALS=1`。

**DSH 或 Pi 历史为空：**DSH 必须从原生 session query 读取已解码历史，不能直接把压缩文件当 JSONL；Pi 确认 `PI_CODING_AGENT_DIR` / `HABBLAUD_PI_DIRS` 指向 agent 目录，文件在最近七天内且属于可读的真实 session。断开的原生进程不会把旧会话标为在线。

**端口冲突与局域网访问：**换 `HABBLAUD_PORT` 并重配插件；局域网页面只保留只读办公室状态，允许的 Host 名称不会重新开启敏感操作。

逐来源的检查顺序和本机桥接配置见 [四种 Agent 的接入与故障排查](docs/zh-CN/接入与故障排查.md)。

## 开发与项目来源

```bash
npm run typecheck
npm test
npm run build
```

项目保留上游 [marmottajr/habblaud](https://github.com/marmottajr/habblaud) 的来源及 MIT 许可证；本 Fork 的改动见 [CHANGELOG.md](CHANGELOG.md)，架构与验收范围见 [设计方案](docs/superpowers/specs/2026-10-13-zh-native-agents-design.md)。本机联调、浏览器截图及 CI 的实际结论以对应 PR 的验证记录为准。
