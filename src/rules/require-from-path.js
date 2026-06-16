const pathStem = (token) => token.slice(token.lastIndexOf('/') + 1).replace(/\.(c|m)?js$/, '');

function isPathForm(token, commands) {
	if (typeof token !== 'string' || !token.includes('/')) {
		return false;
	}
	return commands.includes(pathStem(token));
}

function offendingTool(command, commands) {
	const offender = command.split(/\s+/).find((token) => isPathForm(token, commands));
	return offender ? pathStem(offender) : 'the tool';
}

function requireFromPath({ id, commands }) {
	return {
		id,
		decision: 'deny',
		reason: (command) =>
			`Use \`${offendingTool(command, commands)}\` from $PATH directly; it is on $PATH from the root \`package.json\`. Do not invoke it via a path prefix (\`./\`, \`../\`, absolute, or \`node_modules/.bin/\`).`,
		matchSegment: (tokens) => isPathForm(tokens[0], commands)
	};
}

export { requireFromPath };
