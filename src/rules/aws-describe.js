const awsDescribeRule = {
	id: 'aws-describe',
	decision: 'allow',
	matchSegment: (tokens) =>
		tokens[0] === 'aws' &&
		typeof tokens[1] === 'string' &&
		/^[a-z0-9]+$/.test(tokens[1]) &&
		typeof tokens[2] === 'string' &&
		/^describe(-|$)/.test(tokens[2])
};

export { awsDescribeRule };
