const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/,
	FLAG_RE = /^-{1,2}[A-Za-z0-9]/,
	MAX_ITERATIONS = 8,

	isAssignmentToken = (token) => ASSIGNMENT_RE.test(token),
	isFlagToken = (token) => token === '--' || FLAG_RE.test(token);

function unwrapWrappers(tokens, wrappers) {
	const original = tokens.slice();
	let current = tokens.slice();
	for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
		while (current.length > 0 && isAssignmentToken(current[0])) {
			current = current.slice(1);
		}
		if (current.length === 0) {
			return original;
		}
		if (!wrappers.includes(current[0])) {
			return current;
		}
		current = current.slice(1);
		while (current.length > 0 && (isFlagToken(current[0]) || isAssignmentToken(current[0]))) {
			current = current.slice(1);
		}
	}
	return current.length === 0 ? original : current;
}

export { unwrapWrappers };
