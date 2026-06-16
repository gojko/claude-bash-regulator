import { readFileSync } from 'node:fs';
import process from 'node:process';
import { parseCommand } from '../src/parse-command.js';
import { unwrapWrappers } from '../src/unwrap-wrappers.js';
import { wrappers } from '../src/wrappers.js';
import { evaluateSegment } from '../src/evaluate-segment.js';
import { mergeDecisions } from '../src/merge-decisions.js';
import { rules } from '../src/rules.js';

function formatTokens(tokens) {
	return JSON.stringify(tokens);
}

function ruleMatches(rule, tokens, originalCommandString) {
	if (typeof rule.matchSegment === 'function') {
		return rule.matchSegment(tokens);
	}
	if (typeof rule.matchRaw === 'function') {
		return rule.matchRaw(originalCommandString);
	}
	return false;
}

function tracePerRuleResolution(tokens, originalCommandString) {
	const trace = [];
	for (const rule of rules) {
		const matched = ruleMatches(rule, tokens, originalCommandString);
		trace.push({ id: rule.id, decision: rule.decision, matched });
		if (matched) {
			return trace;
		}
	}
	return trace;
}

function describeSegment({ segment, index, command, lines }) {
	const rawTokens = segment.tokens,
		unwrapped = unwrapWrappers(rawTokens, wrappers),
		decision = evaluateSegment({ tokens: unwrapped, originalCommandString: command, rules }),
		trace = tracePerRuleResolution(unwrapped, command);
	lines.push(`segment ${index}:`);
	lines.push(`  original: ${JSON.stringify(segment.originalText)}`);
	lines.push(`  tokens: ${formatTokens(rawTokens)}`);
	if (formatTokens(unwrapped) !== formatTokens(rawTokens)) {
		lines.push(`  unwrapped: ${formatTokens(unwrapped)}`);
	}
	const checked = trace.length,
		matchedRule = trace.find((t) => t.matched);
	if (matchedRule) {
		lines.push(`  resolved by rule: ${matchedRule.id} (${checked}/${rules.length} rules checked)`);
		lines.push(`  decision: ${decision.decision}`);
		if (decision.reason) {
			lines.push(`  reason: ${decision.reason}`);
		}
	} else {
		lines.push(`  no rule matched (${rules.length} rules checked)`);
		lines.push(`  decision: ${decision.decision}`);
	}
}

function describePerSegmentDecisions(parsed, command) {
	const perSegmentDecisions = parsed.segments.map((segment) => {
		const unwrapped = unwrapWrappers(segment.tokens, wrappers);
		if (unwrapped.length === 0) {
			return { decision: 'no-match' };
		}
		return evaluateSegment({ tokens: unwrapped, originalCommandString: command, rules });
	});
	return perSegmentDecisions;
}

function debugCommand(command) {
	const lines = [`command: ${command}`, ''],
		parsed = parseCommand(command);
	if (parsed.tooComplex) {
		lines.push('parse: tooComplex (heredoc, unbalanced quote, brace expansion, or similar)');
		lines.push('merged decision: deny');
		lines.push('reason: claude-bash-regulator: command contains a construct that could not be safely parsed (heredoc, unbalanced quote, brace expansion, or similar). Analyze it with `node $VTT/app/config/claude-bash-regulator/bin/debug.js` and simplify the command before trying again.');
		return lines.join('\n');
	}
	lines.push(`parse: ${parsed.segments.length} segment(s)`);
	lines.push('');
	for (let index = 0; index < parsed.segments.length; index += 1) {
		describeSegment({ segment: parsed.segments[index], index, command, lines });
		lines.push('');
	}
	const merged = mergeDecisions(describePerSegmentDecisions(parsed, command));
	lines.push(`merged decision: ${merged.decision}`);
	if (merged.reason) {
		lines.push(`merged reason: ${merged.reason}`);
	}
	return lines.join('\n');
}

function readStdin() {
	try {
		return readFileSync(0, 'utf8');
	} catch {
		return '';
	}
}

function resolveCommand(argv) {
	if (argv.length > 2) {
		return argv.slice(2).join(' ');
	}
	if (process.stdin.isTTY) {
		return '';
	}
	return readStdin().replace(/\n$/, '');
}

const main = () => {
	const command = resolveCommand(process.argv);
	if (!command) {
		process.stderr.write('usage: debug.js <command>  (or pipe command via stdin)\n');
		process.exit(1);
	}
	process.stdout.write(debugCommand(command) + '\n');
	process.exit(0);
};

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}

export { debugCommand };
