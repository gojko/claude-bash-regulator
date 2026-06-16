const npmInstallRule = {
	id: 'npm-install',
	decision: 'ask',
	reason: "Confirm before running 'npm install'. The version-pin guard still denies 'npm install pkg@version'.",
	matchSegment: (tokens) => tokens[0] === 'npm' && (tokens[1] === 'install' || tokens[1] === 'i')
};

export { npmInstallRule };
