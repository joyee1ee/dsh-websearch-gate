# dsh-websearch-toggle

A per-session switch for [DeepSeek Harness](https://deepseek.com) that hides the built-in
`web_search` tool from the model. Turn it off in a session and the tool disappears from that
session's tool schema — the model cannot see or call it. Turn it back on and the tool returns
without a restart.

## Install

```bash
pnpm add dsh-websearch-toggle --dir ~/.dsh/profiles/desktop
```

Then add the bundle to `~/.dsh/profiles/desktop/package.json`:

```json
{
  "dsh": {
    "profile": {
      "bundles": ["...", "dsh-websearch-toggle"]
    }
  }
}
```

Restart DeepSeek Harness once. The switch appears in the composer, right of the permission
control.

## Use

- The trigger shows a globe and the label 联网搜索 (English: `Web search`).
- On (default): the session keeps the shipped tool set.
- Off: every agent of that session gets `ctx.tools.restrict({ deny: ['web_search'] })`, so the
  model no longer receives the tool's schema; a call guard blocks it even if the schema is
  still in flight.
- State is stored per session in `$DSH_HOME/websearch-toggle.json` (`~/.dsh/websearch-toggle.json`).
  Delete the file to reset every session to on.

## Configuration

The bundle row accepts an optional `denyTools` list (default `["web_search"]`):

```yaml
- id: websearch-toggle
  config:
    denyTools:
      - web_search
      - web_fetch
```

## Compatibility

Built against DeepSeek Harness `0.2.1-rc.5`. It relies on internals that may change between
releases: the `conversation.input.left` composer slot, the `web_search` tool name,
`ctx.tools.restrict` / `ctx.tools.guard`, and `ctx.webServer.register`. Check the slot and tool
names when upgrading the host.

## Uninstall

1. Remove `dsh-websearch-toggle` from `dsh.profile.bundles` in the profile `package.json`.
2. `pnpm remove dsh-websearch-toggle --dir ~/.dsh/profiles/desktop`
3. Delete `~/.dsh/websearch-toggle.json`.
4. Restart DeepSeek Harness.

## License

MIT
