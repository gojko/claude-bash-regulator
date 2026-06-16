import { describe, test, expect } from '@jest/globals';
import { regexAskRule } from '../src/regex-ask-rule.js';

describe('regexAskRule', () => {
	test('returns a rule with id, decision ask, and the supplied reason', () => {
		const rule = regexAskRule({ id: 'mvn', regex: /^mvn(\s|$)/, reason: 'mvn requires confirmation' });
		expect(rule.id).toBe('mvn');
		expect(rule.decision).toBe('ask');
		expect(rule.reason).toBe('mvn requires confirmation');
	});

	test('defaults reason to the id when reason is omitted', () => {
		const rule = regexAskRule({ id: 'mvn', regex: /^mvn(\s|$)/ });
		expect(rule.reason).toBe('mvn');
	});

	test('matchSegment returns true when the joined-token string matches the regex', () => {
		const rule = regexAskRule({ id: 'git-checkout', regex: /^git\s+checkout(\s|$)/ });
		expect(rule.matchSegment(['git', 'checkout', 'main'])).toBe(true);
	});

	test('matchSegment returns false when the joined-token string does not match', () => {
		const rule = regexAskRule({ id: 'git-checkout', regex: /^git\s+checkout(\s|$)/ });
		expect(rule.matchSegment(['git', 'status'])).toBe(false);
	});

	test('matchSegment returns boolean', () => {
		const rule = regexAskRule({ id: 'mvn', regex: /^mvn(\s|$)/ });
		expect(typeof rule.matchSegment(['mvn'])).toBe('boolean');
		expect(typeof rule.matchSegment(['npm'])).toBe('boolean');
	});

	test('throws when id is missing', () => {
		expect(() => regexAskRule({ regex: /^mvn/ })).toThrow();
	});

	test('throws when regex is missing', () => {
		expect(() => regexAskRule({ id: 'mvn' })).toThrow();
	});
});
