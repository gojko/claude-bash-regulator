import { describe, test, expect } from '@jest/globals';
import { evaluateSegment } from '../src/evaluate-segment.js';

describe('evaluateSegment', () => {
	test('returns no-match when rules array is empty', () => {
		expect(evaluateSegment({ tokens: ['ls'], originalSegmentString: 'ls', originalCommandString: 'ls', rules: [] })).toEqual({ decision: 'no-match' });
	});

	test('returns first matching rule decision and reason', () => {
		const rules = [
			{ id: 'a', decision: 'allow', reason: 'A', matchSegment: () => true },
			{ id: 'b', decision: 'deny', reason: 'B', matchSegment: () => true }
		];
		expect(evaluateSegment({ tokens: ['x'], originalSegmentString: 'x', originalCommandString: 'x', rules })).toEqual({ decision: 'allow', reason: 'A', id: 'a' });
	});

	test('skips non-matching rules and returns the next match', () => {
		const rules = [
			{ id: 'a', decision: 'allow', reason: 'A', matchSegment: () => false },
			{ id: 'b', decision: 'deny', reason: 'B', matchSegment: () => true }
		];
		expect(evaluateSegment({ tokens: ['x'], originalSegmentString: 'x', originalCommandString: 'x', rules })).toEqual({ decision: 'deny', reason: 'B', id: 'b' });
	});

	test('matchSegment receives tokens', () => {
		const seen = [];
		const rules = [{ id: 'r', decision: 'allow', reason: 'R', matchSegment: (tokens) => { seen.push(tokens); return true; } }];
		evaluateSegment({ tokens: ['a', 'b'], originalSegmentString: 'a b', originalCommandString: 'a b && c', rules });
		expect(seen[0]).toEqual(['a', 'b']);
	});

	test('matchRaw rules receive the original COMMAND string (not the segment)', () => {
		const seen = [];
		const rules = [{ id: 'r', decision: 'deny', reason: 'R', matchRaw: (cmd) => { seen.push(cmd); return true; } }];
		evaluateSegment({ tokens: ['c'], originalSegmentString: 'c', originalCommandString: 'a && c', rules });
		expect(seen[0]).toBe('a && c');
	});

	test('reason as a function is invoked with the original command string', () => {
		const rules = [{ id: 'r', decision: 'deny', reason: (cmd) => `blocked: ${cmd}`, matchSegment: () => true }];
		const result = evaluateSegment({ tokens: ['x'], originalSegmentString: 'x', originalCommandString: 'x --force', rules });
		expect(result).toEqual({ decision: 'deny', reason: 'blocked: x --force', id: 'r' });
	});

	test('throws when a rule declares both matchSegment and matchRaw', () => {
		const rules = [{ id: 'bad', decision: 'deny', reason: 'r', matchSegment: () => true, matchRaw: () => true }];
		expect(() => evaluateSegment({ tokens: ['x'], originalSegmentString: 'x', originalCommandString: 'x', rules })).toThrow(/bad/);
	});

	test('throws when a rule declares neither matchSegment nor matchRaw', () => {
		const rules = [{ id: 'bad', decision: 'deny', reason: 'r' }];
		expect(() => evaluateSegment({ tokens: ['x'], originalSegmentString: 'x', originalCommandString: 'x', rules })).toThrow(/bad/);
	});
});
