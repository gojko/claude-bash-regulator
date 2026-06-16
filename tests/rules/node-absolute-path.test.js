import { describe, test, expect } from '@jest/globals';
import { nodeAbsolutePathRule } from '../../src/rules/node-absolute-path.js';

describe('nodeAbsolutePathRule', () => {
	test('matches node with an absolute path script', () => {
		expect(nodeAbsolutePathRule.matchSegment(['node', '/tmp/x.js'])).toBe(true);
	});

	test('exempts scripts under /tmp/claude-transient/', () => {
		expect(nodeAbsolutePathRule.matchSegment(['node', '/tmp/claude-transient/probe.js'])).toBe(false);
	});

	test('exempts /tmp/claude-transient/ with extra arguments', () => {
		expect(nodeAbsolutePathRule.matchSegment(['node', '/tmp/claude-transient/foo.js', 'arg1'])).toBe(false);
	});

	test('allows node with a relative path', () => {
		expect(nodeAbsolutePathRule.matchSegment(['node', '.claude/scripts/foo.js'])).toBe(false);
	});

	test('does not match a binary whose name contains "node"', () => {
		expect(nodeAbsolutePathRule.matchSegment(['mynode', '/tmp/x.js'])).toBe(false);
	});

	test('does not match bare node (no script argument)', () => {
		expect(nodeAbsolutePathRule.matchSegment(['node'])).toBe(false);
	});

	test('decision is deny and id is node-absolute-path', () => {
		expect(nodeAbsolutePathRule.decision).toBe('deny');
		expect(nodeAbsolutePathRule.id).toBe('node-absolute-path');
	});

	test('reason mentions /tmp/claude-transient/ exemption', () => {
		expect(nodeAbsolutePathRule.reason).toMatch(/\/tmp\/claude-transient\//);
	});
});
