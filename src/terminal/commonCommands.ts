/** The `c` source: a bundled dictionary of common Unix command names,
 *  so the dropdown has something to offer before any history exists —
 *  the same trick WindTerm's built-in command list plays. Names only,
 *  no flags: flags belong to history, which knows how YOU use them. */
export const COMMON_COMMANDS: readonly string[] = [
  // shell & files
  "ls", "ll", "cd", "pwd", "cat", "less", "more", "head", "tail", "touch",
  "cp", "mv", "rm", "mkdir", "rmdir", "ln", "stat", "file", "tree", "basename",
  "dirname", "realpath", "readlink", "which", "whereis", "type", "alias",
  "echo", "printf", "history", "clear", "exit", "logout", "source", "export",
  "env", "set", "unset", "watch", "xargs", "tee", "yes", "sleep", "time",
  "nohup", "screen", "tmux", "bash", "sh", "zsh", "fish",
  // search & text
  "grep", "egrep", "fgrep", "rg", "find", "locate", "sed", "awk", "cut",
  "sort", "uniq", "wc", "tr", "diff", "comm", "column", "split", "jq",
  "strings", "od", "xxd", "hexdump", "base64", "md5sum", "sha256sum",
  // processes & system
  "ps", "top", "htop", "kill", "killall", "pkill", "pgrep", "jobs", "fg",
  "bg", "uptime", "free", "vmstat", "iostat", "sar", "lsof", "strace",
  "nice", "renice", "nproc", "uname", "hostname", "hostnamectl", "dmesg",
  "sysctl", "ulimit", "date", "timedatectl", "cal", "who", "whoami", "w",
  "last", "id", "groups", "shutdown", "reboot", "poweroff",
  // disks & filesystems
  "df", "du", "mount", "umount", "lsblk", "blkid", "fdisk", "parted",
  "mkfs", "fsck", "sync", "dd", "swapon", "swapoff", "ncdu",
  // permissions & users
  "chmod", "chown", "chgrp", "umask", "su", "sudo", "sudoedit", "visudo",
  "passwd", "useradd", "userdel", "usermod", "groupadd", "adduser", "chsh",
  // networking
  "ip", "ifconfig", "ping", "traceroute", "tracepath", "netstat", "ss",
  "curl", "wget", "nc", "ncat", "telnet", "dig", "nslookup", "host",
  "arp", "route", "iptables", "nft", "ufw", "firewall-cmd", "tcpdump",
  "ethtool", "nmcli", "iw", "iwconfig", "mtr",
  // remote & transfer
  "ssh", "ssh-keygen", "ssh-copy-id", "scp", "sftp", "rsync", "ftp",
  // packages
  "apt", "apt-get", "apt-cache", "dpkg", "yum", "dnf", "rpm", "snap",
  "pacman", "zypper", "apk", "brew", "pip", "pip3", "npm", "pnpm", "yarn",
  "npx", "cargo", "gem", "go", "mvn", "gradle", "composer",
  // archives
  "tar", "gzip", "gunzip", "zip", "unzip", "bzip2", "xz", "zstd", "7z",
  // editors & vcs
  "vi", "vim", "nvim", "nano", "emacs", "git", "svn",
  // services & containers
  "systemctl", "service", "journalctl", "crontab", "at", "docker",
  "docker-compose", "podman", "kubectl", "helm", "minikube", "k9s",
  "supervisorctl", "pm2",
  // languages & runtimes
  "python", "python3", "node", "deno", "java", "javac", "gcc", "g++",
  "make", "cmake", "rustc", "perl", "ruby", "php", "dotnet",
  // databases & misc daemons
  "mysql", "mysqldump", "psql", "pg_dump", "redis-cli", "mongo", "mongosh",
  "sqlite3", "influx", "nginx", "certbot",
];
