import { parseCommand } from './parse-command.js';
import { unwrapWrappers } from './unwrap-wrappers.js';
import { wrappers } from './wrappers.js';
import { evaluateSegment } from './evaluate-segment.js';
import { mergeDecisions } from './merge-decisions.js';

function evaluateCommand({ command, rules }) {
	const parsed = parseCommand(command);
	if (parsed.tooComplex) {
		return {
			decision: 'deny',
			reason: 'claude-bash-regulator: command contains a construct that could not be safely parsed (heredoc, unbalanced quote, brace expansion, or similar). Analyze it with `node $VTT/app/config/claude-bash-regulator/bin/debug.js` and simplify the command before trying again.'
		};
	}
	const perSegmentDecisions = parsed.segments.map((segment) => {
		const unwrapped = unwrapWrappers(segment.tokens, wrappers);
		if (unwrapped.length === 0) {
			return { decision: 'no-match' };
		}
		return evaluateSegment({ tokens: unwrapped, originalCommandString: command, rules });
	});
	return mergeDecisions(perSegmentDecisions);
}

export { evaluateCommand };
