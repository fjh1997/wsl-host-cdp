# WSL Host CDP Skill

Connect WSL to the Windows host Edge / Chrome browser through CDP, using `ncat` to bridge the host-only DevTools port into WSL.

在 WSL 里连接 Windows 宿主机的 Edge / Chrome 浏览器 CDP 端口的skill，通过 `ncat` 把只监听宿主机回环地址的 DevTools 端口桥接到 WSL。

## Overview / 简介

This skill is useful when:

- An agent running in WSL needs to inspect or control the Windows host browser instead of launching a separate Linux browser.
- Edge / Chrome DevTools is listening only on Windows `127.0.0.1`, so WSL cannot reach it directly.
- Browser login state, cookies, or already-open tabs from the host browser need to be reused inside WSL automation.
- `web-access`, a CDP proxy, or similar browser-discovery tooling fails because WSL cannot see the Windows browser debug port.

这个 skill 适合解决这类问题：

- WSL 里的 agent 需要操作宿主机浏览器，而不是启动一个新的 Linux 浏览器。
- 浏览器 DevTools 端口只监听 Windows `127.0.0.1`，WSL 直接访问不到。
- 需要把宿主机 Edge / Chrome 的登录态、Cookie、已打开页面复用给 WSL 内的自动化工具。
- `web-access`、CDP proxy 或类似工具因为找不到浏览器调试端口而失败。

## 原理

脚本使用 Windows 宿主机上的 `ncat.exe` 做转发：

```text
WSL 工具
  -> 127.0.0.1:59222
  -> WSL 本地转发进程
  -> Windows ncat.exe 127.0.0.1:<宿主机浏览器 DevTools 端口>
  -> Edge / Chrome CDP
```

浏览器的 DevTools 端口仍然只在 Windows `127.0.0.1` 上，不需要暴露到公网或局域网。

脚本还会在 WSL 里写入对应的 `DevToolsActivePort` 文件，让依赖 Chromium 自动发现逻辑的工具能像发现本地浏览器一样发现宿主机浏览器。

## 安装

**方式一：npx skills 一键安装（推荐）**

```bash
npx skills add fjh1997/wsl-host-cdp
```

如果想安装到用户级全局 skill 目录：

```bash
npx skills add fjh1997/wsl-host-cdp -g
```

如果只想安装到 Codex：

```bash
npx skills add fjh1997/wsl-host-cdp --agent codex
```

先查看仓库里有哪些 skill，不执行安装：

```bash
npx skills add fjh1997/wsl-host-cdp --list
```

> 当前仓库如果保持 private，安装环境需要有可访问该仓库的 GitHub 凭据。若希望任何人都能直接执行上面的命令安装，需要把仓库改为 public。

安装后重启 Codex / 对应 Agent，让新 skill 被重新加载。

**方式二：手动 clone**

```bash
git clone https://github.com/fjh1997/wsl-host-cdp.git ~/.codex/skills/wsl-host-cdp
```

然后重启 Codex。

## 前置条件

- WSL 里有 Node.js 22+。
- Windows 宿主机安装了 Nmap / Ncat，并能找到 `ncat.exe`。
- Windows 宿主机 Edge 或 Chrome 已启用远程调试：
  - Edge: 打开 `edge://inspect/#remote-debugging`，启用 `Allow remote debugging for this browser instance`
  - Chrome: 打开 `chrome://inspect/#remote-debugging`，启用 `Allow remote debugging for this browser instance`

## 快速开始

连接宿主机 Edge：

```bash
node scripts/connect-host-cdp.mjs --browser edge
```

连接宿主机 Chrome：

```bash
node scripts/connect-host-cdp.mjs --browser chrome
```

默认 WSL 本地端口是 `59222`。成功后会输出类似：

```text
OK: existing bridge works (52 targets).
browser: Microsoft Edge
WSL local: 127.0.0.1:59222
WSL DevToolsActivePort: ~/.config/microsoft-edge/DevToolsActivePort
```

## 保持连接后只测试

建立过桥接后，不需要每次都重新连接或点 Edge。直接运行：

```bash
node scripts/connect-host-cdp.mjs --browser edge --test-only
```

或：

```bash
node scripts/connect-host-cdp.mjs --browser edge --status
```

这个模式只读取 WSL 侧已有的 `DevToolsActivePort`，然后发送一次轻量的 `Target.getTargets` WebSocket 请求。它不会启动新转发，也不会改写宿主机浏览器状态。

## 常用参数

换一个 WSL 本地端口：

```bash
node scripts/connect-host-cdp.mjs --browser edge --local-port 59223
```

指定 Windows `ncat.exe` 路径：

```bash
node scripts/connect-host-cdp.mjs --browser edge --ncat '/mnt/c/Program Files (x86)/Nmap/ncat.exe'
```

手动指定宿主机 DevTools 端口和 WebSocket 路径：

```bash
node scripts/connect-host-cdp.mjs --browser edge --host-port 9222 --ws-path /devtools/browser/<uuid>
```

停止 WSL 转发进程：

```bash
pkill -f wsl-host-cdp-forward
```

## 与 web-access 配合

先运行：

```bash
node scripts/connect-host-cdp.mjs --browser edge
```

再让依赖 Chromium `DevToolsActivePort` 的工具检查浏览器。比如 `web-access`：

```bash
node /path/to/web-access/scripts/check-deps.mjs --browser edge
```

## 安全注意

- 不要把浏览器 DevTools 端口监听到 `0.0.0.0`。
- 不要把转发端口暴露到公网或局域网。
- `DevToolsActivePort` 里包含浏览器 WebSocket 路径，通常不应提交到仓库。
- 宿主机浏览器的登录态等同于你的账号权限，自动化操作前要确认目标站点风险。
