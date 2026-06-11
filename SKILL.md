---
name: wsl-host-cdp
description: Connect a WSL environment to a Windows host Chromium browser through Chrome DevTools Protocol. Use when Codex needs to drive or inspect the user's host Microsoft Edge or Google Chrome from WSL, bridge a host DevToolsActivePort into WSL, set up ncat-based forwarding, write the WSL DevToolsActivePort file, or repair CDP proxy/browser-discovery failures caused by WSL not seeing the Windows browser debug port.
---

# WSL Host CDP

## Workflow

Use `scripts/connect-host-cdp.mjs` to bridge the Windows host browser into WSL.

```bash
node /path/to/wsl-host-cdp/scripts/connect-host-cdp.mjs --browser edge
node /path/to/wsl-host-cdp/scripts/connect-host-cdp.mjs --browser chrome
```

The script:

1. Finds the Windows browser `DevToolsActivePort` file.
2. Reads the host debug port and WebSocket browser path.
3. Starts a detached WSL loopback forwarder on `127.0.0.1:<local-port>`.
4. Uses `ncat` forwarding: for each WSL-side incoming connection, spawns Windows `ncat.exe 127.0.0.1 <host-port>` so the TCP connection is opened from the Windows host into the host browser's loopback-only DevTools port.
5. Writes the matching WSL-side `DevToolsActivePort` file.
6. Validates `Target.getTargets` over WebSocket.

Default WSL local port: `59222`.

For repeated checks after the bridge is already established, use test-only mode. This keeps the existing `ncat` forwarder and browser connection in place and only sends a lightweight `Target.getTargets` WebSocket request:

```bash
node scripts/connect-host-cdp.mjs --browser edge --test-only
node scripts/connect-host-cdp.mjs --browser chrome --test-only
```

## Browser Setup

This skill intentionally uses `ncat` instead of asking Windows to listen on a public interface. The browser DevTools port stays on Windows `127.0.0.1`; WSL sees only a local loopback bridge such as `127.0.0.1:59222`.

If the script cannot find `DevToolsActivePort`, ask the user to enable remote debugging in the host browser:

- Edge: open `edge://inspect/#remote-debugging` and enable `Allow remote debugging for this browser instance`.
- Chrome: open `chrome://inspect/#remote-debugging` and enable `Allow remote debugging for this browser instance`.

If the browser was started manually with a fixed debug port, pass both the port and path:

```bash
node scripts/connect-host-cdp.mjs --browser edge --host-port 9222 --ws-path /devtools/browser/<uuid>
```

## Common Commands

Use a different WSL port:

```bash
node scripts/connect-host-cdp.mjs --browser edge --local-port 59223
```

Test without starting or rewriting the bridge:

```bash
node scripts/connect-host-cdp.mjs --browser edge --status
```

Use an explicit Windows ncat path:

```bash
node scripts/connect-host-cdp.mjs --browser edge --ncat '/mnt/c/Program Files (x86)/Nmap/ncat.exe'
```

Stop the bridge:

```bash
pkill -f wsl-host-cdp-forward
```

After successful bridging, browser discovery tools that read Linux Chromium `DevToolsActivePort` files should see the host browser at the WSL local port. For example, if the `web-access` skill is installed, run its `scripts/check-deps.mjs` with the same browser:

```bash
node /path/to/web-access/scripts/check-deps.mjs --browser edge
```

## Troubleshooting

- If validation times out, confirm `ncat.exe` is installed on Windows. The script checks common Nmap install paths and `Get-Command ncat.exe`.
- If `/json/version` does not respond but WebSocket validation succeeds, treat the bridge as usable; some host debug endpoints may not expose the same HTTP behavior through this path.
- If the host browser restarts, rerun the script because the host port and WebSocket path may change.
- If a local port is already occupied by a stale bridge, stop it with `pkill -f wsl-host-cdp-forward` or choose `--local-port`.
- Keep the bridge bound to `127.0.0.1` in WSL. Do not expose the browser debug port on a public interface.
