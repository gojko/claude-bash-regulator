Claude Bash Regulator
---------------------

Node.js script that can be used to automate approval/rejection of Bash commands
with Claude as a pre-tool use hook, designed to minimize human involvement during
build phases and reduce approval fatigue. 

The big difference between this approach and just using Claude settings is that this approach
does in-depth parsing of complex Bash commands (such as loops, `$()` executions, `xargs` etc and
propagates approval/rejection decisions.

- [bin/regulate.js](bin/regulate.js) the main script to use as a hook
- [src/rules.js](src/rules.js) the main rules definition file - this is something claude will modify heavily for you
- [investigate.md](investigate.md) a Claude command that can investigate a Bash command and propose what needs to change in the rules to approve or reject it, and modify the rules definition

## How to use it


1. Add a pre-tool use hook to your `.claude/settings.json` file

```js
    "hooks": {
                "PreToolUse": [
                        {
                                "matcher": "Bash",
                                "hooks": [
                                        {
                                                "type": "command",
                                                "command": "node $CLAUDE_PROJECT_DIR/config/claude-bash-regulator/bin/regulate.js"
                                        }
                                ]
                        }
                ],
```

2. ask Claude to go through your existing settings and replicate the pre-approved commands, cleaning up the rules

3. every time Claude asks for approval of a command that should be approved or rejected, us the investigate skill to figure out what in addition needs to be added to the rules, so Claude doesn't ask about it again.
