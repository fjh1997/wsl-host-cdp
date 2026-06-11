# WSL Host CDP

在 WSL 里连接 Windows 宿主机的 Edge / Chrome 浏览器 CDP 端口。

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

