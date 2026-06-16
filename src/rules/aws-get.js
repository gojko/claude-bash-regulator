const awsGetRule = {
	id: 'aws-get',
	decision: 'allow',
	matchSegment: (tokens) =>
		tokens[0] === 'aws' &&
		typeof tokens[1] === 'string' &&
		/^[a-z0-9]+$/.test(tokens[1]) &&
		typeof tokens[2] === 'string' &&
		/^get(-|$)/.test(tokens[2])
};

export { awsGetRule };
