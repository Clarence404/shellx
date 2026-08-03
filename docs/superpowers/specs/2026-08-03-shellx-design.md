# shellx 设计文档

**日期**：2026-08-03
**状态**：Draft — 待用户确认
**作者**：Chen Han
**许可证**：MIT

## 1. 概述

**shellx** 是一款跨平台、开源、体积小的多协议客户端工具，面向"想要一个好看、简单、够用"的开发者和运维用户。定位介于 Termius / MobaXterm / FinalShell 与命令行工具之间——UI 更克制、体积更小、扩展性更强。

**一句话定位**：*A tiny, pretty, extensible terminal + file-transfer client. Open source, keeps growing.*

## 2. MVP 范围

MVP 只做三种会话，聚焦"最常用的开发者场景"：

| 会话类型 | 说明 | 视图 |
|---|---|---|
| **SSH** | 远程终端登录，支持密码 + 公钥 | TerminalView（xterm.js） |
| **SFTP** | 与 SSH 共用会话，文件浏览与传输 | FileBrowserView（双栏 + 队列） |
| **FTP / FTPS** | 独立传统 FTP（RFC 959）+ 显式 TLS | FileBrowserView |

**明确不做（MVP 之外）**：
- Serial（RS-232 / RS-485）— 架构预留，见 §5
- Modbus RTU / TCP — 架构预留，见 §5
- Telnet — 架构预留（复用 TCP + 新 Protocol impl）
- 会话录制、跳板机链、Shell 剧本、AI 命令补全等高级功能

## 3. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 桌面框架 | **Tauri 2** | 5–15MB 安装包，系统 WebView，不打包 Chromium |
| 前端 | React + TypeScript + Vite | 生态最广，xterm.js 无缝接入 |
| 终端渲染 | **xterm.js** | 生产级 VT100 仿真，VS Code / Warp 都用它 |
| UI 组件 | 自己写 + Radix UI primitives | 保证暖色紫的视觉一致；避免引入重量级组件库 |
| 状态管理 | Zustand | 轻量，适配 Tauri 的双端事件模型 |
| 后端 | **Rust**（Tauri sidecar） | 协议库最全，trait 抽象干净 |
| SSH | `russh` | Pure Rust，async 友好，比 libssh2 依赖少 |
| SFTP | `russh-sftp` | 与 russh 同栈 |
| FTP | `suppaftp` | 支持 FTPS（显式 TLS） |
| Serial（未来） | `serialport-rs` | 跨平台，RS-232/485 同一套 OS API |
| 加密 | `aes-gcm` + `argon2` | 主密码模式下的凭据加密 |
| 密钥环 | `keyring` | Win Credential Manager / macOS Keychain / Linux SecretService |
| 本地存储 | `rusqlite`（bundled） | 单文件 DB，跨平台无依赖 |

**打包体积目标**：Windows / macOS / Linux 三平台安装包均 < 15 MB。

## 4. 分层架构

三层严格分离，每层通过 trait / 接口交互，可独立测试和替换。

### 4.1 Transport 层（物理/链路 · Rust trait）

```rust
#[async_trait]
pub trait Transport: AsyncRead + AsyncWrite + Send + Unpin {
    fn kind(&self) -> TransportKind;
    async fn close(&mut self) -> Result<()>;
}
```

**只负责收发字节，不理解协议**。

- **MVP**：`TcpTransport`（tokio::net::TcpStream 包装）
- **未来**：`SerialTransport`（RS-232 / RS-485）、`UsbCdcTransport`、`WsTransport`

### 4.2 Protocol 层（应用协议 · Rust trait）

```rust
#[async_trait]
pub trait Protocol: Send {
    type Session: ProtocolSession;
    async fn connect(&self, transport: Box<dyn Transport>, auth: AuthConfig) -> Result<Self::Session>;
}
```

**把字节流解释为会话语义**（认证、命令、文件、寄存器）。

- **MVP**：`SshProtocol`、`SftpProtocol`（依附 Ssh 会话）、`FtpProtocol`（FTPS 可选）
- **未来**：`TelnetProtocol`（TCP + option negotiation）、`ModbusProtocol`（RTU/TCP 变体）、`RawProtocol`（透传，用于串口 debug）

### 4.3 SessionView 层（UI 视图 · TypeScript / React）

每个 Session 类型注册一个 View 组件。前后端通过 Tauri IPC 通信，事件驱动。

- **MVP**：`TerminalView`（xterm.js）、`FileBrowserView`（双栏 + 拖拽队列）
- **未来**：`RegisterTableView`（Modbus）、`SerialMonitorView`（HEX/文本切换、时间戳、波形）

### 4.4 会话装配（Session Assembly）

会话是 **(Transport × Protocol × View)** 的组合：

| 会话类型 | Transport | Protocol | View |
|---|---|---|---|
| SSH | TcpTransport | SshProtocol | TerminalView |
| SFTP | TcpTransport | SftpProtocol (借 SSH 通道) | FileBrowserView |
| FTP/FTPS | TcpTransport | FtpProtocol | FileBrowserView |
| **Serial 透传（未来）** | SerialTransport | RawProtocol | SerialMonitorView |
| **Modbus RTU（未来）** | SerialTransport | ModbusProtocol | RegisterTableView |
| **Modbus TCP（未来）** | TcpTransport | ModbusProtocol | RegisterTableView |
| **Telnet（未来）** | TcpTransport | TelnetProtocol | TerminalView |

**扩展成本**（大致工作量估算）：

- 加 Telnet：只加 Protocol，复用现有 Transport + View — **< 1 天**
- 加 RS-485 透传：只加 Transport（SerialTransport），复用 RawProtocol + TerminalView 加 HEX 开关 — **2–3 天**
- 加 Modbus RTU：加 Protocol，复用 SerialTransport，新加 View — **1 周量级**

## 5. UI 结构与视觉方向

### 5.1 布局（Layout B）

```
┌─────────────────────────────────────────────────────┐
│ [活动栏]  [抽屉]                       [标签栏]      │
│  32px      220px                       auto         │
│   🖥      HOSTS                     ┌──────┬──┐    │
│   📁      • prod-1        ★        │ tab1 │+ │    │
│   🔌       db-master               ├──────┴──┴────┤
│   ⚙        stage-web               │              │
│                                    │  会话主视图   │
│           FTP                      │  (Terminal   │
│            acme-ftp                │   or Files)  │
│                                    └──────────────┘
└─────────────────────────────────────────────────────┘
```

- **活动栏**（左 32px）：视图切换（Hosts / Files / Protocols / Settings），未来加协议就是加一个图标
- **抽屉**（可折叠 220px）：当前视图的上下文导航
- **标签栏**：多会话切换，支持右键关闭 / 拖拽重排
- **主区**：Session View 渲染区

### 5.2 视觉：Warm Minimal

- **背景色**：`#16151a`（近黑暖调）
- **面板色**：`#1a181f` / `#1e1c24`
- **主强调色**：`#7c5cff`（柔和紫）
- **文本主**：`#d4d0dc` · **文本次**：`#8b869a` · **文本弱**：`#6b6874`
- **边框**：`#26242c`
- **状态色**：Success `#a6e3a1` · Warn `#f2c8a2` · Error `#f28779`
- **字体**：UI 用系统字体栈；终端用 `SF Mono` / `JetBrains Mono` / Consolas

**Light 模式**：v0.1 不做，v0.2 加。CSS 变量结构预留切换能力。

### 5.3 关键交互

- **⌘K / Ctrl+K**：命令面板（快速连接、切换 tab、执行动作）
- **⌘T / Ctrl+T**：新建 tab
- **⌘W / Ctrl+W**：关闭 tab
- **⌘, / Ctrl+,**：设置

## 6. 数据存储与凭据管理

### 6.1 存储位置

跨平台标准配置目录（通过 `directories` crate）：

- Windows：`%APPDATA%\shellx\`
- macOS：`~/Library/Application Support/shellx/`
- Linux：`~/.config/shellx/`

### 6.2 数据文件

| 文件 | 内容 | 加密 |
|---|---|---|
| `hosts.db` (SQLite) | 会话定义（名称、地址、端口、用户名、备注等非机密字段） | 明文 |
| 凭据（密码 / 私钥 / passphrase） | 见下方双轨设计 | 加密 |
| `settings.toml` | UI 偏好、快捷键、主题 | 明文 |
| `logs/` | 运行日志（不含凭据） | 明文 |

### 6.3 凭据存储（双轨 · Q1=③）

用户在设置里可选：

1. **默认：OS Keychain 集成** — 每条凭据存到系统密钥环，`keyring` crate 抽象平台差异
2. **主密码模式** — 一个主密码派生密钥（Argon2id），加密所有凭据到 `credentials.enc`（AES-256-GCM）
3. **不保存** — 每次连接询问

**降级策略**：Linux 上 keyring 不可用（无 SecretService）时自动提示切换到主密码模式。

## 7. 目标平台与分发

| 平台 | 最低版本 | 分发方式 |
|---|---|---|
| Windows | 10 (1809+) | MSI installer + 独立 exe（GitHub Releases） |
| macOS | 11 Big Sur | .dmg (universal2: x86_64 + aarch64) |
| Linux | Ubuntu 22.04 / Fedora 38+ | AppImage + .deb + .rpm |

**CI**：GitHub Actions 三平台 matrix 构建 + 签名（Windows 用 Azure Trusted Signing 或社区签名方案；macOS 需 Apple Developer 证书，先不签也可）。

## 8. 测试策略

- **Rust 单元测试**：Transport / Protocol 每个 impl 都有 mock 场景测试
- **Rust 集成测试**：起真实 SSH / FTP server 容器跑连接端到端测试
- **前端组件测试**：Vitest + Testing Library
- **端到端**：Playwright 驱动打包后的应用（少量关键路径）
- **手动**：三平台每次发版前手工验一次连接矩阵

## 9. 里程碑

| 版本 | 交付 |
|---|---|
| v0.1.0 | SSH 单会话可连、terminal 可用 |
| v0.2.0 | 多 tab、连接管理器、Warm Minimal 完整视觉 |
| v0.3.0 | SFTP（借 SSH 通道） |
| v0.4.0 | FTP / FTPS |
| v0.5.0 | 凭据双轨、命令面板、Light 主题 |
| v1.0.0 | 三平台签名分发、基础文档、开源发布 |

## 10. 非目标（Out of Scope）

- 不做浏览器版
- 不做移动端
- 不集成 AI（v1 阶段）
- 不做团队协作 / 云同步（长期也非核心）
- 不做 GUI 内嵌 shell 脚本编辑器

## 11. 待决事项 / Open Questions

1. **项目名可用性核查** — "shellx" 需要在 crates.io、npm、GitHub 上确认无冲突或近似名。若冲突，备选：`shx`、`shellxlite`、`xshell`（这个已被占用）等。
2. **图标 / logo 方向** — v1.0 前需要一个能用的应用图标（自绘或委托）。
3. **签名成本** — Windows 代码签名证书（EV 每年 $300+）、macOS Apple Developer（$99/年）— 是否愿意投入决定发布形态。
4. **Linux keyring 降级 UX** — 首次启动检测到无 SecretService 时，是弹主密码设置向导还是先允许"不保存"用完？倾向前者，但需确认。

---

**下一步**：待用户 review 本文档 → 进入 `writing-plans` 生成分阶段实施计划。
