const jestRootdirRule = {
	id: 'jest-rootdir',
	decision: 'deny',
	reason: "Do not invoke jest with --rootDir. Change into the target project directory and run 'npm t' instead.",
	matchSegment: (tokens) => tokens[0] === 'jest' && tokens.some((t) => t === '--rootDir' || t.startsWith('--rootDir='))
};

export { jestRootdirRule };
