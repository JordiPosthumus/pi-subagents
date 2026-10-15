#!/usr/bin/env node
// Behavior ledger for the Local-AI fork of pi-subagents.
//
// One check per local invariant. After ANY rebase onto upstream/main, run:
//   node --experimental-strip-types scripts/behavior-ledger.mjs
// Exit 0 = every invariant the fork depends on still holds, regardless of how
// upstream rewrote the internals. `--skip-suite` skips the slow unit-suite
// comparison (the other checks take seconds).
//
// Invariant -> patch map:
//   chord aliases ............ 1def085b (now upstream #2855)
//   unbounded inference ...... 45da0541 (crown jewel — never drop)
//   async children capacity .. 7c7e7e8e
//   external CLI quarantine .. 6bdaba47
//   pool defaults docs ....... 71faca3c
//   typebox optional peer .... d772008e (now upstream)
//   unit-suite regression .... whole-series safety net
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKIP_SUITE = process.argv.includes("--skip-suite");
// Harness probe targets: override via env when the SparkSetup layout moves.
const HARNESS_MODERN = process.env.HARNESS_MODERN
	|| "/Users/jordiposthumus/SparkSetup/pi-upgrade-20261014T121039Z/candidate/harness/node_modules/@earendil-works/pi-coding-agent";
const HARNESS_LEGACY = process.env.HARNESS_LEGACY
	|| "/Users/jordiposthumus/SparkSetup/pi-upgrade-20261004T180608Z/candidate/harness/node_modules/@earendil-works/pi-coding-agent";

const results = [];
async function check(name, fn) {
	try {
		const note = await fn();
		results.push([name, true, note ?? ""]);
	} catch (error) {
		results.push([name, false, String(error?.message ?? error)]);
	}
}
function assert(condition, message) {
	if (!condition) throw new Error(message);
}

// --- invariant probes -------------------------------------------------------

async function probeChordAliases() {
	const { resolveHostPeerAliases } = await import(join(ROOT, "src/runs/background/runner-aliases.ts"));
	assert(existsSync(HARNESS_MODERN), `modern harness not found: ${HARNESS_MODERN}`);
	assert(existsSync(HARNESS_LEGACY), `legacy harness not found: ${HARNESS_LEGACY}`);
	const modern = resolveHostPeerAliases(HARNESS_MODERN);
	assert(Array.isArray(modern.missing) && modern.missing.length === 0,
		`modern harness reports missing peers: ${JSON.stringify(modern.missing)}`);
	assert(!modern.missing.some((spec) => spec.includes("chord")),
		"chord must not be required on a host that does not declare it");
	const legacy = resolveHostPeerAliases(HARNESS_LEGACY);
	assert(Array.isArray(legacy.missing) && legacy.missing.length === 0,
		`legacy harness reports missing peers: ${JSON.stringify(legacy.missing)}`);
	const chordAliases = Object.keys(legacy.aliases).filter((spec) => spec.includes("chord"));
	assert(chordAliases.length > 0, "legacy harness declares chord: chord aliases must resolve host-first");
	return `modern: ${Object.keys(modern.aliases).length} aliases, no chord requirement · legacy: ${Object.keys(legacy.aliases).length} aliases incl. chord`;
}

async function probeUnboundedInference() {
	const { localInferenceEnabled } = await import(join(ROOT, "src/runs/shared/local-inference-policy.ts"));
	assert(localInferenceEnabled({ localInference: { enabled: true } }) === true, "localInference.enabled=true must be honored");
	assert(localInferenceEnabled({}) === false, "unset localInference must default to off");
	const schemas = readFileSync(join(ROOT, "src/extension/schemas.ts"), "utf8");
	const timeoutSchemas = [...schemas.matchAll(/timeoutMs:\s*Type\.Optional\(Type\.Integer\(\{[\s\S]{0,600}?\}\)\)/g)].map((m) => m[0]);
	assert(timeoutSchemas.length > 0, "timeoutMs schema not found — upstream may have renamed it; re-verify unbounded deadlines by hand");
	for (const schema of timeoutSchemas) {
		assert(!/maximum/.test(schema), "upstream added a maximum clamp near timeoutMs — confirm owner-controlled unbounded inference still wins before accepting this rebase");
	}
	assert(existsSync(join(ROOT, "src/runs/shared/local-inference-policy.ts")), "src/runs/shared/local-inference-policy.ts is missing");
	assert(existsSync(join(ROOT, "src/runs/shared/local-inference-transport.ts")), "src/runs/shared/local-inference-transport.ts is missing");
	return `policy fn OK · ${timeoutSchemas.length} timeoutMs schema(s) unbounded · fork policy files present`;
}

function probeChildrenCapacity() {
	const files = ["test/unit/active-async-capacity.test.ts", "test/unit/async-execution.test.ts"];
	for (const file of files) {
		assert(existsSync(join(ROOT, file)), `${file} missing — upstream renamed it; re-point this probe`);
		const run = spawnSync("node",
			["--experimental-strip-types", "--import", "./test/support/isolated-temp-root.mjs", "--test", file],
			{ cwd: ROOT, encoding: "utf8", timeout: 180000 });
		assert(run.status === 0, `${basename(file)} failed:\n${(run.stdout ?? "").slice(-400)}\n${(run.stderr ?? "").slice(-400)}`);
	}
	return `${files.length} capacity test file(s) green`;
}

function probeCliQuarantine() {
	const disabledDir = join(ROOT, "memory", "DISABLED-external-cli-agents");
	const disabled = existsSync(disabledDir) ? readdirSync(disabledDir).filter((f) => f.endsWith(".md")) : [];
	assert(disabled.length >= 6, `expected >=6 quarantined external-CLI definitions in memory/DISABLED-external-cli-agents/, found ${disabled.length}`);
	const agentsDir = join(ROOT, "agents");
	const active = existsSync(agentsDir)
		? readdirSync(agentsDir).filter((f) => f.endsWith(".md") && /claude|codex|cursor/i.test(f))
		: [];
	assert(active.length === 0, `external-CLI definitions re-appeared in agents/: ${active.join(", ")}`);
	assert(existsSync(join(ROOT, "memory", "NEVER-dispatch-external-CLI-agents.md")), "memory/NEVER-dispatch-external-CLI-agents.md is missing");
	return `${disabled.length} definitions quarantined, agents/ clean`;
}

function probePoolDefaults() {
	for (const file of ["docs/local-ai.md", "examples/local-ai/settings.fragment.json", "examples/local-ai/subagent-config.fragment.json"]) {
		assert(existsSync(join(ROOT, file)), `${file} missing — pool-defaults documentation lost in rebase`);
	}
	return "local-ai docs + config fragments present";
}

function probeTypeboxPeer() {
	const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
	const peers = manifest.peerDependencies ?? {};
	assert("typebox" in peers, "typebox missing from peerDependencies — host-copy matching broke");
	const meta = manifest.peerDependenciesMeta ?? {};
	assert(meta.typebox?.optional === true, "typebox peer is no longer optional — a rebase may have taken upstream's stricter manifest");
	return `typebox peer "${peers.typebox}" optional`;
}

function probeUnitSuite() {
	const baselinePath = join(ROOT, "test/expected-failures.json");
	const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
	const expected = new Set(baseline.expectedFailingSuites);
	const run = spawnSync("npm", ["run", "test:unit"], { cwd: ROOT, encoding: "utf8", timeout: 480000, maxBuffer: 64 * 1024 * 1024 });
	const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
	const failing = [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
	const unexpected = failing.filter((name) => !expected.has(name));
	// Some suites are load-flaky under the 232-file parallel run. Before declaring
	// a regression, re-run each unexpected suite's file in isolation; only a file
	// that also fails alone is real.
	const flaky = [];
	const real = [];
	for (const name of unexpected) {
		const located = spawnSync("grep", ["-rl", name, "test/unit"], { cwd: ROOT, encoding: "utf8", timeout: 30000 });
		const file = (located.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean)[0];
		let confirmed = true;
		if (file) {
			const solo = spawnSync("node",
				["--experimental-strip-types", "--import", "./test/support/isolated-temp-root.mjs", "--test", file],
				{ cwd: ROOT, encoding: "utf8", timeout: 180000 });
			if (solo.status === 0) confirmed = false;
		}
		(confirmed ? real : flaky).push(file ? `${name} (${file})` : name);
	}
	assert(real.length === 0, `NEW unit-suite failures not in test/expected-failures.json: ${real.join(" | ")}`);
	const healed = [...expected].filter((name) => !failing.includes(name));
	return `${failing.length} failing suites, all in baseline or flake-verified (${baseline.expectedFailingSuites.length} expected)`
		+ (flaky.length ? ` · ${flaky.length} passed in isolation (parallel-load flake): ${flaky.join(", ")}` : "")
		+ (healed.length ? ` · ${healed.length} baseline failure(s) now pass — consider updating test/expected-failures.json` : "");
}

// --- runner -----------------------------------------------------------------

const checks = [
	["chord aliases: required only when host declares chord", probeChordAliases],
	["owner-controlled unbounded inference (crown jewel)", probeUnboundedInference],
	["async workflow children capacity", probeChildrenCapacity],
	["external CLI agent quarantine", probeCliQuarantine],
	["pool defaults documentation", probePoolDefaults],
	["typebox optional peer dependency", probeTypeboxPeer],
];
if (!SKIP_SUITE) checks.push(["unit suite vs expected-failure baseline", probeUnitSuite]);

for (const [name, fn] of checks) await check(name, fn);

const width = Math.max(...checks.map(([name]) => name.length));
let failed = 0;
for (const [name, ok, note] of results) {
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(width)}  ${note}`);
}
console.log(failed === 0 ? "\nBEHAVIOR LEDGER: all invariants hold." : `\nBEHAVIOR LEDGER: ${failed} invariant(s) violated — do not merge this rebase.`);
process.exit(failed === 0 ? 0 : 1);
