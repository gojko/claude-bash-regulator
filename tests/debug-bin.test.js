import { describe, test, expect } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'debug.js');

const runWithArg = (command) => {
	const result = spawnSync('node', [BIN, command], { encoding: 'utf8' });
	return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
};

const runWithStdin = (command) => {
	const result = spawnSync('node', [BIN], { input: command, encoding: 'utf8' });
	return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
};

describe('debug.js bin entry', () => {
	test('exits non-zero and prints usage when neither argv nor stdin supplies a command', () => {
		const result = spawnSync('node', [BIN], { encoding: 'utf8', input: '' });
		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/usage:/i);
	});

	test('prints parsed segments, per-rule resolution, and merged decision for an allowed command', () => {
		const { exitCode, stdout } = runWithArg('ls /tmp');
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/command:.*ls \/tmp/);
		expect(stdout).toMatch(/segment 0/);
		expect(stdout).toMatch(/tokens:.*ls.*\/tmp/);
		expect(stdout).toMatch(/resolved by rule:.*common-allowed-commands/);
		expect(stdout).toMatch(/merged decision: allow/);
	});

	test('prints deny resolution with the rule id and reason', () => {
		const { exitCode, stdout } = runWithArg('sudo make deploy');
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/resolved by rule:.*sudo/);
		expect(stdout).toMatch(/decision:.*deny/);
		expect(stdout).toMatch(/reason:.*sudo is not allowed/);
		expect(stdout).toMatch(/merged decision: deny/);
	});

	test('prints no-match clearly when no rule resolves the segment', () => {
		const { stdout } = runWithArg('totally-unknown-binary --arg');
		expect(stdout).toMatch(/no rule matched/i);
		expect(stdout).toMatch(/merged decision: no-match/);
	});

	test('prints tooComplex when parser rejects the input', () => {
		const { stdout } = runWithArg('cat <<EOF');
		expect(stdout).toMatch(/tooComplex/i);
		expect(stdout).toMatch(/merged decision: deny/);
	});

	test('breaks down compound commands into separate segments', () => {
		const { stdout } = runWithArg('cd /tmp && ls');
		expect(stdout).toMatch(/segment 0/);
		expect(stdout).toMatch(/segment 1/);
		expect(stdout).toMatch(/merged decision: allow/);
	});

	test('reads command from stdin when no argv is provided', () => {
		const { exitCode, stdout } = runWithStdin('ls /tmp');
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/merged decision: allow/);
	});

	test('shows unwrapped tokens distinct from raw tokens for wrapped commands', () => {
		const { stdout } = runWithArg('time npx jest');
		expect(stdout).toMatch(/tokens:.*time.*npx.*jest/);
		expect(stdout).toMatch(/unwrapped:.*npx.*jest/);
		expect(stdout).toMatch(/merged decision: deny/);
	});
});
