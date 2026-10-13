<p align="center">
  <img src="client/public/assets/brand/logo-mark@4x.png" width="96" alt="Habblaud pixel-art building" />
</p>

<h1 align="center">Habblaud</h1>

<p align="center">
  <b>English</b> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.pt-BR.md">Português (Brasil)</a>
</p>

<p align="center">
  <b>A virtual office for your coding agents.</b><br />
  One room per project, one pixel-art character per session.<br />
  Watch Claude Code, Codex, DeepSeek Harness, and Pi work, wait for you, and finish their tasks.
</p>

<p align="center">
  <img alt="Node.js 22.19+" src="https://img.shields.io/badge/Node.js-%E2%89%A522.19-5fa04e?logo=node.js&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-7-3178c6?logo=typescript&logoColor=white" />
  <img alt="UI: Simplified Chinese and Brazilian Portuguese" src="https://img.shields.io/badge/UI-zh--CN%20%7C%20pt--BR-4aa8e8" />
  <img alt="MIT License" src="https://img.shields.io/badge/License-MIT-f08a3c" />
</p>

<p align="center">
  <a href="#installation">Quick start</a> ·
  <a href="#connect-your-agents">Agent setup</a> ·
  <a href="docs/zh-CN/接入与故障排查.md">Integration guide (中文)</a> ·
  <a href="https://github.com/501981732/habblaud">Source</a> ·
  <a href="LICENSE">License</a>
</p>

<p align="center">
  <img src="docs/screenshots/zh-CN/office.gif" width="820" alt="Habblaud running in Chinese, with agents working in their project rooms" />
</p>

---

Running agents across several projects makes it easy to lose track of who is doing what. **Habblaud** turns those sessions into an office you can read at a glance: who is typing, who needs your approval, who left a command running, and who has finished. Open a character's conversation, send the next instruction, or review a pending request from the same page.

Between tasks, the office has a life of its own. Characters take coffee breaks, watch TV, play games, and meet their colleagues. These animations stay in Habblaud; your agents keep working normally.

The office runs on your machine. Claude Code and Codex use local session records; DSH and Pi connect through native plugins. The UI supports **Simplified Chinese and Brazilian Portuguese**, with Chinese as the initial language. Change it in Settings → Language. Original prompts, commands, paths, model names, and tool results keep their original text.

## Contents

- [What it looks like](#what-it-looks-like)
- [Supported agents](#supported-agents)
- [Installation](#installation)
- [Connect your agents](#connect-your-agents)
- [Using the office](#using-the-office)
- [Configuration](#configuration)
- [Privacy and security](#privacy-and-security)
- [Update and uninstall](#update-and-uninstall)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Credits and license](#credits-and-license)

## What it looks like

- **Rooms and characters:** Active projects get their own rooms. Main agents and supported subagents arrive by elevator, work at their desks, and leave when their sessions end.
- **Live activity:** See tools, files, searches, commands, tasks, and recent activity. Runtime and model labels are shown separately.
- **Conversations and history:** Read current conversations and recently closed sessions, including tool calls and results, from the local web UI.
- **Messages and approvals:** Send instructions to connected agents and handle the decisions their runtime supports. Waiting characters raise a hand when they need you.
- **Background commands:** A running shell command keeps its agent at the desk, with elapsed time and a completion or failure effect.
- **Usage and “My Day”:** View available account limits, tokens, costs, and work time by project, account, or agent.
- **Timeline playback:** Replay the office's day. Summaries are kept for seven days by default.
- **GitHub events:** Successful pushes, PRs, CI, and releases can trigger celebrations; failures can trigger alerts.
- **Social life:** Idle characters chat, drink coffee, watch TV, play games, and build friendships or rivalries.
- **Desktop and mobile:** Reorder rooms, rename projects, customize characters, and use drawers on smaller screens. Sound and browser notifications are optional.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/agent-details.png" alt="Agent details showing tasks, subagents, activity, and statistics" /></td>
    <td width="50%"><img src="docs/screenshots/night.png" alt="The office at night, with lit rooms and corridor lights" /></td>
  </tr>
  <tr>
    <td><b>Agent details.</b> Tasks, subagents, activity, and statistics in one panel.</td>
    <td><b>Day and night.</b> The sky and office lighting follow your local time.</td>
  </tr>
</table>

> Screenshots use fictional demo projects, agents, and accounts. The animation above shows the Chinese UI; the detail and night screenshots show the Portuguese UI. More previews: [Chinese office](docs/screenshots/zh-CN/office.jpg), [settings](docs/screenshots/zh-CN/settings.jpg), [help](docs/screenshots/zh-CN/help.jpg), and [mobile](docs/screenshots/zh-CN/mobile-office.jpg).

## Supported agents

| Feature | Claude Code | Codex | DeepSeek Harness (DSH) | Pi |
| --- | --- | --- | --- | --- |
| Project rooms, online status, activity, conversations | Local sessions; plugin adds live signals | Local sessions; hooks add live signals | Native Cordis plugin | Native extension |
| Recent sessions and conversation history | Local transcripts | Local session files | Native DSH session query, cached through the bridge | Current branch of Pi session JSONL |
| Send a message from the web UI | Messaging plugin | Local `codex queue` | Native session controller | Native extension |
| Handle approvals from the web UI | Permission plugin | Hooks | Native approval callback; falls back to DSH Web UI if disconnected | Optional tool approval; off by default |
| Usage | 5-hour/weekly limits and tokens | Limits and tokens provided by Codex | Tokens reported by DSH; unknown prices/limits are not estimated | Tokens/cost reported by Pi; unknown values are not estimated |

Claude Code, Codex, DSH, and Pi are agent **runtimes**. GLM, DeepSeek, and similar names are **models** selected within a runtime. A DSH session using GLM is labeled with DSH as its source and GLM as its model. Buttons appear only when the session supports the corresponding capability. Cached history remains available when a plugin is offline; disconnected sessions are marked offline.

## Installation

You need Node.js **22.19 or later**, npm, and at least one local agent runtime. The Pi SDK requires Node.js ≥22.19.0. macOS and Linux can run directly with Node. Use Node mode on the same machine for DSH/Pi. Docker and Windows support for these native integrations has not been verified.

```bash
git clone https://github.com/501981732/habblaud.git
cd habblaud
npm ci
npm run build
npm start
```

Open <http://127.0.0.1:4747>. By default, the server listens only on the local loopback interface. For development, run `npm run dev` to start the server with hot reload. If the port is occupied, use `HABBLAUD_PORT=4848 npm start`; after changing the port, configure Codex hooks and plugins to use the same port.

To explore the UI first, run `npm run demo`, or enable demo mode in Settings after starting the server. Demo agents, conversations, and accounts are fictional and can appear alongside real sessions.

## Connect your agents

### Claude Code

If you have local Claude Code sessions, Habblaud can read their local records and show rooms, activity, history, and terminals. Installing the plugins is recommended for usage, live waiting signals, web messaging, and approvals:

```bash
npm run mod:install
npm run mod:status
```

`mod:install` uses Claude Code's official plugin commands to install the observer mod, permission plugin, and messaging plugin for detected accounts. It backs up configuration before changing it. Use `-- --sem-permissoes` or `-- --sem-mensagens` to omit the corresponding plugin. Older Claude Code versions can use `npm run usage:install` and `npm run hooks:install` separately. See the [Claude plugin guide (Chinese)](mod/README.md).

For already-open Claude Code sessions, run `/reload-plugins` or reopen the session to load the plugins. The `/habblaud` plugin command shows an office summary in the terminal. Account directories are discovered from `CLAUDE_CONFIG_DIR` and `~/.claude*` by default; you can also set `HABBLAUD_CLAUDE_DIRS`.

### Codex

Codex CLI/Desktop sessions are located in `~/.codex`, `CODEX_HOME`, or automatically discovered `~/.codex*` directories. Existing sessions can be read without hooks. To see more timely steps and handle approvals in the web UI:

```bash
npm run codex:install
npm run codex:status
```

Approve the new hooks in Codex `/hooks`, then reopen affected sessions. The installer adds only Habblaud's hooks, backs up the existing configuration, and preserves other hooks. Web messages are delivered through the local `codex queue` command. If the command is not on `PATH`, set `HABBLAUD_CODEX_BIN=/absolute/path/codex`. Set `HABBLAUD_CODEX_DIRS` (comma-separated) for custom account directories; set `HABBLAUD_CODEX=0` to disable this source.

### DeepSeek Harness (DSH)

DSH requires a native plugin. It reads state and decoded history from the DSH process, delivers messages through the native session controller, and handles live approvals when a local Habblaud page is open. DSH's own Web UI remains available; if the bridge disconnects or no Habblaud page is open, approvals return to the DSH Web UI.

Start the Habblaud Node service described above, then install the plugin from the repository directory. The following uses the common `web` profile:

```bash
npm run dsh:install -- --profile web
npm run dsh:status -- --profile web
```

The installer adds the locally built plugin to the profile using DSH's official `dsh plugin` command and backs up manifest files it may change. Reinstalling the same source does not overwrite other plugins. If `dsh` is not on `PATH`, add `--dsh /absolute/path/dsh`; use `--dsh-home /directory` for another DSH_HOME. Existing processes may hot-reload; check `dsh:status` and the sessions shown in the office. DSH continues to manage its own model, authentication, and working directory.

Habblaud generates a private local bridge configuration for the plugin, at `~/.habblaud/bridge.json` by default. **Do not commit this file or paste its contents into an issue.** If you use a separate data directory or multiple Habblaud instances, set the same `HABBLAUD_BRIDGE_CONFIG=/absolute/path/bridge.json` for the server and DSH process. Remove the plugin with `npm run dsh:uninstall -- --profile web`. See the [DSH guide (Chinese)](integrations/dsh/README.md).

DSH keeps control of its model configuration and authentication, including GLM or DeepSeek models. Habblaud displays the runtime and selected model separately.

### Pi

Pi connects through a native extension. After building, explicitly load the extension in the Pi process you want to observe. The Habblaud service must be running on the same machine:

```bash
pi --extension /absolute/path/habblaud/integrations/pi/dist/index.js
```

The extension follows session, tool, and message events from the current Pi process. For history, it scans Pi session JSONL read-only and reconstructs the conversation along the current branch. The default directory is `sessions/` under `PI_CODING_AGENT_DIR` or `~/.pi/agent`. To use multiple data directories, set `HABBLAUD_PI_DIRS` to a list of **Pi agent directories**: use `:` on macOS/Linux and `;` on Windows. The code looks for `sessions/` under each directory.

Pi tool approval is **off by default**. To handle every Pi tool call from the web UI, set `HABBLAUD_PI_APPROVALS=1` before starting Pi. If the local bridge is unavailable, approval falls back to Pi's own confirmation UI. A missing interactive UI, cancellation, or timeout never grants approval automatically. The web UI offers one-time allow/deny only; it does not provide Claude Code's “always allow” or question suggestions. See the [Pi extension guide (Chinese)](integrations/pi/README.md).

The Pi extension has been checked with the official SDK for loading and events; a real Pi model request has not been verified. See the [validation record (Chinese)](docs/zh-CN/验证记录.md) for the tested scope of all four runtimes.

### Docker and LAN access

For Claude Code/Codex, use `npm run docker:up`, `npm run docker:logs`, and `npm run docker:down`; the container mounts the required session directories read-only. For Codex web messaging in container mode, also run `npm run codex:bridge` on the host. Use Node mode for DSH/Pi; their native bridges have not been verified in Docker.

If you expose the page to your LAN with `HABBLAUD_HOST=0.0.0.0` or Docker's `HABBLAUD_BIND=0.0.0.0`, terminals, conversation history, web messaging, approvals, character editing, and native bridges are disabled. Read-only office status remains available; sensitive content and actions are enabled only for local loopback access.

## Using the office

### Rooms and characters

Click a character to open its details, tasks, subagents, and activity. Drag rooms and main agents in the sidebar to reorder them; right-click a room to rename it. The pencil in a main agent's details lets you change its name and appearance. These settings are stored in Habblaud's data directory.

Agents in the same project can share a room across runtimes. When the last session closes, the lights go out and the room becomes a garden until another session arrives. `working`, `idle`, `waiting`, and `shell` distinguish active work, inactivity, a request for your response, and a running background command. Disconnected DSH/Pi sessions go offline while cached history remains readable.

### Conversations, messages, and approvals

Open a conversation from an agent's details. History includes user messages, replies, tools, and results; long conversations are limited by entry count and size. Prompts and tool output retain their original language.

Send the next instruction from details or the conversation panel. Delivery is shown as queued, delivered, or failed. **Delivered means the runtime accepted the message**, not that the model completed the task. A queued message may wait for the current turn to finish. Confirm the working directory and model before sending.

Approval controls appear only for pending requests that the connected runtime supports. If you answer in the original terminal or DSH Web UI, the office clears the request. A closed page, disconnected bridge, canceled request, or timeout returns control to the native flow or denies the request; it never grants approval automatically. Pi's optional approval setting is described [above](#pi).

### Accounts, usage, and playback

Account usage appears when the source provides it. Claude Code can report 5-hour/weekly windows; Codex reports its own limits. DSH/Pi report their available tokens and costs, without substituting Claude subscription limits or estimating unknown prices.

“My Day” groups observed work time, waiting, tools, tokens, and available costs by project, account, and agent. Offline plugins and unavailable costs can leave gaps; these statistics are not a model-platform invoice.

Timeline playback records office summaries rather than full conversations. The default retention is seven days. Set `HABBLAUD_TIMELINE=0` to stop recording, or run `npm run demo:timeline` to try fictional playback data.

### Social life

Idle characters meet in the lounge and kitchen, watch TV, play video games or ping-pong, and challenge each other to rock-paper-scissors. Their personalities, friendships, rivalries, and fictional coins make the office feel busy between tasks. See the [social lounge animation](docs/screenshots/social-lounge.gif).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HABBLAUD_PORT` | `4747` | HTTP port |
| `HABBLAUD_HOST` | `127.0.0.1` | Node listen address; sensitive features are disabled on non-loopback addresses |
| `HABBLAUD_DATA_DIR` | `~/.habblaud` | Room/character data, statistics, playback, and native bridge cache |
| `HABBLAUD_BRIDGE_CONFIG` | `<HABBLAUD_DATA_DIR>/bridge.json` | Local DSH/Pi bridge configuration; if not explicitly set for the plugin, it reads `~/.habblaud/bridge.json` |
| `HABBLAUD_CLAUDE_DIRS` | Auto-discovered | Claude Code account directories, comma-separated |
| `HABBLAUD_CODEX_DIRS` | Auto-discovered | Codex account directories, comma-separated |
| `HABBLAUD_CODEX_BIN` | `codex` on `PATH` | Codex message queue command |
| `HABBLAUD_DSH` / `HABBLAUD_PI` | Enabled | Set either to `0` to disable that source |
| `HABBLAUD_PI_DIRS` | Default Pi agent directory | Multiple Pi agent directories, separated by the system's `path.delimiter` |
| `HABBLAUD_PI_APPROVALS` | Off | Set to `1` in the Pi process to take over tool approvals |
| `HABBLAUD_TERMINAL` | On for local access | Set to `0` to disable sensitive features such as conversations, approvals, and messages |
| `HABBLAUD_MENSAGENS` | Follows terminal setting | Set to `0` to disable only web messaging |
| `HABBLAUD_TIMELINE` | On | Set to `0` to stop timeline recording |
| `HABBLAUD_UPDATE_CHECK` | On | Set to `0` to disable GitHub release checks |
| `HABBLAUD_DEMO` | Off | Set to `1` to start with demo characters |

The default path for `HABBLAUD_BRIDGE_CONFIG` depends on the data directory. If the server uses a temporary `HABBLAUD_DATA_DIR` while a running DSH/Pi process still reads `~/.habblaud/bridge.json`, they will not connect. Before starting the plugin process, configure both sides to read the same path. Do not put the bridge token in a command line, log, screenshot, or repository.

## Privacy and security

Habblaud reads local session records and native events; it does not send your conversations to an external service. Release checks query the public GitHub API when enabled; set `HABBLAUD_UPDATE_CHECK=0` to disable them.

Conversations, web messages, approvals, character editing, and the native bridge are available only through local loopback access. Exposing the page on a non-loopback address keeps read-only office status and disables sensitive features. The native bridge also requires a private token and checks Host, Origin, source ownership, event size, and event sequence.

Room data, statistics, timeline summaries, and native history caches are stored in the local data directory. **Keep `bridge.json` private** and avoid publishing screenshots of real conversations. DSH history uses the runtime's decoded session query; Pi history follows only the current branch of its session tree.

See the [server guide (Chinese)](server/README.md) for API endpoints and cache limits, and the [native bridge protocol](shared/native-bridge.ts) for integration fields.

## Update and uninstall

After updating the code, run `npm ci && npm run build` and restart Habblaud. If the Claude Code plugin path or version changed, rerun `npm run mod:install`; for Codex, run `npm run codex:status`; for DSH, run `npm run dsh:status -- --profile web` and reinstall if the build location changed. The Pi startup command should point to the current `integrations/pi/dist/index.js`.

```bash
npm run mod:uninstall
npm run codex:uninstall
npm run dsh:uninstall -- --profile web
```

These commands remove only plugins or hooks added by Habblaud. Disable the Pi extension by removing the `--extension` argument when starting Pi. `npm run docker:down` only stops the container.

Installations from older CodeTown versions now use `HABBLAUD_*` environment variables; `CODETOWN_*` variables no longer work. For data migration and replacing old plugins, see [Migrating from CodeTown (Portuguese)](README.pt-BR.md#vindo-do-codetown). Back up any screenshots, exports, or other files you saved in the old data directory before updating.

## Troubleshooting

**Agents are not visible:** Confirm that the real session has produced a message and that the target process loaded its plugin/extension. For Claude Code/Codex, check the account directories; for DSH, check the profile and `dsh:status`; for Pi, confirm `--extension` points to the built file. `GET /api/health` shows service status and enabled sources.

**Messaging/approvals are unavailable:** Check that the page is accessed through `127.0.0.1` or `localhost`, the server listens on loopback, and `HABBLAUD_TERMINAL` and `HABBLAUD_MENSAGENS` are enabled. Codex needs a runnable `codex` command; Claude Code needs its plugin; DSH/Pi need a running bridge. Pi approvals also require `HABBLAUD_PI_APPROVALS=1`.

**DSH or Pi history is empty:** DSH must read decoded history from the native session query; compressed files cannot be treated directly as JSONL. For Pi, confirm `PI_CODING_AGENT_DIR` / `HABBLAUD_PI_DIRS` points to agent directories and that the files are readable, real sessions from the last seven days. A disconnected native process does not keep an old session marked online.

**Port conflict or LAN access:** Change `HABBLAUD_PORT` and reconfigure the plugins. LAN pages retain read-only office status; allowed Host names do not re-enable sensitive operations.

For source-by-source checks and local bridge configuration, see [Connecting and troubleshooting the four agent runtimes (Chinese)](docs/zh-CN/接入与故障排查.md).

## Development

```bash
npm run dev
npm run typecheck
npm test
npm run build
```

The TypeScript server combines local file sources and native bridge events into an office snapshot; the client receives updates through SSE. Runtime adapters live in `integrations/dsh` and `integrations/pi`. Start with `GET /api/health` and `GET /api/snapshot` when inspecting a local instance.

| Documentation | Contents |
| --- | --- |
| [Integration and troubleshooting (Chinese)](docs/zh-CN/接入与故障排查.md) | Runtime setup and local bridge checks |
| [Server (Chinese)](server/README.md) | Sources, HTTP/SSE APIs, storage, and security |
| [Claude plugins (Chinese)](mod/README.md) | Usage, messaging, and permission plugins |
| [DSH (Chinese)](integrations/dsh/README.md) / [Pi (Chinese)](integrations/pi/README.md) | Native runtime adapters |
| [Assets and Chinese images (Chinese)](docs/zh-CN/素材与中文图片.md) | Pixel-art pipeline and screenshots |
| [Validation record (Chinese)](docs/zh-CN/验证记录.md) | Actual local integration and test scope |
| [Changelog](CHANGELOG.md) | Project changes |

## Credits and license

Habblaud was created by [marmottajr](https://github.com/marmottajr/habblaud). This repository adds Chinese localization and native DSH/Pi integrations while retaining the project's pixel-art office and Claude Code/Codex support. Distributed under the [MIT License](LICENSE).
