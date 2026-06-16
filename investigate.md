# Regulator — Diagnose Why a Bash Command Is Not Auto-Allowed

Paste a Bash command and the assistant will run it through `claude-bash-regulator`'s `debug.js`, explain how the command is parsed segment-by-segment, identify which rule (if any) blocks an auto-allow, and propose a minimal, TDD-driven change that would let it through.

## Arguments

`$ARGUMENTS` — the full Bash command to diagnose. Paste exactly as you would run it. Whitespace, quotes, pipes, redirects, and `&&`/`;` chains are all welcome.

If `$ARGUMENTS` is empty, ask the user for the command before proceeding.

## Process

### Step 1: Run the debugger

Write the command into a temp file (avoids shell-quoting headaches), then pipe it through `debug.js`:

1. `mkdir -p /tmp/claude-transient`
2. Use the `Write` tool to put `$ARGUMENTS` into `/tmp/claude-transient/regulator-input.txt` verbatim (no trailing newline tricks needed — `debug.js` strips a trailing `\n`).
3. Run the debugger via stdin:

```
node config/claude-bash-regulator/bin/debug.js < /tmp/claude-transient/regulator-input.txt
```

Use the Bash tool with a relative `node` path — the regulator denies absolute-path `node` invocations.

### Step 2: Read the output

`debug.js` prints, for each segment:

- the original segment text and tokenised form (and the unwrapped tokens, if wrappers like `time` / `xargs` / `env` were peeled),
- either `resolved by rule: <id> (N/M rules checked)` plus `decision: allow|ask|deny`,
- or `no rule matched (M rules checked)` plus `decision: no-match`.

At the end it prints `merged decision: ...`. Precedence is `deny > ask > allow > no-match`, and any single `no-match` segment downgrades the whole compound command to `no-match` (i.e. the user prompt fires).

### Step 3: Classify the blocker

Read the merged decision and the per-segment trace, then classify the blocker into ONE of these categories:

| Merged decision | Likely cause                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `allow`         | Already auto-allowed — tell the user and stop. No change needed.                                                                                                                                                                                                                                                                                                                                                                                        |
| `deny`          | A rule actively forbids the command. Read its `reason`. The fix is usually for the user to change the invocation form (e.g. `npx jest` → `jest`, `git push` → ask the user to run it directly). Do NOT propose loosening a deny rule unless the user asks; instead, report which rule denied, the reason, and the recommended alternative invocation.                                                                                                   |
| `ask`           | A rule defers to a manual prompt. Identify which rule. If the user wants auto-allow, propose narrowing the ask rule or adding a more specific allow before it.                                                                                                                                                                                                                                                                                          |
| `no-match`      | No rule covers this command. This is the most common case. Identify which segment fell through and what the smallest extension is — usually one of: adding the command name to `allowCommands({ id: 'common-allowed-commands' })`, adding a subcommand to an existing `regexAllowRule` alternation (e.g. `git-readonly-subcommands`, `aws-readonly-subcommands`), or — for token-position logic — a new per-rule module under `src/rules/<rule-id>.js`. |
| `tooComplex`    | The parser could not safely lex the command (unbalanced quote, unsupported heredoc, etc.). Quote the parser's reason verbatim and explain to the user that the regulator intentionally falls through to a manual prompt for anything it cannot classify.                                                                                                                                                                                                |

### Step 4: Locate the relevant rule code

Open `config/claude-bash-regulator/src/rules.js` to see the ordered rule list. For inline rules (`regexAllowRule`, `allowCommands`, `regexAskRule`, `regexDenyRule`) the definition is right there. For token-position rules, open the matching `config/claude-bash-regulator/src/rules/<id>.js`.

When proposing a regex tweak, ALWAYS quote the current regex and show the proposed regex with the single-character / single-alternative delta highlighted.

When proposing a new entry in `allowCommands`, name exactly which `id:` block it belongs in (`common-allowed-commands`, `aws-readonly-subcommands`, `mvn-test-and-npm-test`, …).

When proposing a brand-new rule module, sketch the `{ id, decision, matchSegment }` shape and state which existing rule it must precede or follow (precedence is policy — `tests/rules.test.js` enforces ordering invariants).

### Step 5: Propose the change (do NOT apply yet)

Present a short proposal to the user containing:

1. **What's happening** — one sentence per segment, in plain language.
2. **Why it's not auto-allowed** — which rule (or absence of one) is responsible.
3. **Smallest viable change** — pseudo-diff or the exact regex/string edit, with file path and line number.
4. **Test plan (TDD)** — name the existing test file (usually `config/claude-bash-regulator/tests/regulate-bin.test.js` for command-level cases, or `tests/rules/<id>.test.js` for per-rule cases) and the specific `test.each` array or describe block you would extend. Include the new test case strings verbatim.
5. **Risk note** — flag any over-broad implication of the change (e.g. "this also allows `git log -p` which may show diff content from anywhere in the repo"). If the proposal narrows or broadens an existing rule, name at least one example the change deliberately includes and one it deliberately still excludes.

Then ask the user with `AskUserQuestion` whether to apply the change. Offer:

- **Apply the change (TDD)** — write the failing test first, run jest to confirm RED, edit the rule, re-run jest, then run the full `--selectProjects claude-bash-regulator` suite to confirm green.
- **Apply without test** — only if the user is in a hurry; warn that `tests/rules.test.js`'s ordering invariants may still need updating manually.
- **Don't apply** — diagnostic only.

### Step 6: If applying — TDD cycle

When the user opts to apply:

1. **RED**: edit the appropriate test file FIRST. Run only the affected describe/test blocks:
   ```
   npm test -- --selectProjects claude-bash-regulator -t "<describe-or-test-name>"
   ```
   Confirm the new case fails with the expected `Received: "no-match"` / `"ask"` / `"deny"`.
2. **GREEN**: edit `src/rules.js` (or the per-rule file). Make the smallest possible change.
3. Re-run the focused test → confirm green.
4. Run the full project suite:
   ```
   npm test -- --selectProjects claude-bash-regulator
   ```
   All tests must pass. If `tests/rules.test.js` ordering invariants fail, fix the order rather than the assertion.
5. Re-run `debug.js` on the original `$ARGUMENTS` and confirm the merged decision is now `allow`.

### Step 7: Report

After applying, summarise in 3–5 lines: the rule file edited, the test case added, the number of regulator tests passing, and the new `merged decision` from `debug.js`. Do NOT commit unless the user explicitly asks — this is a regulator config change and may warrant batching with related rules.

## Important Rules

- **Never propose loosening a `deny` rule without explicit user direction.** The deny rules exist for safety; the default response to a deny is "ask the user to run the command directly," not "make the regulator allow it."
- **Always run the debugger first.** Do not guess at the parse or the merged decision from the command shape alone — `debug.js` is the source of truth.
- **Prefer the narrowest possible change.** A single new subcommand in an existing alternation beats a new top-level rule. A new entry in `common-allowed-commands` beats a bespoke `regexAllowRule`. A bespoke rule beats touching the parser.
- **Use stdin, not argv, to pass the command to `debug.js`.** Pipes via `< file` avoid all the bash-quoting edge cases that the very tool you're debugging is designed to handle safely.
- **Run `node` with a relative path** (`node config/...`). The regulator denies absolute-path `node` invocations and your own diagnostic would be blocked.
- **TDD is mandatory** when applying a change. Red → Green → full suite. No exceptions, no skipping the linter (`pretest` runs eslint).
- **Do NOT commit automatically.** Regulator changes touch shared policy; the user decides when to commit.
