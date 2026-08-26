## What changed, and why

<!-- One paragraph. The behaviour before, the behaviour after, and the reason. Link the
issue if there is one. -->

## How it was verified

<!-- Commands you actually ran, and their result. Say what you did NOT run. -->

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] Smoke harnesses where relevant — `npm run test:smoke -- <vault|mcp|ssh|sftp|vnc>`
      (`ssh`/`sftp`/`vnc` need `docker compose -f docker-compose.test.yml up -d`)
- [ ] Ran the change in the app (`npm run dev`), for anything user-visible

## Security checklist

- [ ] Any new or changed IPC handler validates its arguments through the Zod contract in
      `src/shared/ipc.ts`, including length bounds on renderer→main strings
- [ ] No secret reaches the renderer or a log — passwords, passphrases, keys, license
      tokens and bridge tokens stay in the main process; errors returned to the renderer go
      through `sanitizeErrorMessage`
- [ ] N/A — this PR touches neither IPC nor anything secret-bearing

## Notes for the reviewer

<!-- Anything deliberately left out, a follow-up you plan, or a decision you want argued
with. Delete if there is nothing. -->
