import { describe, test, expect } from '@jest/globals';
import { rules } from '../src/rules.js';

const idOf = (rule) => rule.id;
const indexOf = (id) => rules.findIndex((r) => r.id === id);

describe('assembled rules array', () => {
	test('no duplicate ids', () => {
		const ids = rules.map(idOf);
		const seen = new Set();
		for (const id of ids) {
			expect(seen.has(id)).toBe(false);
			seen.add(id);
		}
	});

	test('every rule has a non-empty id', () => {
		for (const rule of rules) {
			expect(typeof rule.id).toBe('string');
			expect(rule.id.length).toBeGreaterThan(0);
		}
	});

	test('every rule has decision allow, ask, or deny', () => {
		for (const rule of rules) {
			expect(['allow', 'ask', 'deny']).toContain(rule.decision);
		}
	});

	test('every deny rule has a non-empty reason', () => {
		for (const rule of rules) {
			if (rule.decision === 'deny') {
				expect(typeof rule.reason === 'string' || typeof rule.reason === 'function').toBe(true);
				if (typeof rule.reason === 'string') {
					expect(rule.reason.length).toBeGreaterThan(0);
				}
			}
		}
	});

	test('every allow rule has NO reason (allow decisions need no explanation)', () => {
		for (const rule of rules) {
			if (rule.decision === 'allow') {
				expect(rule.reason).toBeUndefined();
			}
		}
	});

	test('no rule declares BOTH matchSegment and matchRaw', () => {
		for (const rule of rules) {
			const both = typeof rule.matchSegment === 'function' && typeof rule.matchRaw === 'function';
			expect(both).toBe(false);
		}
	});

	test('every rule declares at least one of matchSegment or matchRaw', () => {
		for (const rule of rules) {
			const some = typeof rule.matchSegment === 'function' || typeof rule.matchRaw === 'function';
			expect(some).toBe(true);
		}
	});
});

describe('expected rule ids', () => {
	const expectedIds = [
		'require-from-path',
		'node-absolute-path',
		'jest-rootdir',
		'test-path-pattern',
		'npm-install-version-pin',
		'npm-with-prefix',
		'npm-run-lint',
		'perl',
		'shell-comment',
		'export-env-var',
		'aws-lambda-update',
		'npx',
		'npx-jest',
		'git-remote',
		'git-stash-readonly',
		'git-mutating-local',
		'sudo',
		'aws-describe',
		'aws-list',
		'aws-get',
		'common-allowed-commands',
		'aws-readonly-subcommands',
		'rain-readonly-subcommands',
		'git-readonly-subcommands',
		'mvn-test-and-npm-test',
		'bash-pdf-script',
		'node-fuzzy-e2e-scripts',
		'npm-install'
	];

	test.each(expectedIds)('rule %s is present in the assembled array', (id) => {
		expect(indexOf(id)).toBeGreaterThanOrEqual(0);
	});
});

describe('ordering invariants', () => {
	test('absolute-path denies precede the common-allowed-commands and fuzzy-e2e groups', () => {
		expect(indexOf('require-from-path')).toBeLessThan(indexOf('common-allowed-commands'));
		expect(indexOf('node-absolute-path')).toBeLessThan(indexOf('node-fuzzy-e2e-scripts'));
	});

	test('require-from-path precedes the common-allowed-commands group (which contains the bare tool names)', () => {
		expect(indexOf('require-from-path')).toBeLessThan(indexOf('common-allowed-commands'));
	});

	test('jest-rootdir precedes the common-allowed-commands group (which contains jest)', () => {
		expect(indexOf('jest-rootdir')).toBeLessThan(indexOf('common-allowed-commands'));
	});

	test('npm-install-version-pin precedes npm-install (so version pins still deny first)', () => {
		expect(indexOf('npm-install-version-pin')).toBeLessThan(indexOf('npm-install'));
	});

	test('npm-run-lint precedes the mvn-test-and-npm-test allow group', () => {
		expect(indexOf('npm-run-lint')).toBeLessThan(indexOf('mvn-test-and-npm-test'));
	});

	test('git-remote deny precedes any git-* allows', () => {
		expect(indexOf('git-remote')).toBeLessThan(indexOf('git-readonly-subcommands'));
	});

	test('git-mutating-local ask precedes the git-readonly-subcommands allow (so commit/checkout/stash ask first)', () => {
		expect(indexOf('git-mutating-local')).toBeLessThan(indexOf('git-readonly-subcommands'));
	});

	test('git-stash-readonly allow precedes git-mutating-local (so stash list/show allow before the stash ask)', () => {
		expect(indexOf('git-stash-readonly')).toBeLessThan(indexOf('git-mutating-local'));
	});

	test('npx-jest precedes npx (so the jest-redirect message wins)', () => {
		expect(indexOf('npx-jest')).toBeLessThan(indexOf('npx'));
	});

	test('AWS generalised describe/list/get rules precede the aws-readonly-subcommands carry-overs', () => {
		expect(indexOf('aws-describe')).toBeLessThan(indexOf('aws-readonly-subcommands'));
		expect(indexOf('aws-list')).toBeLessThan(indexOf('aws-readonly-subcommands'));
		expect(indexOf('aws-get')).toBeLessThan(indexOf('aws-readonly-subcommands'));
	});
});
