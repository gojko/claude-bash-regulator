import { describe, test, expect } from '@jest/globals';
import { awsListRule } from '../../src/rules/aws-list.js';

describe('awsListRule', () => {
	test('matches aws lambda list-functions', () => {
		expect(awsListRule.matchSegment(['aws', 'lambda', 'list-functions'])).toBe(true);
	});

	test('matches aws sqs list-queues', () => {
		expect(awsListRule.matchSegment(['aws', 'sqs', 'list-queues'])).toBe(true);
	});

	test('does not match a hyphenated service name (cognito-idp)', () => {
		expect(awsListRule.matchSegment(['aws', 'cognito-idp', 'list-users'])).toBe(false);
	});

	test('does not match a non-list verb', () => {
		expect(awsListRule.matchSegment(['aws', 'lambda', 'invoke'])).toBe(false);
	});

	test('decision is allow, no reason', () => {
		expect(awsListRule.decision).toBe('allow');
		expect(awsListRule.reason).toBeUndefined();
	});
});
