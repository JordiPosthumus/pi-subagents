# Local-AI fork

This is JordiPosthumus's maintained fork of **nicobailon/pi-subagents**, initially based on **v0.67.0**. Upstream authorship and the MIT license are retained. The fork is intended for OpenAI-compatible local inference engines and long-running agent work.

Local inference can legitimately wait in a queue, prefill a large context, or spend minutes reasoning before returning anything. A hidden five-minute HTTP default must not decide that such work has failed.

## What changed

Upstream 0.65 moved children from spawned Pi CLI processes to native sessions. The detached runner installed a separate Undici dispatcher without applying the owner's HTTP settings. Undici's five-minute header timeout survived even when Pi's run and provider settings allowed much longer waits. Four five-minute failures and three automatic retries appeared to the operator as one twenty-minute failure. In the observed incident, the failed requests never left the gateway queue.

With this fork's owner policy enabled:

```json
{ "localInference": { "enabled": true } }
```

- Foreground, detached, workflow and resumed native child launches have no automatic run deadline. Model-supplied `timeoutMs`, `maxRuntimeMs`, and inherited execution deadlines do not override the policy.
- Each native child uses a dedicated proxy-aware HTTP dispatcher with header, body and connection timeout clocks disabled. It does not change the parent's global dispatcher.
- The provider SDK's deadline signal is not forwarded to the transport. Pi's child/operator cancellation signal **is** forwarded, including after streaming has begun. This avoids substituting a very large finite duration for an unlimited wait.
- The configured model, reasoning effort, output/context limits, concurrency, tools and cache-related request content are unchanged.
- Child session records contain a `pi-subagents:local-inference-policy` entry. `subagent({action:"doctor"})` reports the owner policy. Detached stderr also records it. Malformed policy does not silently fall back to default timers.

The setting lives in the **owner's** `~/.pi/agent/extensions/subagent/config.json` (or `PI_CODING_AGENT_DIR`). Merge it into the existing file; do not replace unrelated configuration. It is opt-in so adopting the fork does not silently alter another operator's timeout policy. This owner's installation enables it.

## Boundaries

The tested runtime is **npm Pi 0.85.1 on Node 22**, with native OpenAI-compatible model requests. Existing control-plane waits, tool-command timeouts, verification budgets, startup handshakes and usage/turn budgets retain their meanings. Arbitrary external CLI agents have their own HTTP clients; this fork cannot remove timers inside those programs. Nor can it override a gateway or engine that independently rejects a request. None of those external services is modified by installation.

Manual stop, interrupt and actual transport/server errors still terminate/report work. The fork does not add endless retries. Removing an HTTP wait deadline also means a healthy TCP connection to a permanently stuck server needs operator cancellation. Policy coverage is enforced and tested at the native child path, not by rewriting arbitrary shell commands.

## Installation and updates

Use the checked updater, which stages the maintained branch from **this fork only**, tests it, and installs an immutable commit:

```sh
git clone https://github.com/JordiPosthumus/pi-subagents.git
cd pi-subagents
node tools/update-local-ai.mjs /absolute/path/to/node_modules/@earendil-works/pi-coding-agent
```

The package path on the owner's Mac is `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent`. The updater takes over five minutes because it exercises the real timeout boundary. `--check-only` runs the same gate without changing live files.

It snapshots `settings.json`, `models.json`, and the subagent config in a private timestamped backup, switches the package source from upstream npm to the verified fork commit, preserves resource filters, enables `localInference`, and checks that model definitions are unchanged. Existing npm files remain available to running sessions. **Wait for existing work to become idle, then restart Pi.** There is no automatic restart.

Future updates: rerun the checked updater from the fork checkout. A normal `pi update` will not advance a commit-pinned installation to untested upstream code. Do not install `npm:pi-subagents` alongside the fork: that is the upstream package.

Rollback: when work is idle, restore the backed-up `settings.json` and `subagent-config.json` to their original locations and restart Pi. Keep the backup and existing package files until the replacement is verified.

## Pool selection and cached model exclusions

These are standard upstream configuration controls, separate from the fork's HTTP timeout fix. The owner's verified setup is supplied as mergeable examples:

- [Pi settings fragment](../examples/local-ai/settings.fragment.json): merge into `~/.pi/agent/settings.json`. It selects `dsg-pool/qwen3.8-flash-next` and `xhigh` for subagents, with explicit overrides for the seven native roles. The overrides also replace builtin role thinking defaults. External CLI role definitions are not changed.
- [Subagent config fragment](../examples/local-ai/subagent-config.fragment.json): merge into `~/.pi/agent/extensions/subagent/config.json`. It enables local inference and sets `modelExclusions.defaultTtlMs` to **60,000 ms (60 seconds)** instead of the upstream 24-hour default.

These files are fragments, not complete replacement configurations. Preserve unrelated settings and nested role fields. The model identifier is specific to this owner's registered pool; other operators must use their own configured provider/model. The checked updater preserves these settings on subsequent upgrades.

Pi's top-level default model does not change the model selected in a restored parent session. Explicit subagent defaults and role overrides prevent that parent selection from routing ordinary native child launches to the standalone M3. Per-run model overrides and project/provider-specific settings can still take precedence. Validation in the owner's DSG project resolved all seven native roles to pool/xhigh with either `dsg-m3` or `dsg-pool` as the parent provider.

The upstream extension automatically persists some provider/model failures as exclusions. Fixing request timeouts does not clear an exclusion already written to disk, and restarting reloads that exclusion. A pre-fix `Request timed out.` entry caused the observed M3 rejection after installation; it was backed up and removed specifically, then both configured model candidates were verified as eligible.

A 60-second cooldown is **not an inference deadline** and does not disable exclusions: repeated failures can create another cooldown, and the setting applies to all exclusion reasons. Lowering the configured duration also shortens existing entries from their original recording time. No exclusion-policy source change is included here.

After changing these settings, wait for active work to finish and use `/reload` or restart Pi; running children retain their existing launch configuration. Neither operation is performed automatically.

## Checks before an update is adopted

1. Typecheck and focused policy, capacity and child-session tests.
2. Actual Pi CLI, public subagent tool, detached runner, native SDK and HTTP stack. A fixture delays response headers for **310 seconds**, while a parallel request pauses its streaming body for **310 seconds**. Both must complete with exactly one request each.
3. Owner policy must defeat **1 ms** provider, run, and workflow-child deadlines supplied in the isolated fixture.
4. Foreground requests must also complete. Manual stop must disconnect a blocked HTTP request, produce observed runner-exit evidence and release async capacity.

All regression fixtures have separate settings, credentials, session storage, agent definitions and runtime directories. They do not load the owner's projects or contact live model servers. The test harness has a watchdog to stop a broken test; that watchdog is never a production inference setting.

GitHub Actions runs this gate on the maintained branch. Upstream changes should be brought into a review branch, checked, and then merged into `codex/local-ai`. Never resolve a merge by dropping the policy or its behavioral tests. The updater repeats the checks locally against the installed Pi runtime before adoption; a green source-only test is not enough.
