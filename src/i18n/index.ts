import { useSettingsStore } from "../state/settings";
import type { Settings } from "../types/settings";

export type Language = Settings["language"];

// English UI literals are the translation keys. Missing entries fall back
// to the key itself, so untranslated strings degrade to English rather
// than to a raw identifier.
const zh: Record<string, string> = {
  // Activity rail
  "Hosts": "主机",
  "Files": "文件",
  "Serial": "串口",
  "Settings": "设置",
  "Serial · coming soon": "串口 · 即将推出",

  // Drawer / host list
  "New connection": "新建连接",
  "Connect": "连接",
  "Disconnect": "断开连接",
  "Edit": "编辑",
  "Duplicate": "复制主机",
  "Delete": "删除",
  "Collapse": "收起",
  "host options": "主机选项",

  // Tab bar / + menu
  "New SSH connection": "新建 SSH 连接",
  "New SSH connection…": "新建 SSH 连接…",
  "New local terminal": "新建本地终端",
  "Quick connect": "快速连接",
  "Local terminal": "本地终端",
  "Saved hosts": "已保存主机",
  "Close tab": "关闭标签页",
  "Close others": "关闭其他",
  "Close all": "关闭全部",
  "to the left": "个左侧标签",
  "to the right": "个右侧标签",

  // Activity toolbar
  "Terminal": "终端",
  "Tunnels": "隧道",

  // Host form
  "New host": "新建主机",
  "Edit host": "编辑主机",
  "Basic": "基础",
  "Label": "名称",
  "Host": "主机地址",
  "Port": "端口",
  "Username": "用户名",
  "Password": "密码",
  "Key file": "密钥文件",
  "Passphrase": "密钥口令",
  "Key passphrase (optional)": "密钥口令（可留空）",
  "leave blank to keep current": "留空保持不变",
  "Forget stored passphrase": "忘掉已保存的密钥口令",
  "Required": "必填",
  "Port must be 1–65535": "端口需为 1–65535",
  "Forget stored password": "忘掉已保存的密码",
  "Remember password": "记住密码",
  "SSH login password": "SSH 登录密码",
  "Removes the saved password. You'll need to type it next connection.":
    "删除已保存的密码，下次连接需要重新输入。",
  "(Password storage unavailable on this system)": "（当前系统不支持密码存储）",
  "Browse…": "浏览…",
  "Deselect": "取消选择",
  "Filter…": "筛选…",
  "Save this host": "保存此主机",
  "Save": "保存",
  "Cancel": "取消",
  "Save & Connect": "保存并连接",
  "Saving…": "保存中…",
  "Connecting…": "连接中…",
  "auto-fills as user@host": "留空则自动使用 user@host",
  "Connection mode": "连接模式",
  "Terminal only": "仅终端",
  "Term + Tunnels": "终端 + 隧道",
  "Tunnels only": "仅隧道",
  "Port forwarding": "端口转发",
  "rules": "条规则",
  "rule": "条规则",

  // Tunnels
  "Add": "添加",
  "Add rule": "添加规则",
  "Local port": "本地端口",
  "Remote host": "远程主机",
  "Remote port": "远程端口",
  "LAN sharing": "局域网共享",
  "LAN sharing (0.0.0.0)": "局域网共享 (0.0.0.0)",
  "Bind to 0.0.0.0 — accessible from local network": "绑定 0.0.0.0 —— 局域网内其他设备可访问",
  "SSH command": "SSH 命令",
  "Copy": "复制",
  "Copied": "已复制",
  "Paste SSH command to import rules…": "粘贴 SSH 命令导入规则…",
  "No -L rules found": "未找到 -L 规则",
  "Active": "已开启",
  "Inactive": "未开启",
  "active": "已开启",
  "Confirm?": "确认?",
  "Click again to confirm delete": "再次点击确认删除",
  "Drag to reorder": "拖动排序",

  // Settings
  "Appearance": "外观",
  "Interface": "界面",
  "Family": "字体",
  "Size": "字号",
  "Cursor": "光标",
  "Preview": "预览",
  "Shell": "Shell",
  "Local terminal (tab)": "本地终端",
  "Changes apply live · saved to settings.json in your config directory":
    "修改实时生效 · 保存在配置目录的 settings.json",
  "Sans UI — tabs, buttons, section headers.": "界面无衬线字体 —— 标签页、按钮、栏目标题。",
  "Filename + meta text in the Files panes. Independent of System font.":
    "文件面板中的文件名与说明文字，独立于系统字体。",
  "Enter the full path to your shell executable.": "输入 shell 可执行文件的完整路径。",
  "Applies to all new local terminal tabs.": "对之后新开的本地终端标签页生效。",
  "Default (system shell)": "默认（系统 shell）",
  "Custom path…": "自定义路径…",
  "About": "关于",
  "Known hosts": "受信主机",
  "Advanced": "高级",
  "Language": "语言",
  "UI language": "界面语言",
  "Theme": "主题",
  "Warm Minimal": "暖色极简",
  "Warm Light": "暖色浅亮",
  "Density": "密度",
  "Compact": "紧凑",
  "Comfortable": "舒适",
  "Spacious": "宽松",
  "Block": "方块",
  "Underline": "下划线",
  "Bar": "竖线",
  "System default": "系统默认",
  "System font": "系统字体",
  "System font size": "系统字号",
  "Files font size": "文件列表字号",
  "Terminal font": "终端字体",
  "Terminal font size": "终端字号",
  "Cursor style": "光标样式",
  "Local shell": "本地 Shell",
  "Reset all settings to defaults?": "将所有设置恢复为默认值？",
  "Reset to defaults": "恢复默认",
  "Check for updates": "检查更新",
  "Checking…": "检查中…",
  "Up to date": "已是最新版本",
  "New version available": "发现新版本",
  "Download & restart": "下载并重启",
  "Downloading…": "下载中…",
  "Update check failed": "检查更新失败",
  "Retry": "重试",
  "Automatically check for updates": "自动检查更新",

  // Trusted servers panel
  "read-only view": "只读展示",
  "Loading…": "加载中…",
  "No entries": "暂无记录",
  "ShellX only appends to this file · to remove an entry, edit known_hosts directly":
    "ShellX 只追加、不修改此文件 · 删除条目请直接编辑 known_hosts",

  // Empty state
  "A tiny, pretty terminal client.": "小巧、精致的终端客户端。",
  "Pick a host from the sidebar,": "从侧边栏选择一台主机，",
  "or press": "或按",
  "to search.": "搜索。",
  "to open a saved host": "打开已保存的主机",

  // Shortcuts
  "Shortcuts": "快捷键",
  "Keyboard shortcuts": "键盘快捷键",
  "Shortcuts are fixed in this version — customization is planned.":
    "本版本快捷键为固定配置，自定义功能在计划中。",
  "New tab": "新建标签页",
  "Next tab": "下一个标签页",
  "Previous tab": "上一个标签页",
  "Command palette": "命令面板",
  "Toggle sidebar": "收起/展开侧栏",
  "Search in terminal": "终端内搜索",
  "On macOS, Cmd+T / Cmd+W also work for tabs.": "macOS 上标签页也可用 Cmd+T / Cmd+W。",
  "Search": "搜索",
  "Previous match": "上一个匹配",
  "Next match": "下一个匹配",

  // Host dropdown (Files view)
  "Pick a host": "选择主机",
  "No saved hosts yet": "暂无已保存主机",
  "connect": "连接",

  // Misc
  "Loading": "加载中",
  "Connecting": "连接中",
  "Close": "关闭",
  "OK": "确定",

  // Monitor
  "Monitor": "监控",
  "Performance": "性能",
  "Process": "进程",
  "Disk": "磁盘",
  "Refresh": "刷新",
  "Monitoring is not supported on this host (Linux only)":
    "此主机不支持监控（仅支持 Linux）",
  "Collecting data…": "正在采集数据…",
  "Monitor render error": "监控渲染错误",
  // Host info card
  "Hostname": "主机名",
  "System": "系统",
  "Kernel": "内核",
  "Boot": "启动",
  "Virtualization": "虚拟化",
  "Bare metal": "裸机",
  "Architecture": "架构",
  "Uptime": "运行时长",
  "d": "天",
  "h": "小时",
  "m": "分",
  // Performance / disk tabs
  "Memory": "内存",
  "Network": "网络",
  "Used": "已用",
  "of": "共",
  "Received": "接收",
  "Sent": "发送",
  "cores": "核",
  "Mount points": "挂载点",
  "Disk I/O": "磁盘 I/O",
  "Read": "读取",
  "Write": "写入",
  "CPU usage (overall)": "CPU 使用率（总览）",
  "Memory usage": "内存使用",
  "Per-core usage": "每核心使用率",
  "Expand": "展开",
  "cores · avg": "核心 · 均",
  "interfaces": "个接口",
  "Down": "下行",
  "Up": "上行",
  "avg": "均",
  "processes · sorted by CPU": "个进程 · 按 CPU 排序",
  "Partitions": "分区使用",
  "mount points": "个挂载点",
  "Healthy": "正常",
  "Warning": "警告",
  "Critical": "危险",
};

export function translate(lang: Language, key: string): string {
  return lang === "zh" ? (zh[key] ?? key) : key;
}

/** Returns a `t()` translator bound to the current UI language. */
export function useT(): (key: string) => string {
  const lang = useSettingsStore((s) => s.language);
  return (key) => translate(lang, key);
}
