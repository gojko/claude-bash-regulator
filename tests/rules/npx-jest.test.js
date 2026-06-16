import { describe, test, expect } from '@jest/globals';
import { npxJestRule } from '../../src/rules/npx-jest.js';

describe('npxJestRule', () => {
	test('matches npx jest', () => {
		expect(npxJestRule.matchSegment(['npx', 'jest'])).toBe(true);
	});

	test('matches npx jest with arguments', () => {
		expect(npxJestRule.matchSegment(['npx', 'jest', 'tests/foo.test.js', '--coverage'])).toBe(true);
	});

	test('matches npx -y jest', () => {
		expect(npxJestRule.matchSegment(['npx', '-y', 'jest', '--listTests'])).toBe(true);
	});

	test('matches npx -p some-pkg jest', () => {
		expect(npxJestRule.matchSegment(['npx', '-p', 'some-pkg', 'jest'])).toBe(true);
	});

	test('matches npx --package=foo jest', () => {
		expect(npxJestRule.matchSegment(['npx', '--package=foo', 'jest'])).toBe(true);
	});

	test('does not match npx prettier (generic npx falls through to npxRule)', () => {
		expect(npxJestRule.matchSegment(['npx', 'prettier'])).toBe(false);
	});

	test('does not match npx -y create-react-app foo', () => {
		expect(npxJestRule.matchSegment(['npx', '-y', 'create-react-app', 'foo'])).toBe(false);
	});

	test('does not match bare jest (no npx)', () => {
		expect(npxJestRule.matchSegment(['jest'])).toBe(false);
	});

	test('reason matches the jest-path-form redirect message verbatim', () => {
		expect(npxJestRule.decision).toBe('deny');
		expect(npxJestRule.reason).toBe('Use the `jest` binary from $PATH; jest is on $PATH from the root `package.json`.');
	});
});
