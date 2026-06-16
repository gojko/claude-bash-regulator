import { describe, test, expect } from '@jest/globals';
import { evaluateCommand } from '../src/evaluate-command.js';

const allowAll = { id: 'allow-all', decision: 'allow', reason: 'allowed', matchSegment: () => true };
const denyAll = { id: 'deny-all', decision: 'deny', reason: 'denied', matchSegment: () => true };
const askAll = { id: 'ask-all', decision: 'ask', reason: 'asks', matchSegment: () => true };

describe('evaluateCommand', () => {
	test('empty rules → no-match', () => {
		expect(evaluateCommand({ command: 'ls', rules: [] })).toEqual({ decision: 'no-match' });
	});

	test('allow-all → allow', () => {
		expect(evaluateCommand({ command: 'ls', rules: [allowAll] })).toEqual({ decision: 'allow', reason: 'allowed' });
	});

	test('deny-all → deny', () => {
		expect(evaluateCommand({ command: 'rm -rf /', rules: [denyAll] })).toEqual({ decision: 'deny', reason: 'denied' });
	});

	test('compound: allow && deny → deny (deny wins)', () => {
		expect(evaluateCommand({ command: 'ls && rm -rf /', rules: [denyAll] })).toEqual({ decision: 'deny', reason: 'denied' });
	});

	test('compound: allow && unmatched → no-match (the downgrade)', () => {
		const allowOnlyLs = { id: 'ls-only', decision: 'allow', reason: 'ls', matchSegment: (tokens) => tokens[0] === 'ls' };
		expect(evaluateCommand({ command: 'ls && pwd', rules: [allowOnlyLs] })).toEqual({ decision: 'no-match' });
	});

	test('env-var prefix is stripped before evaluation', () => {
		const allowMake = { id: 'make', decision: 'allow', reason: 'make', matchSegment: (tokens) => tokens[0] === 'make' };
		expect(evaluateCommand({ command: 'TEST=ci make deploy', rules: [allowMake] })).toEqual({ decision: 'allow', reason: 'make' });
	});

	test('wrapper is unwrapped before evaluation', () => {
		const allowMake = { id: 'make', decision: 'allow', reason: 'make', matchSegment: (tokens) => tokens[0] === 'make' };
		expect(evaluateCommand({ command: 'time make test', rules: [allowMake] })).toEqual({ decision: 'allow', reason: 'make' });
	});

	test('tooComplex parse → deny (the regulator blocks commands it cannot understand)', () => {
		const result = evaluateCommand({ command: 'cat <<EOF', rules: [allowAll] });
		expect(result.decision).toBe('deny');
		expect(result.reason).toMatch(/could not be safely parsed/);
		expect(result.reason).toMatch(/debug\.js/);
	});

	test('matchRaw rules see the whole original command', () => {
		const seen = [];
		const rule = { id: 'raw', decision: 'deny', reason: 'r', matchRaw: (cmd) => { seen.push(cmd); return true; } };
		evaluateCommand({ command: 'a && b', rules: [rule] });
		expect(seen).toContain('a && b');
	});

	test('reason as function receives the original command (not the segment)', () => {
		const rule = {
			id: 'r',
			decision: 'deny',
			reason: (cmd) => `blocked: ${cmd}`,
			matchSegment: (tokens) => tokens[0] === 'rm'
		};
		expect(evaluateCommand({ command: 'ls && rm /tmp/x', rules: [rule] })).toEqual({ decision: 'deny', reason: 'blocked: ls && rm /tmp/x' });
	});

	test('ask rule on the only segment → ask', () => {
		expect(evaluateCommand({ command: 'foo', rules: [askAll] })).toEqual({ decision: 'ask', reason: 'asks' });
	});

	test('bare wrapper is preserved (not collapsed) so rules can still evaluate it', () => {
		const allowOnlyMake = { id: 'make', decision: 'allow', reason: 'make', matchSegment: (tokens) => tokens[0] === 'make' };
		expect(evaluateCommand({ command: 'nohup', rules: [allowOnlyMake] })).toEqual({ decision: 'no-match' });
	});

	test('bare wrapper with a matching rule fires (the wrapper is not stripped when there is no inner command)', () => {
		const allowNohup = { id: 'nohup', decision: 'allow', reason: 'nohup', matchSegment: (tokens) => tokens[0] === 'nohup' };
		expect(evaluateCommand({ command: 'nohup', rules: [allowNohup] })).toEqual({ decision: 'allow', reason: 'nohup' });
	});
});
