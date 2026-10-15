#!/usr/bin/env bash
# Future-proof rebase of the Local-AI fork onto nicobailon/pi-subagents main.
# Playbook: docs/rebase-local.md
set -euo pipefail
cd "$(dirname "$0")/.."

WORKING=$(git rev-parse --abbrev-ref HEAD)
if [ -n "$(git status --porcelain | grep -v '^??')" ]; then
	echo "Tracked changes present — commit or stash first."; exit 1
fi

if [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]; then
	echo "A rebase is already in progress. Resolve conflicts (docs/rebase-local.md), 'git rebase --continue', then rerun this script to verify only."
	VERIFY_ONLY=1
else
	git fetch upstream main
	git branch -f "backup/$(date +%Y%m%d-%H%M)-$WORKING" "$WORKING"
	if git show-ref --verify --quiet refs/heads/local-patches; then
		git checkout -q local-patches
		echo "Rebasing local-patches onto upstream/main (--empty=drop)..."
		git rebase --empty=drop upstream/main || {
			echo; echo "REBASE CONFLICT. Playbook: docs/rebase-local.md"
			echo "  ours   = upstream/main      (take with: git checkout --ours <file>)"
			echo "  theirs = your local patch   (take with: git checkout --theirs <file>)"
			echo "Then: git rebase --continue, and rerun this script."
			exit 1
		}
	else
		echo "First run: creating local-patches at current HEAD ($WORKING)."
		git checkout -q -b local-patches
	fi
fi

echo
echo "== behavior ledger (fast invariants) =="
node --experimental-strip-types scripts/behavior-ledger.mjs --skip-suite

echo
echo "== full behavior ledger (adds unit-suite regression comparison, ~1 min) =="
node --experimental-strip-types scripts/behavior-ledger.mjs

echo
echo "Rebase verified — every local invariant still holds on the new upstream base."
echo "Next steps:"
echo "  git checkout $WORKING && git merge --ff-only local-patches"
echo "  git push origin $WORKING"
