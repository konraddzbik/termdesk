# SSH Tunnel / Port-Forward Manager — Design

> A GUI to define, persist, start/stop and monitor SSH port forwards — the
> capability DevOps users live on (DB access, dashboards, SOCKS proxy). The
> session layer already has every primitive; this is a manager and UI over them.

## Forward types

| Type | Flag | What it does | Supported |
|---|---|---|---|
| **Local** | `-L` | A local port → forwarded over SSH to a remote `host:port` (e.g. `127.0.0.1:5432` → DB on the bastion's network). | ✅ |
| **Dynamic** | `-D` | A local SOCKS5 proxy; the client picks the destination per-connection. | ✅ (CONNECT, no-auth) |
| **Remote** | `-R` | A port on the *remote* → forwarded back to a local `host:port`. Least-used, needs `GatewayPorts`/`forwardIn`. | not yet |

## Architecture (reuses existing plumbing)

```
renderer Tunnels panel ──IPC──▶ tunnel-manager (main)
                                  │  net.Server on 127.0.0.1:<listenPort>
                                  │   └─ per socket: client.forwardOut(…) ⇄ pipe (ws-bridge pattern)
                                  └─ SSH Client from sessionManager.borrowClient()  (reuse a live
                                       terminal's connection) or connectDedicated()  (own shell-less
                                       connection, with ProxyJump + host-key verify + vault auth)
```

- **No new SSH/auth code.** A tunnel obtains its `ssh2.Client` exactly like VNC does:
  borrow a live terminal's client for the host, else open a dedicated one (tracked
  for teardown). `forwardOut()` (`session-manager.ts`) is generalized to take an
  arbitrary `dst host:port`.
- **Local forward:** a `net.Server` on the listen port; each accepted socket →
  `client.forwardOut('127.0.0.1', srcPort, dstHost, dstPort)` → bidirectional pipe
  with the high-water backpressure pattern from `ws-bridge.ts`.
- **Dynamic (SOCKS5):** same listener, but the accepted socket first speaks a
  minimal SOCKS5 handshake (no-auth + CONNECT only); the parsed `dst` is then
  `forwardOut`-ed. Pure parser in `ssh/socks.ts` (unit-tested).

## Persistence

A `tunnels` table (mirrors `localTerminals`): `id, hostId, type, listenHost,
listenPort, dstHost, dstPort, name, autoStart, sortOrder, createdAt, updatedAt`.
CRUD in `tunnels-repo.ts`. Saved tunnels survive restarts and are started/stopped
manually from the panel. (The `autoStart` column is reserved for a follow-up — see
below — so it ships persisted but without a UI toggle yet.)

## Lifecycle & safety

- Runtime tunnels tracked in a `Map` keyed by a runtime id; **owner-scoped** and
  torn down on window close (`watchOwner` → `destroyForOwner`), like SFTP/VNC.
- A borrowed client closing under the tunnel → listener torn down + `stopped`
  event (never an orphaned bound server). A dedicated client is `disconnect()`-ed
  on stop, like `vnc-manager` `onClosed`.
- `listen()` is promise-wrapped so `EADDRINUSE` becomes a friendly error, not an
  unhandled crash.
- Each open/close is written to the **activity log** (`tunnel` kind).

## Files

```
src/main/ssh/tunnel-manager.ts   # the only new logic: listeners + pipe + lifecycle
src/main/ssh/socks.ts            # pure SOCKS5 CONNECT parser   [tested]
src/main/store/tunnels-repo.ts   # CRUD (mirrors local-terminals-repo)
src/main/ipc/tunnels.ts          # IPC handlers (mirrors ipc/sftp.ts) + activity log
src/renderer/components/tunnels/ # sidebar panel + add/edit dialog + store
src/shared/{ipc,channels,types}.ts  # schemas, channels, RendererApi
```

## Out of scope (follow-ups)

Remote (`-R`) forwards, SOCKS auth methods other than no-auth, per-tunnel
throughput graphs, importing forwards from `~/.ssh/config` `LocalForward` lines,
and **auto-start on host connect** (needs a main-process per-host connect hook so
it can borrow the live client without a surprise host-key prompt).
