function skipNpxFlags(tokens) {
	let i = 1;
	while (i < tokens.length) {
		const t = tokens[i];
		if (t === '-y') {
			i += 1;
			continue;
		}
		if (t === '-p') {
			i += 2;
			continue;
		}
		if (typeof t === 'string' && t.startsWith('--package=')) {
			i += 1;
			continue;
		}
		break;
	}
	return tokens[i];
}

const npxJestRule = {
	id: 'npx-jest',
	decision: 'deny',
	reason: 'Use the `jest` binary from $PATH; jest is on $PATH from the root `package.json`.',
	matchSegment: (tokens) => tokens[0] === 'npx' && skipNpxFlags(tokens) === 'jest'
};

export { npxJestRule };
