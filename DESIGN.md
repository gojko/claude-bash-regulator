# claude-bash-regulator

A Node.js script that governs every Bash invocation Claude Code attempts. Sits on the `PreToolUse` hook (matcher `Bash`), reads the JSON event on stdin, parses the command into a normalised form, evaluates every segment against an ordered rule list, and emits a `permissionDecision` of `allow`, `ask`, or `deny`.

Replaces the previous three-layer chain (`.claude/settings.json` literal `Bash(...)` globs + `.claude/hooks/block-bash-patterns.sh` + `config/tools/block-bash-patterns.awk`). The single Node script can express token-position rules, inspect compound commands segment-by-segment, strip env-var prefixes, unwrap wrappers like `time` / `nohup` / `xargs`, recurse into `$(...)` / backticks / loop bodies / `sh -c "..."`, and emit deny messages that redirect Claude to the correct invocation form.

## Architecture

```
PreToolUse Bash event (JSON on stdin)
        │
        ▼
bin/regulate.js
        ├─ permission_mode === bypassPermissions  →  exit 2 + stderr (blocking)
        ├─ tool_name !== "Bash"                   →  exit 0 + empty stdout
        │
        ▼
evaluate-command(commandString, rules)
        │
        ▼
parse-command  ──► split-segments (top-level &&/;/||/| split, quote-aware)
        │                  │
        │                  └─► recurse into $(...), backticks, sh -c "...",
        │                       for/while/until loop bodies (re-parse inner)
        │
        ▼  (one normalised segment list)
[strip env-var assignments] ──► [strip redirect targets] ──► [unwrap-wrappers per segment]
        │
        ▼
evaluate-segment(tokens, originalSegmentString, rules)
        │
        └─► walk ordered rules, first match wins per segment
                ├─ matchSegment(tokens) → boolean       (most rules)
                └─ matchRaw(originalCommand) → boolean  (cross-segment rules)
        │
        ▼  (one decision per segment)
merge-decisions(perSegmentDecisions)
        │
        │  Precedence: deny > ask > allow > no-match
        │  Any unmatched segment downgrades to no-match (unless deny/ask wins).
        │  Multiple deny reasons are concatenated (deduplicated, joined "\n\n")
        │   so the agent sees every blocker at once and avoids incremental fixes.
        │
        ▼
bin/regulate.js
        ├─ decision === no-match  →  exit 0 + empty stdout (Claude Code's prompt fires)
        └─ otherwise               →  exit 0 + {"hookSpecificOutput": {...}}
```

## Rule precedence

**Rules are evaluated in order; first match wins per segment.** The order in `src/rules.js` IS the policy. Place specific rules before generic ones.

Worked example — `npx jest` denies with the jest-redirect message, not the generic npx message:

```js
// In src/rules.js — npx-jest sits IMMEDIATELY BEFORE npx
npxJestRule,    // matches `npx jest`, deny with "Use the `jest` binary from $PATH..."
npxRule,        // matches `npx <anything>`, deny with "Project policy forbids `npx`..."
```

`tests/rules.test.js` asserts the ordering invariants that matter (npx-jest before npx, npm-install-version-pin before npm-install, AWS generalised describe/list/get before the aws-readonly-subcommands carry-over, git-remote before any git-\* allows, jest-path-form before bare-jest allow). Reordering a rule that breaks one of these invariants fails the assembly test.

## Compound-command semantics

A command is split into segments at top-level `&&`, `||`, `;`, `|`. Each segment is evaluated independently. The final decision merges via:

| Per-segment decisions present    | Merged decision                                      |
| :------------------------------- | :--------------------------------------------------- |
| Any `deny`                       | `deny` (all deny reasons concatenated, deduplicated) |
| Any `ask` (no `deny`)            | `ask` (all ask reasons concatenated)                 |
| All `allow`                      | `allow`                                              |
| Any `no-match` (no `deny`/`ask`) | `no-match` — the prompt fires                        |

The "any no-match downgrades" rule is intentional: if the regulator cannot classify even one segment of a compound command, the whole thing falls through to the prompt instead of auto-approving the matched portion.

## `bypassPermissions` refusal

If Claude Code is launched with `--permission-mode bypassPermissions`, the hook exits with code 2 (a blocking error per the [PreToolUse docs](https://code.claude.com/docs/en/hooks)) and writes a stderr message. Exit code 2 is used because `permissionDecision: "deny"` may be ignored in bypass mode — the blocking error is more reliable. This applies regardless of the command.

## How to add a new rule

### Trivial regex pattern

Inline a helper call in `src/rules.js`. Three helpers:

```js
// Allow rules carry NO reason (allow decisions need no explanation):
regexAllowRule({ id: 'cat', regex: /^cat(\s|$)/ });

// Ask rules default reason to id (override with `reason` if useful):
regexAskRule({ id: 'mvn', regex: /^mvn(\s|$)/ });

// Deny rules require a reason — non-empty string OR a function of the original command:
regexDenyRule({ id: 'npm-prefix', regex: /\bnpm\b.*--prefix/, reason: 'Do not invoke npm with --prefix.' });
```

For grouped allows (multiple command prefixes sharing one rule entry), use `allowCommands`:

```js
allowCommands({
	id: 'common-allowed-commands',
	commands: ['cat', 'ls', 'grep', 'find', 'awk' /* … */]
});
```

`allowCommands` accepts multi-word prefixes too (`'aws cloudformation'`, `'git diff'`) and respects token boundaries — `'npm t'` does NOT match `'npm test'`.

### Non-trivial rule

For token-position checks, dynamic reasons, or cross-segment logic, create a per-rule module under `src/rules/<rule-id>.js`:

```js
// src/rules/aws-describe.js
const awsDescribeRule = {
	id: 'aws-describe',
	decision: 'allow',
	matchSegment: (tokens) => tokens[0] === 'aws' && /^[a-z0-9]+$/.test(tokens[1] ?? '') && /^describe(-|$)/.test(tokens[2] ?? '')
};

export { awsDescribeRule };
```

Then:

1. Create `tests/rules/<rule-id>.test.js` covering positives, negatives, and edge cases.
2. Import the rule in `src/rules.js` and insert it at the correct precedence.
3. Update `tests/rules.test.js` with any new ordering invariant if the rule overlaps another.

### Cross-segment rules (`matchRaw`)

A rule that needs to inspect more than one segment (e.g., "cd in one segment followed by something in the next") declares `matchRaw(originalCommandString)` instead of `matchSegment(tokens)`. The string passed in is the full original command. A rule may NOT declare both; the assembly test enforces this.

### Reason as a function

For deny rules that should interpolate the original command verbatim into the message (so Claude sees exactly what to ask the user to run):

```js
{
    id: 'git-remote',
    decision: 'deny',
    reason: (command) =>
        `Git operations involving the remote are not allowed inside a Claude Code session. Ask the user to run \`${command}\` directly.`,
    matchSegment: (tokens) => tokens[0] === 'git' && ['push','pull','fetch','clone'].includes(tokens[1])
}
```

The function receives the original COMMAND string (not the segment string). `mergeDecisions` will still concatenate this reason with any other denying-segment reasons.

## Wrappers

`src/wrappers.js` is a plain string array of command names that should be peeled off so the rules see the inner command rather than the wrapper invocation:

```js
export const wrappers = ['time', 'nohup', 'nice', 'stdbuf', 'xargs', 'env'];
```

The unwrapper is flag-greedy: once a wrapper is consumed, every subsequent flag-shaped token (`-x`, `--foo`, `-I{}`, `--flag=value`) and every `VAR=value` token is also consumed, until a regular non-flag non-assignment token is reached. That regular token becomes the inner command (which may itself be a wrapper).

**Trade-off**: a wrapper flag whose argument is passed in SPACE form (e.g., `nice -n 10 make`, `time -o /tmp/x.log make`, `xargs -I {} cmd`, `env -u VAR cmd`) is mis-parsed — the argument token becomes the start of the "inner command", which then doesn't match any rule and downgrades the segment to no-match. The prompt fires. This is a graceful failure (never a false approval) but loses precision. Use glued/equals forms for precise unwrapping: `nice -n10 make`, `time -o/tmp/x.log make`, `xargs -I{} cmd`, `env --unset=VAR cmd`.

`sudo` is deliberately NOT in the wrappers list. Two safeguards work together: the wrapper-exclusion prevents `sudo X` from silently re-evaluating as `X`, and `src/rules/sudo.js` actively denies `sudo` as the first token (with the original command verbatim in the reason). `xargs sudo cmd` and `time sudo cmd` are still denied because `xargs`/`time` are unwrapped FIRST, exposing `sudo` as the inner command — at which point the sudo rule fires.

## Parser limits and the `tooComplex` sentinel

The parser is a single-pass character scanner, not a full bash grammar. Constructs it cannot confidently lex return `{tooComplex: true}`.

**Heredocs** — the bare and quoted opener forms are parsed; remaining variants stay `tooComplex`:

| Form                                        | Behaviour                                                                                                                                                                                                                |
| :------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<<WORD` / `<< WORD`                        | **Parsed.** Opener + body + close stripped from the segment. `$(...)` and `` `...` `` spans in the body are extracted and recursed through the existing substitution path.                                               |
| `<<'WORD'` / `<< 'WORD'`                    | **Parsed.** Body is treated as opaque (bash performs no expansion in single-quoted heredocs), so substitutions inside the body are NOT extracted. Covers the canonical `git commit -m "$(cat <<'EOF' ... EOF)"` pattern. |
| `<<"WORD"`                                  | **Parsed.** Same opaque-body semantics as the single-quoted form.                                                                                                                                                        |
| `<<\WORD`                                   | **Parsed.** Same opaque-body semantics as the single-quoted form.                                                                                                                                                        |
| `<<-WORD` (tab-strip)                       | `tooComplex` → `ask` (deferred — close-line lookup would need to tolerate leading tabs)                                                                                                                                  |
| `<<-'WORD'` (tab-strip + quoted)            | `tooComplex` → `ask` (deferred)                                                                                                                                                                                          |
| `<<WORD` without close                      | `tooComplex` → `ask`                                                                                                                                                                                                     |
| Multi-heredoc `cmd <<A <<B`                 | `tooComplex` → `ask` (out of scope)                                                                                                                                                                                      |
| Indented close, trailing junk on close line | `tooComplex` → `ask` (bash strict semantics: close must be at column 0, line content = delimiter)                                                                                                                        |

Other `tooComplex` triggers:

- Unterminated quotes or `$(...)` / backticks
- (Future) malformed brace expansion

`evaluate-command` converts `tooComplex` into `{decision: 'ask', reason: '...'}` so the user is explicitly confirmed before running anything the regulator doesn't understand. The regulator never silently lets through a command it cannot safely classify.

### Heredoc semantics — worked examples

The body of a parsed unquoted heredoc is opaque to rule matching, **with one exception**: `$(...)` and `` `...` `` substitution spans inside the body ARE extracted and evaluated against the rule list. Bash would expand them at run-time, so the regulator must too — otherwise `cat <<EOF\n$(rm -rf /)\nEOF` would auto-allow on the `cat` rule.

Quoted-delimiter forms (`<<'WORD'`, `<<"WORD"`, `<<\WORD`) are also parsed, but their bodies are fully opaque — bash performs NO expansion in a quoted heredoc, so substitution spans are not extracted. The whole heredoc collapses to its outer segment.

```bash
# Stripped to single segment `cat` → cat allow rule fires → allow.
cat <<EOF
plain body text
EOF

# Outer segment `cat` (allow) + inner segment `rm -rf /` (no rule matches).
# Compound merge: any no-match downgrades the whole command → prompt fires.
# Critical: the inner $(rm -rf /) does NOT auto-allow via the cat rule.
cat <<EOF
$(rm -rf /)
EOF

# Outer segment `cat` + inner segment `npx prettier`.
# npx generic-deny rule fires on the inner → whole command denies.
cat <<EOF
$(npx prettier)
EOF

# Single-quoted delimiter: bash treats body as literal, so $(date) is text.
# Single segment `cat` → allow. Safe because bash itself will not execute $().
cat <<'EOF'
$(date)
EOF

# Same for $(rm -rf /) — quoted body is literal, never executed.
# Single segment `cat` → allow.
cat <<'EOF'
$(rm -rf /)
EOF
```

Backslash-escape inside the body (`\$(escaped)`) is intentionally NOT honoured by the substitution extractor: the regulator over-approximates and treats the span as a substitution to evaluate. False positives demote allow to a prompt; they never demote a prompt to a silent allow.

## Fallthrough behaviour

When the hook emits empty stdout / exit 0 (i.e., no decision), Claude Code's built-in permission flow takes over:

1. Literal `permissions.allow` / `ask` / `deny` arrays in `.claude/settings.json` (currently empty for Bash — the regulator owns Bash policy).
2. Per-developer `.claude/settings.local.json` "always allow" entries.
3. The interactive user prompt.

This is why an unknown command falls through to the prompt rather than auto-approving or auto-denying. The regulator is a project-level policy guard, not a replacement for the prompt.

## Testing

```bash
# Run only the regulator's tests
npm test -- --selectProjects claude-bash-regulator

# Run the full suite (excludes smoke-tests which need a deployed stack)
npm test -- --selectProjects claude-bash-regulator config-tools lib www-scripts www-workbench backend ci-formatter fuzzy-scripts

# Manually spawn the bin with a sample event
echo '{"tool_name":"Bash","permission_mode":"default","tool_input":{"command":"ls -la"}}' \
  | node config/claude-bash-regulator/bin/regulate.js
```

Tests are organised mirror-style:

- `tests/<module>.test.js` — one per `src/<module>.js`
- `tests/rules/<rule-id>.test.js` — one per `src/rules/<rule-id>.js`
- `tests/regulate-bin.test.js` — single end-to-end test that spawns `bin/regulate.js` with table-driven scenarios (parser, engine, every rule, compound merge, bypass refusal, malformed input)
- `tests/rules.test.js` — assembly invariants (no duplicate ids, every expected id present, ordering constraints, every deny has a reason, every allow has NO reason, no rule declares both matchSegment+matchRaw)

## Debugging a command

When a command unexpectedly asks, denies, or falls through to the prompt, run it through `bin/debug.js` to see exactly what the regulator did:

```bash
node config/claude-bash-regulator/bin/debug.js 'cd /tmp && sudo cat /etc/shadow'
# or pipe via stdin:
echo 'cd /tmp && sudo cat /etc/shadow' | node config/claude-bash-regulator/bin/debug.js
```

The output prints:

- The parsed segments (raw tokens, plus the unwrapped tokens after wrapper/env-assignment stripping if they differ from the raw tokens).
- Which rule resolved each segment (id + decision + reason), or `no rule matched` if the segment fell through.
- The merged decision and reason for the whole command.

Worked example — a segment that no rule matches downgrades the entire compound command to `no-match`:

```
$ node config/claude-bash-regulator/bin/debug.js 'while read -r f; do grep foo "$f"; done < list.txt'
parse: 3 segment(s)

segment 0:
  original: "while read -r f"
  tokens: ["while","read","-r","f"]
  no rule matched (23 rules checked)
  decision: no-match
...
merged decision: no-match
```

For `tooComplex` inputs (unbalanced heredocs, unterminated quotes, etc.) the output reports `parse: tooComplex` and `merged decision: ask`.

## Files

```
config/claude-bash-regulator/
├── bin/
│   ├── debug.js                 # Diagnostic — prints parse, per-rule resolution, and merged decision
│   └── regulate.js              # Hook entry — reads stdin, dispatches, emits decision
├── src/
│   ├── allow-commands.js        # Grouped-prefix allow factory
│   ├── evaluate-command.js      # Orchestrator (parse → unwrap → evaluate → merge)
│   ├── evaluate-segment.js      # Per-segment rule walker
│   ├── merge-decisions.js       # Compound-command decision merger
│   ├── parse-command.js         # Full parser (segments + tokenizer + redirect/env strip + recursion)
│   ├── regex-allow-rule.js      # Trivial allow factory (no reason)
│   ├── regex-ask-rule.js        # Trivial ask factory
│   ├── regex-deny-rule.js       # Trivial deny factory (reason required)
│   ├── rules.js                 # Assembled ordered rule array (the policy)
│   ├── split-segments.js        # Top-level operator splitter (quote/sub-aware)
│   ├── unwrap-wrappers.js       # Flag-greedy wrapper unwrapper
│   ├── wrappers.js              # Wrapper command-name list
│   └── rules/                   # Non-trivial per-rule modules (one export per file)
└── tests/
    ├── <module>.test.js
    └── rules/<rule-id>.test.js
```
