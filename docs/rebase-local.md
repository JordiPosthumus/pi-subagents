# Rebase playbook — staying current with upstream without losing Local-AI behavior

The fork carries a small series of local commits on top of `nicobailon/pi-subagents`.
Upstream moves fast (hundreds of commits between checks). This playbook keeps us
current **without ever re-arguing whether local behavior survived** — a script proves it.

## The two artifacts

1. **`local-patches` branch** — upstream/main + only our local commits, kept rebased.
   The working branch (`codex/pi-1.0.2-compat`) fast-forwards to it after verification.
2. **`scripts/behavior-ledger.mjs`** — one probe per local invariant. Green means the
   behavior survived, no matter how upstream restructured the code. This replaces
   eyeballing diffs.

## The flow

```
scripts/rebase-local.sh
```

That single command: fetches upstream, backs up the working branch to
`backup/<date>-<branch>`, rebases `local-patches` onto `upstream/main`
(`--empty=drop`), then runs the behavior ledger — fast invariants first, then the
full ledger including the unit-suite regression comparison against
`test/expected-failures.json`. It tells you the ff-merge commands at the end.

## Patch-by-patch expectations (as of 2026-10-15, upstream 444 ahead)

| local patch | invariant | rebase expectation |
|---|---|---|
| `45da0541` | **owner-controlled unbounded local inference** | **KEEP — the crown jewel.** Upstream now has its own deadline machinery (`checkpointBeforeDeadlineMs` + deadline kill). If this conflicts: resolve **by hand**, preserve the local policy, never take upstream wholesale. Ledger check #2 + the schema-clamp probe catch violations. |
| `7c7e7e8e` | phantom async-workflow children release capacity | KEEP; upstream refactored async-execution heavily. If conflict: hand-resolve, keep the release semantics. Ledger runs the capacity unit tests. |
| `dca1e091` | pi 1.0.2 host exports (legacy harness) | KEEP until the legacy harness is retired. 6 lines. |
| `6bdaba47` | external-CLI agent quarantine | KEEP. Content patch; near-zero conflict risk. Ledger checks the DISABLED dir. |
| `71faca3c` | pool defaults docs + fragments | KEEP. Docs only. |
| `1def085b` | chord required only when host declares it | **DROP** — upstream #2855 has it. Becomes empty (auto-dropped) or conflicts → take upstream. |
| `9d4e8fa4` | agent-core/node export-presence | **DROP** — upstream marks the alias `optional: true`. Same handling. |
| `d772008e` | typebox optional peer | **DROP** — upstream declares it optional now. Same handling. |
| `20819381` | merge commit | Flattens away in the rebase. |

## Conflict rules (the ours/theirs trap)

During `git rebase upstream/main local-patches`, the meanings are **reversed** from
what you'd guess:

- `--ours` = **upstream/main** (the base you are replaying onto)
- `--theirs` = **your local patch**

So "prefer upstream's version of a dropped patch" means `git checkout --ours <file>`.
"Preserve my behavior" means hand-edit — do not blindly take either side for the
crown-jewel patch.

## After the rebase

1. Ledger green (the script already ran it).
2. `git checkout codex/pi-1.0.2-compat && git merge --ff-only local-patches`
3. One manual smoke that the ledger can't do headlessly: launch one real background
   sub-agent from a fresh session and confirm it completes, and run one goal turn
   with a sub-agent to confirm the hold still engages.
4. `git push origin codex/pi-1.0.2-compat`

## Updating the baseline

If the ledger reports baseline failures that now **pass** — good news: update
`test/expected-failures.json` (regenerate from the suite output) so the next rebase
keeps a clean signal. If it reports a **new** failure: that's a real regression;
do not merge.
