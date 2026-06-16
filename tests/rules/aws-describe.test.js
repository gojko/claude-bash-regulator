import { describe, test, expect } from '@jest/globals';
import { awsDescribeRule } from '../../src/rules/aws-describe.js';

describe('awsDescribeRule', () => {
	test('matches aws <service> describe-*', () => {
		expect(awsDescribeRule.matchSegment(['aws', 'dynamodb', 'describe-tables'])).toBe(true);
	});

	test('matches with extra arguments', () => {
		expect(awsDescribeRule.matchSegment(['aws', 'dynamodb', 'describe-table', '--table-name', 'X'])).toBe(true);
	});

	test('matches aws lambda describe-function', () => {
		expect(awsDescribeRule.matchSegment(['aws', 'lambda', 'describe-function'])).toBe(true);
	});

	test('does not match a hyphenated service name', () => {
		expect(awsDescribeRule.matchSegment(['aws', 'application-autoscaling', 'describe-scaling-policies'])).toBe(false);
	});

	test('does not match when global flags precede the service', () => {
		expect(awsDescribeRule.matchSegment(['aws', '--profile', 'foo', 'dynamodb', 'describe-tables'])).toBe(false);
	});

	test('does not match non-describe verbs', () => {
		expect(awsDescribeRule.matchSegment(['aws', 'dynamodb', 'put-item'])).toBe(false);
	});

	test('decision is allow, no reason', () => {
		expect(awsDescribeRule.decision).toBe('allow');
		expect(awsDescribeRule.reason).toBeUndefined();
	});
});
