function ruleMatches(rule, tokens, originalCommandString) {
	const hasSegment = typeof rule.matchSegment === 'function',
	 hasRaw = typeof rule.matchRaw === 'function';
	if (hasSegment && hasRaw) {
		throw new Error(`rule '${rule.id}' declares both matchSegment and matchRaw`);
	}
	if (!hasSegment && !hasRaw) {
		throw new Error(`rule '${rule.id}' declares neither matchSegment nor matchRaw`);
	}
	if (hasSegment) {
		return rule.matchSegment(tokens);
	}
	return rule.matchRaw(originalCommandString);
}

function resolveReason(reason, originalCommandString) {
	if (typeof reason === 'function') {
		return reason(originalCommandString);
	}
	return reason;
}

function evaluateSegment({ tokens, originalCommandString, rules }) {
	for (const rule of rules) {
		if (ruleMatches(rule, tokens, originalCommandString)) {
			return { decision: rule.decision, reason: resolveReason(rule.reason, originalCommandString), id: rule.id };
		}
	}
	return { decision: 'no-match' };
}

export { evaluateSegment };
