# NEVER dispatch external-CLI agents on this machine
Use ONLY: worker, oracle, reviewer, scout, delegate, researcher, evidence-auditor.
NEVER: claude-code, claude-code-writer, codex-exec, codex-exec-writer, cursor-agent,
cursor-agent-writer. On 2026-10-01 these were QUARANTINED to
../memory/DISABLED-external-cli-agents/ and must not be restored.
WHY: they are not agents — they are wrappers around third-party CLIs on PATH
(`command: claude` etc). JordiPosthumus has NO Claude subscription and no
ANTHROPIC_API_KEY anywhere (env, rc files, launchctl all verified unset). One such
dispatch attempted an outbound Anthropic call and died with HTTP 404 on
claude-sonnet-4-6, 0 tokens. Jordi reacted strongly and rightly.
HIS CONFIG IS UNAMBIGUOUS: defaultModel = dsg-pool/PoolModel, PI_MODEL=PoolModel.
Nothing on this machine is supposed to reach Anthropic.
LESSON: a name in the agent list is NOT a guarantee it runs on Jordi's models.
These six looked like ordinary builtins — that is exactly how they got used.
