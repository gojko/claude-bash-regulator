import { describe, test, expect } from '@jest/globals';
import { awsGetRule } from '../../src/rules/aws-get.js';

describe('awsGetRule', () => {
	test('matches aws s3 get-object', () => {
		expect(awsGetRule.matchSegment(['aws', 's3', 'get-object', '--bucket', 'b', '--key', 'k', '/tmp/out'])).toBe(true);
	});

	test('matches aws sts get-caller-identity', () => {
		expect(awsGetRule.matchSegment(['aws', 'sts', 'get-caller-identity'])).toBe(true);
	});

	test('does not match a hyphenated service name', () => {
		expect(awsGetRule.matchSegment(['aws', 'service-foo', 'get-thing'])).toBe(false);
	});

	test('does not match a non-get verb', () => {
		expect(awsGetRule.matchSegment(['aws', 's3', 'put-object'])).toBe(false);
	});

	test('decision is allow, no reason', () => {
		expect(awsGetRule.decision).toBe('allow');
		expect(awsGetRule.reason).toBeUndefined();
	});
});
