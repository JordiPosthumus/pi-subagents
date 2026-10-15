#!/usr/bin/env node
// Stage from the owner's fork, verify behavior, then install an immutable commit.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repository = "https://github.com/JordiPosthumus/pi-subagents.git";
const branch = "codex/local-ai";
const piRoot = process.argv[2];
assert.ok(piRoot && path.isAbsolute(piRoot), "Usage: node tools/update-local-ai.mjs /absolute/pi-coding-agent/package [--check-only]");
assert.ok(fs.existsSync(path.join(piRoot, "dist/cli.js")), "Pi CLI not found");
const staging = fs.mkdtempSync(path.join(os.tmpdir(), "pi-local-ai-update-"));
function writeAtomic(file, text) {
	const temporary = `${file}.local-ai-${process.pid}.tmp`;
	const mode = fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : 0o600;
	try {
		fs.writeFileSync(temporary, text, { mode, flag: "wx" });
		fs.renameSync(temporary, file);
	} finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function run(command, args, cwd = staging) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: "inherit" });
		child.once("error", reject);
		child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}; live configuration has not been approved by this gate`)));
	});
}
await run("git", ["clone", "--single-branch", "--branch", branch, repository, "checkout"]);
const checkout = path.join(staging, "checkout");
await run("npm", ["ci", "--ignore-scripts"], checkout);
await run("npm", ["run", "typecheck"], checkout);
await run("npm", ["run", "test:local-ai"], checkout);
await run(process.execPath, ["tools/check-local-inference.mjs", piRoot, "--long"], checkout);
const { execFileSync } = await import("node:child_process");
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: checkout, encoding: "utf8" }).trim();
assert.match(sha, /^[a-f0-9]{40}$/);
if (process.argv.includes("--check-only")) {
	console.log(`PASS ${sha}; check-only, no live files changed. Staging: ${staging}`);
	process.exit(0);
}

const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
const settingsPath = path.join(agentDir, "settings.json");
const configPath = path.join(agentDir, "extensions", "subagent", "config.json");
const settingsRaw = fs.readFileSync(settingsPath, "utf8");
const configRaw = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : undefined;
const settings = JSON.parse(settingsRaw);
const config = configRaw === undefined ? {} : JSON.parse(configRaw);
assert.ok(settings && typeof settings === "object" && Array.isArray(settings.packages));
assert.ok(config && typeof config === "object" && !Array.isArray(config));
const isSubagents = (entry) => {
	const source = typeof entry === "string" ? entry : entry?.source;
	return typeof source === "string" && (/^npm:pi-subagents(?:@|$)/.test(source) || /^git:github\.com\/JordiPosthumus\/pi-subagents(?:@|$)/i.test(source));
};
const existing = settings.packages.find(isSubagents);
const source = `git:github.com/JordiPosthumus/pi-subagents@${sha}`;
const preserved = typeof existing === "object" ? { ...existing, source } : source;
const backup = path.join(agentDir, "backups", `local-ai-install-${new Date().toISOString().replace(/[:.]/g, "-")}`);
fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(backup, "settings.json"), settingsRaw, { mode: 0o600 });
if (configRaw !== undefined) fs.writeFileSync(path.join(backup, "subagent-config.json"), configRaw, { mode: 0o600 });
const modelsPath = path.join(agentDir, "models.json");
const modelsRaw = fs.existsSync(modelsPath) ? fs.readFileSync(modelsPath, "utf8") : undefined;
if (modelsRaw !== undefined) fs.writeFileSync(path.join(backup, "models.json"), modelsRaw, { mode: 0o600 });
fs.writeFileSync(path.join(backup, "receipt.json"), JSON.stringify({ source, sha, staging, policy: { enabled: true }, testedDelayMs: 310000 }, null, 2));
console.log(`Verified ${sha}. Backup: ${backup}`);

try {
	// Pi provisions its managed git checkout and production dependencies. Do not
	// uninstall npm's old files: already-running sessions may still use them.
	await run(process.execPath, [path.join(piRoot, "dist/cli.js"), "install", source], checkout);
	const current = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
	const packages = current.packages ?? [];
	const first = packages.findIndex(isSubagents);
	current.packages = packages.filter((item) => !isSubagents(item));
	current.packages.splice(first < 0 ? current.packages.length : first, 0, preserved);
	const currentConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
	currentConfig.localInference = { enabled: true };
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	writeAtomic(configPath, JSON.stringify(currentConfig, null, 2) + "\n");
	writeAtomic(settingsPath, JSON.stringify(current, null, 2) + "\n");
	assert.equal((JSON.parse(fs.readFileSync(settingsPath, "utf8")).packages ?? []).filter(isSubagents).length, 1);
	assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).localInference.enabled, true);
	if (modelsRaw !== undefined) assert.equal(fs.readFileSync(modelsPath, "utf8"), modelsRaw, "model definitions must remain byte-for-byte unchanged");
	console.log(`Installed ${source}. Existing runs were not restarted. When they are idle, restart Pi to activate the fork.`);
} catch (error) {
	writeAtomic(settingsPath, settingsRaw);
	if (configRaw !== undefined) writeAtomic(configPath, configRaw);
	else if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
	console.error(`Installation failed; restored prior settings/config from ${backup}. Downloaded package files are retained for inspection.`);
	throw error;
}
