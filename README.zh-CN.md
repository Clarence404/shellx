# shellx

[English](./README.md) · **简体中文**

一个小巧、精致、可扩展的终端 + 文件传输客户端。跨平台（Windows / macOS / Linux），开源，基于 Tauri + Rust + React。

## 版本状态：v0.5.5

v0.5.5 是一轮打磨 + 稳健性：Files 视图断线时给出正经的 `DisconnectedPanel`
（含用 keychain 凭据一键 Reconnect）、终端配色改成鼠尾草绿让 `ls` 的
other-writable 目录着色终于清晰可读、删除 host 会级联清理相关的 tab 和面板、
Hosts 抽屉空态自动隐藏、`New SSH connection` 表单标签不再淡到看不清、
面包屑 `C:` 芯片点击终于能落到盘根。下面这些仍然生效：

v0.5.4 拓宽了左侧功能列（图标 + 文字上下排列），tab 条的空白区也变成了窗口拖拽面。

v0.5.3 打磨的 **Settings / Appearance** 面板和自绘标题栏：

- **系统字体大小**滑块（11–16 px）——同时缩放所有 sans UI 元素（标签页、侧栏行、主机列表、右键菜单、按钮、
  Terminal | Files 切换）。Terminal 字号保持独立。
- **系统字体族**选择——System default、Segoe UI、PingFang SC、Microsoft YaHei。
- **主题**：**Warm Minimal** + **Warm Light**（Ocean / Forest 已下线；旧 `settings.json` 里的旧主题会
  自动迁移回默认）。
- **密度**：Compact / Comfortable / Spacious——控制列表行内边距和 mono 内容字号。
- **Terminal**：字体（JetBrains Mono、SF Mono、Fira Code、Cascadia Code、Consolas）、字号（10–20 px）、
  光标样式（block / underline / bar）。xterm 直接热重配，不用重挂 tab。
- **标签栏溢出控件**——当 tabs 超出标题栏宽度时，右端出现紧凑的 `‹ › ≡` 组合（chevron 滚动、列表图标打开
  含逐项关闭的下拉）。tab 条支持滚轮横向滚动。任意 tab 右键：`Close N to the left` / `Close N to the right`
  / `Close all`。

Settings 落盘到应用 config 目录的 JSON 文件（Rust 侧防抖自动保存），下次启动自动还原。

也保留了 v0.4.3 的**自绘标题栏**：tabs 直接嵌在标题栏里，附带 logo 和原生风格的窗口控件，三端替代了 OS 默认标题栏。

同样包含 v0.4 的全部特性：Rail Files（WinSCP 风格的本地 ↔ 远程双栏文件浏览器）、拖放传输、分隔条重置、抽屉折叠
（`Ctrl+Shift+B` / `Cmd+B`）；以及 v0.3 的全部特性：SFTP 与 SSH 复用同一 tab、Connection / ShellHandle /
SftpHandle 三层 trait、拖放上传、右键 CRUD、断开 tab 淡出、Ctrl+Shift+W/T 快捷键映射（Ctrl+W/T 让给
shell/tmux）、忘记密码 UI、HostRow 键盘可达性。

> **安全提示（v0.5）**：shellx 仍未校验 SSH host key——首次连接一律信任服务器。在不可信网络上不要用。Host-key
> TOFU + 公钥认证仍在 v0.6+ Backlog 里，见下文。

---

## 环境依赖

按顺序装一次：

| 工具          | 版本            | 安装                                                                                                                            |
| ------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Node.js**   | 20 LTS 或更新   | [nodejs.org](https://nodejs.org/) · `node --version` 验证                                                                          |
| **pnpm**      | 9.x 或更新      | `npm i -g pnpm` · `pnpm --version` 验证                                                                                            |
| **Rust**      | 1.77 或更新     | [rustup.rs](https://rustup.rs/) · Windows 上装 `stable-msvc` 工具链 · `cargo --version && rustc --version` 验证                     |
| **WebView2**  | 任意版本        | Windows 11 已预装；Windows 10 需要 [Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)（一次性）          |

平台注意：

- **Windows**：需要 Visual Studio Build Tools（C++ 工作负载）配合 Rust 的 `msvc` toolchain 链接原生 crate。rustup 首次运行通常帮你装好。
- **macOS**：Xcode Command Line Tools（`xcode-select --install`）。
- **Linux**：`libwebkit2gtk-4.1-dev`、`build-essential`、`curl`、`wget`、`file`、`libxdo-dev`、`libssl-dev`、`libayatana-appindicator3-dev`、`librsvg2-dev`（Debian/Ubuntu 包名）。

---

## 首次搭建

```bash
git clone <this-repo>
cd shellx
pnpm install       # 装前端依赖（React、Vite、xterm.js、Zustand 等）
```

第一次运行 `pnpm tauri:dev`（或 `pnpm tauri:build`）会额外下载并编译全部 Rust 依赖——首次编译需要 5–15 分钟（网速正常时），生成约 2 GB 的 `src-tauri/target/`。后续增量构建以秒计。

**国内网络（或 crates.io 镜像慢）**：仓库自带的 `src-tauri/.cargo/config.toml` 已指向 `rsproxy.cn`，无需额外配置。

---

## 开发工作流

### 开发模式跑起来（热重载）

```bash
pnpm tauri:dev
```

- Vite 开发服务器在 1420 端口（前端改动自动重载）。
- 编译 `src-tauri/` 并启动原生窗口（Rust 改动自动重启）。
- 关窗口即干净退出。

### 键盘快捷键

| 动作                | Windows / Linux                | macOS                          |
| ------------------- | ------------------------------ | ------------------------------ |
| 新建 tab            | `Ctrl+Shift+T`                  | `Cmd+T`                        |
| 关闭 tab            | `Ctrl+Shift+W`                  | `Cmd+W`                        |
| 上/下一个 tab       | `Ctrl+Tab` / `Ctrl+Shift+Tab`  | `Ctrl+Tab` / `Ctrl+Shift+Tab`  |
| 命令面板            | `Ctrl+K`                        | `Cmd+K`                        |
| 切换侧栏 (drawer)   | `Ctrl+Shift+B`                  | `Cmd+B`                        |

Windows/Linux 上新建/关闭 tab 强制加 Shift（v0.3），避免和终端里 `Ctrl+T`/`Ctrl+W` 的 shell/tmux 习惯冲突；tab 切换不受影响。

### 前端类型检查

```bash
pnpm tsc --noEmit
```

秒级（<5 s），提交 UI 改动前跑一下。

### 只编译不启动

```bash
pnpm build
```

产出 `dist/`（Tauri 打包时用到的目录）。手动运行的机会不多。

### 只做 Rust 类型检查（不完整构建）

```bash
cd src-tauri && cargo check --lib && cargo check --bin shellx
```

---

## 发布构建

```bash
pnpm tauri:build
```

产出各平台安装包到 `src-tauri/target/release/bundle/`：

- **Windows**：`bundle/msi/shellx_<version>_x64_en-US.msi` 和 `bundle/nsis/shellx_<version>_x64-setup.exe`
- **macOS**：`bundle/dmg/shellx_<version>_universal.dmg`
- **Linux**：`bundle/appimage/shellx_<version>_amd64.AppImage`、`bundle/deb/shellx_<version>_amd64.deb`、`bundle/rpm/shellx-<version>-1.x86_64.rpm`

Release 构建开启 LTO，比 dev 慢（Windows 上 5–15 分钟）。

---

## 测试

```bash
# Rust 单元测试
cd src-tauri && cargo test --lib

# Rust 端到端集成测试（进程内 SSH/SFTP 服务器 fixture）
cd src-tauri && cargo test --features test-fixtures --test ssh_integration
cd src-tauri && cargo test --features test-fixtures --test sftp_integration

# 前端测试（Vitest + jsdom + Testing Library）
pnpm test -- --run
```

Rust 集成测试无需 Docker 或外部 SSH——测试内部拉起进程内 russh（和 russh-sftp）服务器。fixture 在 `src-tauri/src/protocol/ssh.rs::testing::start_echo_ssh_server`。

### 拿真机跑

任何 SSH server 都能连。想快速起一个：

```bash
docker run --rm -p 2222:22 -e USER_PASSWORD=test linuxserver/openssh-server:latest
```

然后应用里：**＋ New connection**，`Host: 127.0.0.1`、`Port: 2222`、`Username: linuxserver.io`、`Password: test`（真实凭证看容器日志）。

---

## 目录结构

```
shellx/
├── src/                            # React + TypeScript 前端
│   ├── App.tsx                     # 根——组装 AppShell + ConnectDialog + store
│   ├── main.tsx                    # Vite 入口（导入设计 token）
│   ├── styles/                     # Warm Minimal CSS token + reset
│   ├── components/                 # UI：AppShell、ActivityRail、Drawer、TabBar、
│   │                               #     TerminalView、ConnectDialog、EmptyState
│   ├── ipc/                        # 类型化封装 Tauri invoke() / listen()
│   ├── state/                      # Zustand store（会话列表、活动 id）
│   └── types/                      # 共享 TS 类型
│
├── src-tauri/                      # Rust 后端
│   ├── src/
│   │   ├── main.rs                 # Tauri 应用入口（注册命令、持有状态）
│   │   ├── lib.rs                  # 模块根
│   │   ├── transport/              # 字节流层（Transport trait、TcpTransport）
│   │   ├── protocol/               # 应用协议层（SshProtocol via russh）
│   │   ├── session/                # SessionManager（拥有活跃会话、driver_loop）
│   │   ├── ipc/                    # #[tauri::command] handler + event 负载
│   │   └── error.rs                # Result<T> 与 Error 枚举（Serialize 给 JS）
│   ├── tests/ssh_integration.rs    # 端到端测试（穿透 SessionManager）
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── .cargo/config.toml          # rsproxy.cn 镜像配置
│
├── docs/superpowers/
│   ├── specs/                      # 设计规格（v0.1 → v1.0 roadmap）
│   └── plans/                      # 各里程碑实现计划
│
├── docs/release-notes/             # 每个 tag 一份 Markdown，CI 自动填进 GitHub Release
│
└── .superpowers/sdd/               # SDD 台账 + 每任务 brief/report
    (已 .gitignore)                 # 单次运行草稿，删也行
```

### 三层架构

Rust 侧拆成三层，每层都可以独立测试：

- **Transport**（`transport::Transport` trait）——只处理字节。当前只有 `TcpTransport`；未来的 `SerialTransport`（RS-232 / RS-485）、`UsbCdcTransport`、`WsTransport` 都在这层插拔，不动上层。
- **Protocol**（`protocol::Connection` trait，由 `SshConnection` 实现；一个 connection 打开 `ShellHandle` / `SftpHandle` 子通道）——把字节变成语义操作（认证、通道、PTY/resize、SFTP CRUD + 传输）。trait 边界预留了 FTP/FTPS 的插入点（v0.5），无需触碰 `SessionManager`。
- **SessionManager**（`session::manager::SessionManager`）——按 UUID 持有活跃会话；每个会话一个 tokio 任务，泵送读写和订阅转发。通过 Tauri IPC 命令 + 事件（`session:data`、`session:closed`）暴露给前端。

新增一个物理通道（例如 RS-485）= 写一个 `Transport` 实现。新增一个应用协议（例如 Modbus、MQTT）= 写一个 session 类型接入 `SessionManager`。新增一个 UI 视图（例如 Modbus 寄存器表）= 写一个 React 组件 + 一条命令派发。见 spec §5 的扩展时间线。

---

## 体积（v0.5）

Windows 11（MSVC toolchain）上 `pnpm tauri:build` 出的 release 构建：

- Windows MSI：7.2 MB（`shellx_0.5.0_x64_en-US.msi`）
- Windows NSIS setup：4.5 MB（`shellx_0.5.0_x64-setup.exe`）
- macOS DMG：这轮没测（暂无 macOS 构建机）
- Linux AppImage：这轮没测（暂无 Linux 构建机）

两种 Windows 安装包都远低于 15 MB 目标（spec §7）。v0.4 → v0.5 增长约 0.4 MB——比两个新加的 `@fontsource` 包本身的 CSS 略大，因为每个包针对 400 字重的每个 Unicode 子集都带一个 woff2 文件，不只是被 import 的 `400.css` 入口。仍在预算内。

---

## 排障

**`error: Missing manifest in toolchain 'stable-x86_64-pc-windows-msvc'`** 或 `cargo` 有但 `rustc` 没有——toolchain 装到一半被打断（Windows Defender 常干这事）：

```bash
rustup toolchain uninstall stable
rustup toolchain install stable --profile minimal --force
rustup component add cargo rust-std      # 补齐可能被漏掉的组件
cargo --version && rustc --version        # 都要能输出
```

如果下载中出现 `os error 2` 的文件改名错误，是 Defender 和 rustup 在赛跑；先 `export RUSTUP_DIST_SERVER=https://rsproxy.cn` 和 `RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup` 再重试（快镜像缩短窗口）。

**`warning: output filename collision at ... shellx.pdb`**——无害。`[lib]` 和 `[[bin]]` 共享 crate 名 `shellx`；Windows 上仅调试信息文件名冲突。构建照样通过，二进制照跑。见 [rust-lang/cargo#6313](https://github.com/rust-lang/cargo/issues/6313)。

**编译通过但启动时 `SetLoggerError` panic**——`be85531` 已修复。如果加了新的 logger 初始化后又复现，请记住 `tauri_plugin_log` 已占据全局 logger 槽位；不要同时叫 `tracing_subscriber::init()`。

**前端测试打印 xterm.js 的 jsdom canvas 报错**——是噪音不是失败。`jsdom` 没完整实现 `<canvas>`；xterm.js 往 stderr 抛栈但测试仍然通过（`52 passed`）。

**Windows Defender 标记构建产物**——未签名二进制。代码签名是 v1.0 议题；先右键 → 属性 → **解除锁定**如果你要分发。

---

## 贡献 / 下一步

大致按照 spec roadmap 顺序：

- **v0.4** ✓ ——Rail Files（本地 ↔ 远程双栏浏览器），新建连接自动作为 remote host，8 个本地 IPC 命令。
- **v0.5** ✓ ——Settings / Appearance 面板（主题 + 密度 + 终端字体/字号/光标，即时应用，JSON 落盘）、自绘标题栏（v0.4.3）。

### v0.6+ Backlog

- **Settings：Advanced 页** ——快捷键映射、log 级别、遥测开关。
- **重新审视紫色 accent** ——`#7c5cff` 用在 rail 图标和高亮态时略显刺眼；探索更柔和的 accent 变体（仍保持品牌调性），或把 accent 色相开放到 Settings 里给用户自选。
- **Files 面板内容字号** ——目前由 density 的 `--font-body` 控制；在 Appearance → Files 里加一条独立的 Files 字号滑块（对标 Terminal font size），让远端/本地文件浏览的字号能独立调整。
- **PaneSplitter 最小宽度保护** ——Files 视图的分栏可以拖到基本不可用的窄度；加最小宽度约束（比如每边 200 px），松手时软吸附回位。
- **安全相关规划** ——除已列的 host-key TOFU + 公钥认证外：审计远端返回字符串（尤其路径）的输入清洗、复核 keychain fallback 模式、落一份成文的威胁模型文档。
- **Protocols 页面设计** ——目前是 `coming soon` 占位；v0.7 之前定型（列已注册的传输/协议实现？每协议激活开关？各会话协议层的实时健康度？）。
- **Host-key TOFU + known_hosts 持久化** ——SSH host key 首次信任；指纹落 `~/.ssh/known_hosts`。
- **公钥认证** ——RSA / Ed25519 密钥对 + 系统 keychain 存 passphrase。
- **安装包签名** ——Windows Authenticode + macOS 公证。
- **拖放单行传输** ——拖一行文件时只传那一行，不是当前选区全体。
- **Cargo.toml authors 字段** ——把 `authors = ["you"]` 占位符换成真实维护者。
- **隐藏文件过滤** ——本地/远程双栏切换显示 dotfile。
- **上传冲突对话框** ——覆盖远端已有文件时提示。
- **v0.7+** ——传统 FTP / FTPS、跨平台签名 CI。
- **未来** ——RS-232 / RS-485 传输、Modbus RTU/TCP 协议、寄存器表视图（spec §4 说明各层落点）。

`docs/superpowers/` 下的设计规格和实现计划是各里程碑的 source of truth；`.superpowers/sdd/` 下的 SDD 台账是构建过程的复盘。

---

## 许可

MIT——见 [`LICENSE`](LICENSE)。
