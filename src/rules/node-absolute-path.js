const nodeAbsolutePathRule = {
	id: 'node-absolute-path',
	decision: 'deny',
	reason:
		'Do not run node scripts using absolute paths. Use a relative path instead (e.g., node .claude/scripts/foo.js). Scripts under /tmp/claude-transient/ are exempt.',
	matchSegment: (tokens) =>
		tokens[0] === 'node' &&
		typeof tokens[1] === 'string' &&
		tokens[1].startsWith('/') &&
		!tokens[1].startsWith('/tmp/claude-transient/')
};

export { nodeAbsolutePathRule };
