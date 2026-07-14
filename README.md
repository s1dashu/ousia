# Pi

Pi 是一个独立的 Tauri 桌面客户端：完整复用 Ousia 的 UI/UX，但不再随应用内置 Node.js 或 Agent SDK。应用直接连接用户电脑上已有的 Pi agent runtime，因此继续使用用户自己的 Pi 配置、凭据、模型和会话目录。

Pi 从 `v0.2.0` 起接替原 Ousia Electron 桌面应用，并保留原仓库的 issue、release、tag 和 Git 历史。Electron 最终状态永久保存在 `codex/archive-ousia-electron-v0.1.32` 分支；当前 `main` 只维护 Pi。

[下载最新的 macOS 版本](https://github.com/s1dashu/ousia/releases/latest)

## 当前实现

- 原样保留 Ousia 的界面、主题、交互和设置体验。
- 使用 Tauri 2 / Rust 取代 Electron 主进程与 preload。
- 通过 `pi --mode rpc` 的 JSONL RPC 协议连接本机 Pi。
- 支持聊天流式事件、工具调用、历史记录、上下文用量、打断、排队消息、压缩、分支、移动、导出、模型发现和重试设置。
- 直接读取本机 Pi 的 `~/.pi/agent/settings.json`、`auth.json` 与登录 shell 环境；界面只展示配置来源，不复制或改写 API Key。
- 用户可以选择已有的 Pi，或让应用在自己的数据目录安装/移除一份 Pi；两种方式都复用同一份用户配置。
- 可以显式添加/移除由应用管理的 shell `PATH` 项，所有改动都有所有权记录并在移除前严格校验。
- 只支持 Pi，不包含 Agent Harness 切换或 Codex 相关实现。
- 结构化记录 Rust host、Pi 子进程、RPC 和前端未处理错误，错误不会被静默吞掉。

## 运行要求

连接已有 Pi 不要求 Node.js：可以从登录 shell `PATH`、常见安装位置和当前 npm 全局目录发现 Pi，也可以在设置中选择具体的可执行文件。

如果本机没有 Pi，设置页可以使用用户现有的 Node.js/npm，把 `@earendil-works/pi-coding-agent` 安装到应用自己的数据目录。它不会进入 `.app`，不会改系统 npm prefix，卸载时也绝不会删除 `~/.pi`。只有执行这项可选安装时才要求 Node.js/npm。

“添加到 Shell PATH”会创建应用自己拥有的 `~/.local/bin/pi` 链接，并向 zsh 的 `~/.zprofile` 或 bash 的 `~/.bash_profile` 写入带边界标记的块。移除时只删除与所有权记录完全一致的内容；发现文件被用户修改或归属不明确时会直接报错。

开发环境还需要：

- Node.js 与 npm
- Rust toolchain
- macOS 的 Tauri/WebKit 系统依赖

## 开发

```sh
npm ci
npm run desktop:dev
```

如果开发机上的 Pi 不在登录 shell `PATH`，可以显式传入可执行文件路径：

```sh
PI_GUI_PI_PATH=/absolute/path/to/pi npm run desktop:dev
```

这个变量只用于开发和诊断。路径无效时应用会明确报错，不会回退到内置运行时。

## 验证与打包

```sh
npm run check
npm run build
npm run desktop:build -- --bundles app
```

macOS `.app` 输出到：

```text
src-tauri/target/release/bundle/macos/Pi.app
```

当前 release `.app` 的文件内容实测约 15.2 MiB；包内不含 Node.js 和 Pi。可选的应用托管 Pi 位于应用数据目录，不计入 `.app`。空闲首屏实测常驻内存约 105 MiB，具体值会随 WebKit 与页面状态变化。

## macOS 发布

正式发布必须使用 Developer ID 签名并通过 Apple 公证。发布脚本会在凭据缺失、签名身份不存在、公证失败、票据未 stapled 或 Gatekeeper 校验失败时立即退出：

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
npm run release:mac
```

脚本在 `src-tauri/target/release/bundle/dmg/` 生成经过验证的 arm64 DMG、包含同一已公证应用的 ZIP，以及 SHA-256 校验文件。GitHub Release 只应发布这三个文件。

## 目录与数据

- `src/`：Ousia UI 与最小 Tauri 适配层。
- `src-tauri/`：Rust host、Pi RPC、状态持久化与结构化日志。
- 面向用户的产品名是 `Pi`；内部继续使用 `pi-gui` 标识以兼容既有应用数据与托管运行时所有权记录。
- `~/Library/Application Support/com.sidasoftware.pi-gui/`：macOS 上的应用状态、会话映射、`pi-runtime.json` 所有权记录，以及可选的 `pi-runtime/npm/` 托管安装。
- `~/Library/Logs/com.sidasoftware.pi-gui/pi-gui.log`：macOS 上的 JSONL 运行日志。
- Pi 自身的配置和会话仍由用户安装的 Pi 管理，应用不创建第二份配置源。

## 产品边界

- GitHub Release 中的 macOS 构建使用 Developer ID 签名并通过 Apple 公证；本地普通 `desktop:build` 不等同于正式发布构建。
- 自动更新当前明确禁用，升级通过 GitHub Release 手动完成。
- Pi RPC 协议不兼容、未知事件、损坏的 JSONL 或失效的会话映射会直接失败并写入日志；这是有意的 fail-fast 行为。
- Pi 0.80+ 以 `agent_settled` 作为一次完整会话运行的结束事件；`agent_end` 只表示底层单次运行结束。对未发送 `agent_settled` 的旧版本仅保留有日志的兼容完成路径。
- 日志分别记录 Pi 进程就绪、RPC 配置、会话预热、模型首字输出和完整运行耗时。进入会话后会在用户输入期间后台预热 Pi；首条消息被主会话接受后，会立即用隔离的临时 RPC 进程并行生成标题，不复用或重配活动会话。
- UI 的来源与许可证信息见 [NOTICE](./NOTICE)。工程约束与架构单一事实源见 [AGENTS.md](./AGENTS.md)。
