import { describe, test, expect } from '@jest/globals';
import { jestRootdirRule } from '../../src/rules/jest-rootdir.js';

describe('jestRootdirRule', () => {
	test('matches jest --rootDir', () => {
		expect(jestRootdirRule.matchSegment(['jest', '--rootDir', 'backend/foo'])).toBe(true);
	});

	test('matches jest with --rootDir among other args', () => {
		expect(jestRootdirRule.matchSegment(['jest', 'tests/x.js', '--rootDir', '.'])).toBe(true);
	});

	test('matches jest --rootDir=path (equals form)', () => {
		expect(jestRootdirRule.matchSegment(['jest', '--rootDir=backend'])).toBe(true);
	});

	test('does not match plain jest invocation', () => {
		expect(jestRootdirRule.matchSegment(['jest', 'tests/foo.test.js'])).toBe(false);
	});

	test('does not match --rootDir on a non-jest command', () => {
		expect(jestRootdirRule.matchSegment(['something-else', '--rootDir', '.'])).toBe(false);
	});
});
