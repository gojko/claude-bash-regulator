import { describe, test, expect } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'regulate.js');

const runBin = (stdinPayload) => {
	const result = spawnSync('node', [BIN], { input: stdinPayload, encoding: 'utf8' });
	return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
};

describe('regulate.js bin entry', () => {
	describe('bypassPermissions refusal', () => {
		test('exits with code 2 and emits stderr when permission_mode is bypassPermissions', () => {
			const result = runBin(
				JSON.stringify({
					tool_name: 'Bash',
					permission_mode: 'bypassPermissions',
					tool_input: { command: 'ls' }
				})
			);
			expect(result.exitCode).toBe(2);
			expect(result.stderr).toMatch(/bypassPermissions mode is not allowed/);
			expect(result.stdout).toBe('');
		});

		test('bypassPermissions blocks regardless of the command', () => {
			const result = runBin(
				JSON.stringify({
					tool_name: 'Bash',
					permission_mode: 'bypassPermissions',
					tool_input: { command: 'cat /etc/hosts' }
				})
			);
			expect(result.exitCode).toBe(2);
			expect(result.stdout).toBe('');
		});
	});

	describe('non-Bash tools', () => {
		test('exits 0 with empty stdout when tool_name is not Bash', () => {
			const result = runBin(
				JSON.stringify({
					tool_name: 'Edit',
					permission_mode: 'default',
					tool_input: { file_path: '/tmp/x.txt' }
				})
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe('');
		});

		test('does not apply bypassPermissions check to non-Bash tools', () => {
			const result = runBin(
				JSON.stringify({
					tool_name: 'Edit',
					permission_mode: 'bypassPermissions',
					tool_input: { file_path: '/tmp/x.txt' }
				})
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe('');
		});
	});

	describe('Bash tool decision plumbing', () => {
		test('exits 0 with empty stdout when no rule matches (falls through to prompt)', () => {
			const result = runBin(
				JSON.stringify({
					tool_name: 'Bash',
					permission_mode: 'default',
					tool_input: { command: 'totally-unknown-binary --arg' }
				})
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe('');
		});

		test('tooComplex parser result emits deny JSON pointing at debug.js (heredoc missing close)', () => {
			const result = runBin(
				JSON.stringify({
					tool_name: 'Bash',
					permission_mode: 'default',
					tool_input: { command: 'cat <<EOF' }
				})
			);
			expect(result.exitCode).toBe(0);
			const parsed = JSON.parse(result.stdout);
			expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
			expect(parsed.hookSpecificOutput.permissionDecisionReason).toMatch(/could not be safely parsed/);
			expect(parsed.hookSpecificOutput.permissionDecisionReason).toMatch(/debug\.js/);
		});
	});

	describe('malformed input', () => {
		test('exits non-zero (not 2) with stderr message when stdin is not valid JSON', () => {
			const result = runBin('not-json');
			expect(result.exitCode).not.toBe(0);
			expect(result.exitCode).not.toBe(2);
			expect(result.stderr).toMatch(/invalid JSON on stdin/);
			expect(result.stdout).toBe('');
		});

		test('exits non-zero (not 2) with stderr message when an internal error is thrown', () => {
			const result = runBin(
				JSON.stringify({
					tool_name: 'Bash',
					permission_mode: 'default',
					tool_input: {}
				})
			);
			expect(result.exitCode).not.toBe(0);
			expect(result.exitCode).not.toBe(2);
			expect(result.stderr).toMatch(/^claude-bash-regulator: /);
			expect(result.stdout).toBe('');
		});
	});
});

const decisionOf = (stdinPayload) => {
	const cmd = { tool_name: 'Bash', permission_mode: 'default', tool_input: { command: stdinPayload } };
	const result = spawnSync('node', [BIN], { input: JSON.stringify(cmd), encoding: 'utf8' });
	if (result.stdout === '') {
		return { decision: 'no-match' };
	}
	const payload = JSON.parse(result.stdout);
	return {
		decision: payload.hookSpecificOutput.permissionDecision,
		reason: payload.hookSpecificOutput.permissionDecisionReason
	};
};

describe('line-continuation chains (backslash-newline)', () => {
	test('allows a TEST_ENVIRONMENT=... node <relative script> chain joined with && \\<newline>', () => {
		const command = [
			'TEST_ENVIRONMENT=ci node backend/scripts/backfill-user-membership-status.js --dry-run && \\',
			'echo "=== live ===" && \\',
			'TEST_ENVIRONMENT=ci node backend/scripts/backfill-user-membership-status.js --verify'
		].join('\n');
		expect(decisionOf(command).decision).toBe('allow');
	});
});

describe('Phase 2 carry-over: awk patterns reproduced end-to-end via the bin', () => {
	describe('node absolute-path', () => {
		test('blocks node with an absolute path script', () => {
			const { decision, reason } = decisionOf('node /tmp/x.js');
			expect(decision).toBe('deny');
			expect(reason).toMatch(/Do not run node scripts using absolute paths/);
		});

		test('blocks node with absolute path after a chained command', () => {
			expect(decisionOf('cd /tmp && node /tmp/x.js').decision).toBe('deny');
		});

		test('exempts scripts under /tmp/claude-transient/ (deny does not fire; common-allowed-commands matches node)', () => {
			expect(decisionOf('node /tmp/claude-transient/probe.js').decision).toBe('allow');
		});

		test('exempts /tmp/claude-transient/ after a chained command (cd allows + node exempt → allow)', () => {
			const result = decisionOf('cd app && node /tmp/claude-transient/foo.js arg1');
			expect(['allow', 'no-match']).toContain(result.decision);
		});

		test('does not match a binary whose name contains "node"', () => {
			expect(decisionOf('mynode /tmp/x.js').decision).toBe('no-match');
		});
	});

	describe('jest --rootDir', () => {
		test('blocks jest invoked with --rootDir', () => {
			const { decision, reason } = decisionOf('jest --rootDir backend/foo');
			expect(decision).toBe('deny');
			expect(reason).toMatch(/Do not invoke jest with --rootDir/);
		});

		test('allows plain jest invocation', () => {
			expect(decisionOf('jest tests/foo.test.js').decision).toBe('allow');
		});
	});

	describe('eslint path-form', () => {
		test('blocks eslint invoked through an absolute path', () => {
			const { decision, reason } = decisionOf('/usr/local/bin/eslint --fix src');
			expect(decision).toBe('deny');
			expect(reason).toMatch(/Use `eslint` from \$PATH/);
		});

		test('blocks eslint invoked through node_modules/.bin', () => {
			const { decision, reason } = decisionOf('node_modules/.bin/eslint .');
			expect(decision).toBe('deny');
			expect(reason).toMatch(/Use `eslint` from \$PATH/);
		});

		test('blocks eslint invoked through a relative ./ path', () => {
			expect(decisionOf('./eslint src').decision).toBe('deny');
		});

		test('allows eslint resolved from $PATH', () => {
			expect(decisionOf('eslint src').decision).toBe('allow');
		});

		test('allows eslint with an absolute-path file argument', () => {
			expect(decisionOf('eslint /tmp/foo.js').decision).toBe('allow');
		});

		test('does not match a cat invocation containing /eslint in an argument', () => {
			expect(decisionOf('cat /tmp/eslint.log').decision).toBe('allow');
		});
	});

	describe('prettier path-form', () => {
		test('blocks prettier invoked through an absolute path', () => {
			const { decision, reason } = decisionOf('/usr/local/bin/prettier --write src');
			expect(decision).toBe('deny');
			expect(reason).toMatch(/Use `prettier` from \$PATH/);
		});

		test('blocks prettier invoked through node_modules/.bin', () => {
			const { decision, reason } = decisionOf('node_modules/.bin/prettier .');
			expect(decision).toBe('deny');
			expect(reason).toMatch(/Use `prettier` from \$PATH/);
		});

		test('allows prettier resolved from $PATH', () => {
			expect(decisionOf('prettier --write src').decision).toBe('allow');
		});

		test('allows prettier with an absolute-path file argument', () => {
			expect(decisionOf('prettier /tmp/foo.js').decision).toBe('allow');
		});

		test('does not match a cat invocation containing /prettier in an argument', () => {
			expect(decisionOf('cat /tmp/prettier.log').decision).toBe('allow');
		});
	});

	describe('sass path-form', () => {
		test('blocks sass invoked through an absolute path', () => {
			const { decision, reason } = decisionOf('/opt/homebrew/bin/sass src/main.scss out.css');
			expect(decision).toBe('deny');
			expect(reason).toMatch(/Use `sass` from \$PATH/);
		});

		test('blocks sass invoked through a relative ./ path', () => {
			expect(decisionOf('./sass a.scss b.css').decision).toBe('deny');
		});
	});

	describe('cd <dir> && <something> (segment-aware allow, no special-casing)', () => {
		test('allows cd <dir> && make (each segment evaluated independently)', () => {
			expect(decisionOf('cd backend && make deploy').decision).toBe('allow');
		});

		test('allows cd <dir> && make with multiple targets', () => {
			expect(decisionOf('cd backend/cloudformation && make clean deploy').decision).toBe('allow');
		});

		test('allows make -C <dir>', () => {
			expect(decisionOf('make -C backend deploy').decision).toBe('allow');
		});

		test('allows plain make', () => {
			expect(decisionOf('make deploy').decision).toBe('allow');
		});

		test('allows cd <dir> chained with ls', () => {
			expect(decisionOf('cd backend && ls').decision).toBe('allow');
		});
	});

	describe('npm --prefix', () => {
		test('blocks npm --prefix <dir> test', () => {
			const { decision, reason } = decisionOf('npm --prefix config/tools test');
			expect(decision).toBe('deny');
			expect(reason).toMatch(/Do not invoke npm with --prefix/);
		});

		test('blocks npm test --prefix=<dir>', () => {
			expect(decisionOf('npm test --prefix=config/tools').decision).toBe('deny');
		});

		test('allows plain npm test', () => {
			expect(decisionOf('npm test').decision).toBe('allow');
		});
	});

	describe('npm run lint', () => {
		test('blocks npm run lint', () => {
			const { decision, reason } = decisionOf('npm run lint');
			expect(decision).toBe('deny');
			expect(reason).toMatch(/Do not use 'npm run lint'/);
		});

		test('blocks npm run lint with extra arguments', () => {
			expect(decisionOf('npm run lint --fix').decision).toBe('deny');
		});

		test('allows direct eslint invocation', () => {
			expect(decisionOf('eslint src').decision).toBe('allow');
		});
	});

	describe('perl hard deny (use sed/awk or node/python instead)', () => {
		test('blocks perl one-liner text transformation', () => {
			const { decision, reason } = decisionOf("perl -pe 's/foo/bar/' file");
			expect(decision).toBe('deny');
			expect(reason).toMatch(/Use `sed`\/`awk` for text transformation/);
			expect(reason).toMatch(/`node`\/`python3` for general scripting/);
		});

		test('blocks perl -e script', () => {
			expect(decisionOf('perl -e \'print "hi"\'').decision).toBe('deny');
		});

		test('blocks perl running a script file', () => {
			expect(decisionOf('perl script.pl').decision).toBe('deny');
		});

		test('blocks perl piped after an allowed command (compound merge)', () => {
			expect(decisionOf("cat foo | perl -pe 's/a/b/'").decision).toBe('deny');
		});

		test('does not match a binary whose name merely starts with perl', () => {
			expect(decisionOf('perltidy file.pl').decision).toBe('no-match');
		});
	});

	describe('shell comment lines (rejected — resend without comments)', () => {
		test('blocks a standalone comment line', () => {
			const { decision, reason } = decisionOf('# Find the user-management nested stack');
			expect(decision).toBe('deny');
			expect(reason).toMatch(/resend the command without comments/i);
		});

		test('blocks a comment with no space after the hash', () => {
			expect(decisionOf('#no-space-comment').decision).toBe('deny');
		});

		test('blocks a compound command containing a comment line (merge to deny)', () => {
			const command =
				'cd /tmp/claude-transient 2>/dev/null\n# Find the user-management nested stack and backend-api nested stack\necho "=== Nested stacks ==="\naws cloudformation describe-stack-resources --stack-name gojkolocal --query "StackResources[?ResourceType==\'AWS::CloudFormation::Stack\'].[LogicalResourceId, PhysicalResourceId]" --output text 2>&1 | grep -i "UserManagement\\|BackendAPI"';
			const { decision, reason } = decisionOf(command);
			expect(decision).toBe('deny');
			expect(reason).toMatch(/resend the command without comments/i);
		});

		test('does not match echo whose argument merely contains a hash', () => {
			expect(decisionOf('echo "# not a comment"').decision).toBe('allow');
		});
	});

	describe('npm install with version specifier', () => {
		test('blocks npm install pkg@version', () => {
			const { decision, reason } = decisionOf('npm install jest@29.0.0');
			expect(decision).toBe('deny');
			expect(reason).toMatch(/Do not pin a version when installing/);
		});

		test('blocks npm i pkg@latest', () => {
			expect(decisionOf('npm i lodash@latest').decision).toBe('deny');
		});

		test('blocks scoped pkg with version', () => {
			expect(decisionOf('npm install @aws-sdk/client-s3@1.0.0').decision).toBe('deny');
		});

		test('blocks version pin alongside flags', () => {
			expect(decisionOf('npm install --save-dev prettier@3.0.0').decision).toBe('deny');
		});

		test('asks for a scoped package without version (npm-install rule, any form → ask)', () => {
			expect(decisionOf('npm install @aws-sdk/client-s3').decision).toBe('ask');
		});

		test('asks for bare "npm install" with no args (npm-install rule)', () => {
			expect(decisionOf('npm install').decision).toBe('ask');
		});
	});

	describe('cd <dir> && git (segment-aware allow)', () => {
		test('allows cd <dir> && git status (each segment evaluated independently)', () => {
			expect(decisionOf('cd backend && git status').decision).toBe('allow');
		});

		test('allows cd <dir> && git diff', () => {
			expect(decisionOf('cd app && git diff HEAD').decision).toBe('allow');
		});
	});

	describe('--testPathPattern deprecation', () => {
		test('blocks --testPathPattern flag', () => {
			const { decision, reason } = decisionOf('npm test -- --testPathPattern foo');
			expect(decision).toBe('deny');
			expect(reason).toMatch(/--testPathPattern is deprecated/);
		});

		test('blocks --testPathPattern=value form', () => {
			expect(decisionOf('jest --testPathPattern=foo').decision).toBe('deny');
		});

		test('allows --testNamePattern', () => {
			expect(decisionOf('npm test -- --testNamePattern=foo').decision).toBe('allow');
		});
	});
});

describe('Phase 2 carry-over: settings.json allow entries reproduced via the bin', () => {
	test.each([
		['aws cloudformation describe-stacks'],
		['aws codepipeline list-pipelines'],
		['aws sts get-caller-identity'],
		['cat /etc/hosts'],
		['cd /tmp'],
		['cfn-lint backend/cloudformation/foo.yml'],
		['cp src dest'],
		['echo hello'],
		['find . -name "*.js"'],
		['git diff HEAD'],
		['git status'],
		['grep foo bar.txt'],
		['jest tests/foo.test.js'],
		['ls /tmp'],
		['make build'],
		['mkdir /tmp/x'],
		['npm t'],
		['npm test'],
		['rm /tmp/foo'],
		['rm -f /tmp/a.json /tmp/b.json'],
		['rm -rf /tmp/claude-transient/scratch'],
		['sed s/foo/bar/g file'],
		['touch /tmp/x'],
		['zcat foo.gz']
	])('"%s" → allow', (command) => {
		expect(decisionOf(command).decision).toBe('allow');
	});

	test('node fuzzy-e2e-testing scripts allow (any of the 9 carry-overs)', () => {
		expect(decisionOf('node .claude/skills/fuzzy-e2e-testing/scripts/bin/current-timestamp.js').decision).toBe('allow');
	});

	test('multi-line for-loop body with newline-separated allowed commands → allow', () => {
		expect(decisionOf('for f in /a /b ; do\n  echo hi\n  grep -n foo /a\ndone').decision).toBe('allow');
	});
});

describe('brace-group commands auto-allow when their inner commands all allow', () => {
	test.each([
		['{ echo hi; }'],
		['{ echo a; echo b; }'],
		['{ time make test; } 2>&1 | tail -25'],
		[
			'for i in 1 2 3 4 5; do echo "=== Run $i ==="; { time make smoke-test TEST_ENVIRONMENT=gojkolocal SKIP_DEPLOYMENT=1 JEST_ARGS="tests/foo.integration.test.js"; } 2>&1 | tail -25; echo ""; done | tee /tmp/claude-transient/out.txt'
		]
	])('"%s" → allow', (command) => {
		expect(decisionOf(command).decision).toBe('allow');
	});
});

describe('bare env (and env with only flags) is auto-allowed', () => {
	test.each([
		['env'],
		['env -i'],
		['env --unset=FOO'],
		['echo hi && env'],
		['grep -nE "^smoke" makefile 2>&1 | head -20 && echo "---" && echo "VTT=$VTT" && env | grep -iE "VTT|VTT2" | head']
	])('"%s" → allow', (command) => {
		expect(decisionOf(command).decision).toBe('allow');
	});
});

describe('newly allowed local-allow carry-overs', () => {
	test.each([
		['curl -sI https://example.com/'],
		['curl -s https://example.com/api'],
		['node scripts/materialise-publish-dates.js'],
		['node www/support/audit-paper-candidates.js path/to/files'],
		['sass --no-source-map -I styles/include in.scss out.css'],
		['chromium --headless --disable-gpu --no-sandbox --window-size=800,1400 --screenshot=/tmp/claude-transient/x.png file:///tmp/foo.html'],
		['/usr/bin/chromium --headless --no-sandbox --screenshot=/tmp/claude-transient/x.png http://localhost:4040/'],
		['python3 -c "print(1)"'],
		['python3 script.py arg1 arg2'],
		['ruby jekyll/_plugin-tests/compress-html-filter_test.rb'],
		['bundle install'],
		['bundle exec jekyll build'],
		['yq . www/_config.yml'],
		['chmod +x scripts/run.sh'],
		['tee /tmp/claude-transient/deploy.log'],
		['kill 1234 5678'],
		['magick input.png -quality 90 output.webp'],
		['convert input.png -quality 85 output.webp'],
		['mv /tmp/claude-transient/foo.mjs ./foo.mjs']
	])('"%s" → allow', (command) => {
		expect(decisionOf(command).decision).toBe('allow');
	});

	test('absolute-path deny still beats the new node allow', () => {
		expect(decisionOf('node /home/user/scripts/x.js').decision).toBe('deny');
	});

	test('absolute-path deny still beats the new sass allow', () => {
		expect(decisionOf('/opt/homebrew/bin/sass src/main.scss out.css').decision).toBe('deny');
	});

	test('aws s3 ls bucket/path → allow', () => {
		expect(decisionOf('aws s3 ls s3://my-bucket/path/').decision).toBe('allow');
	});

	test('aws s3 cp → no-match (only ls is allowed, cp falls through to prompt)', () => {
		expect(decisionOf('aws s3 cp s3://b/k /tmp/out').decision).toBe('no-match');
	});
});

describe('local-allow carry-overs: jq, jekyll, and read-only rain', () => {
	test.each([
		["jq -r '.tool_input.file_path' /tmp/event.json"],
		['cat package.json | jq .scripts'],
		['jekyll build --source www/jekyll'],
		['rain ls'],
		['rain ls gojkolocal'],
		['rain logs gojkolocal'],
		['rain cat gojkolocal'],
		['rain fmt backend/cloudformation/app.yml'],
		['rain tree backend/cloudformation/app.yml'],
		['rain diff backend/cloudformation/app.yml /tmp/claude-transient/deployed.yml'],
		['rain watch gojkolocal'],
		['rain ls 2>&1 | grep -i user']
	])('"%s" → allow', (command) => {
		expect(decisionOf(command).decision).toBe('allow');
	});

	test('rain deploy → no-match (stack mutation falls through to the prompt)', () => {
		expect(decisionOf('rain deploy backend/cloudformation/app.yml gojkolocal').decision).toBe('no-match');
	});

	test('rain rm → no-match (stack deletion falls through to the prompt)', () => {
		expect(decisionOf('rain rm gojkolocal').decision).toBe('no-match');
	});

	test('bare rain → no-match (only read-only subcommands are allowed)', () => {
		expect(decisionOf('rain').decision).toBe('no-match');
	});

	test('rain lsx → no-match (token boundary: lsx is not ls)', () => {
		expect(decisionOf('rain lsx').decision).toBe('no-match');
	});
});

describe('git read-only verbs auto-allow; mutating verbs require ask', () => {
	test.each([
		['git log --oneline -10'],
		['git log --oneline -10 backend/smoke-tests/tests/foo.integration.test.js'],
		['git blame backend/smoke-tests/tests/foo.integration.test.js'],
		['git diff'],
		['git status'],
		['git stash list'],
		['git stash show'],
		['git stash show -p stash@{0}'],
		['git --no-pager stash list']
	])('"%s" → allow', (command) => {
		expect(decisionOf(command).decision).toBe('allow');
	});

	test.each([
		['git add .'],
		['git add roadmap/front-end-qualification-layer.md'],
		['git commit -m foo'],
		['git checkout master'],
		['git stash'],
		['git stash push -m wip'],
		['git stash pop'],
		['git revert HEAD']
	])('"%s" → ask (local-state mutation must be confirmed)', (command) => {
		expect(decisionOf(command).decision).toBe('ask');
	});

	test('compound cfn-lint pipeline with git stash list + git diff → allow', () => {
		const command =
			'cfn-lint backend/cloudformation/user-management.yml 2>&1 | grep -E "^E[0-9]" | head; echo "E-ERRORS ABOVE (none = clean)"; git stash list 2>/dev/null; git diff --stat backend/cloudformation/user-management.yml';
		expect(decisionOf(command).decision).toBe('allow');
	});

	test('mvn package (non-test) → no-match (mvn ask rule removed; only "mvn test" auto-allows)', () => {
		expect(decisionOf('mvn package').decision).toBe('no-match');
	});
});

describe('git readonly subcommands tolerate -C, -c and --no-pager global options', () => {
	test.each([
		['git -C /Users/me/work/app status'],
		['git -C /tmp status --porcelain roadmap/x.md'],
		['git -C /path -c key=value diff'],
		['git -c color.ui=never status'],
		['git -C /Users/me/work/app log --oneline -10 backend/smoke-tests/tests/foo.integration.test.js'],
		['git --no-pager status'],
		['git --no-pager diff config/tools/src/require-param-destructuring.js'],
		['git -C /path --no-pager log --oneline']
	])('"%s" → allow', (command) => {
		expect(decisionOf(command).decision).toBe('allow');
	});

	test.each([['git -c user.email=foo@bar.com commit -m msg'], ['git -C ../repo checkout master'], ['git --no-pager stash']])(
		'"%s" → ask (global options do not bypass the mutating-verb ask rule)',
		(command) => {
			expect(decisionOf(command).decision).toBe('ask');
		}
	);

	test('git --no-pager push origin master → deny (--no-pager does not bypass gitRemoteRule)', () => {
		const { decision, reason } = decisionOf('git --no-pager push origin master');
		expect(decision).toBe('deny');
		expect(reason).toMatch(/Ask the user to run `git --no-pager push origin master` directly/);
	});

	test('git -C /path push origin master → deny (global option does not bypass gitRemoteRule)', () => {
		const { decision, reason } = decisionOf('git -C /path push origin master');
		expect(decision).toBe('deny');
		expect(reason).toMatch(/Ask the user to run `git -C \/path push origin master` directly/);
	});

	test('git -c user.email=foo@bar.com pull → deny', () => {
		expect(decisionOf('git -c user.email=foo@bar.com pull').decision).toBe('deny');
	});

	test('git -C without path argument → no-match', () => {
		expect(decisionOf('git -C status').decision).toBe('no-match');
	});

	test('git --exec-path=/x status → no-match (only -C, -c and --no-pager are tolerated)', () => {
		expect(decisionOf('git --exec-path=/x status').decision).toBe('no-match');
	});
});

describe('Phase 3: AWS generalised read-only allows', () => {
	test('aws dynamodb describe-tables → allow', () => {
		expect(decisionOf('aws dynamodb describe-tables').decision).toBe('allow');
	});

	test('aws dynamodb scan → allow', () => {
		expect(decisionOf('aws dynamodb scan --table-name foo').decision).toBe('allow');
	});

	test('aws lambda list-functions → allow', () => {
		expect(decisionOf('aws lambda list-functions').decision).toBe('allow');
	});

	test('aws lambda invoke → allow (explicitly approved subcommand)', () => {
		expect(decisionOf('aws lambda invoke --function-name foo /tmp/claude-transient/out.json').decision).toBe('allow');
	});

	test('aws s3 get-object → allow', () => {
		expect(decisionOf('aws s3 get-object --bucket b --key k /tmp/out').decision).toBe('allow');
	});

	test('aws application-autoscaling describe-scaling-policies → no-match (hyphenated service)', () => {
		expect(decisionOf('aws application-autoscaling describe-scaling-policies').decision).toBe('no-match');
	});

	test('aws --profile foo dynamodb describe-tables → no-match (global flag before service)', () => {
		expect(decisionOf('aws --profile foo dynamodb describe-tables').decision).toBe('no-match');
	});
});

describe('export for setting env vars is denied (use the NAME=VALUE command prefix instead)', () => {
	test('blocks export NAME=VALUE', () => {
		const { decision, reason } = decisionOf('export FOO=bar');
		expect(decision).toBe('deny');
		expect(reason).toMatch(/Prefix the command with NAME=VALUE pairs/);
	});

	test('blocks export with multiple NAME=VALUE pairs', () => {
		expect(decisionOf('export FOO=bar BAZ=qux').decision).toBe('deny');
	});

	test('blocks export NAME=VALUE in a compound command (merge to deny)', () => {
		expect(decisionOf('export FOO=bar && make test').decision).toBe('deny');
	});

	test('still allows the NAME=VALUE command prefix form', () => {
		expect(decisionOf('FOO=bar make test').decision).toBe('allow');
	});

	test('does not deny export -p (listing exports, not setting a value)', () => {
		expect(decisionOf('export -p').decision).toBe('no-match');
	});
});

describe('direct Lambda code/config updates are denied (deploy via CloudFormation)', () => {
	test('blocks aws lambda update-function-code', () => {
		const { decision, reason } = decisionOf('aws lambda update-function-code --function-name foo --zip-file fileb://x.zip');
		expect(decision).toBe('deny');
		expect(reason).toMatch(/Deploy through CloudFormation/);
	});

	test('blocks aws lambda update-function-configuration', () => {
		const { decision, reason } = decisionOf('aws lambda update-function-configuration --function-name foo --timeout 30');
		expect(decision).toBe('deny');
		expect(reason).toMatch(/Deploy through CloudFormation/);
	});

	test('blocks an update-function-code piped after an allowed command (compound merge)', () => {
		expect(decisionOf('echo deploying && aws lambda update-function-code --function-name foo --zip-file fileb://x.zip').decision).toBe('deny');
	});

	test('still allows read-only aws lambda get-function-configuration', () => {
		expect(decisionOf('aws lambda get-function-configuration --function-name foo').decision).toBe('allow');
	});

	test('still allows aws lambda invoke', () => {
		expect(decisionOf('aws lambda invoke --function-name foo /tmp/claude-transient/out.json').decision).toBe('allow');
	});
});

describe('Phase 3: npm install always asks; version pins still deny', () => {
	test('bare "npm install" → ask', () => {
		expect(decisionOf('npm install').decision).toBe('ask');
	});

	test('"npm install jest" → ask', () => {
		expect(decisionOf('npm install jest').decision).toBe('ask');
	});

	test('"npm install --no-audit" → ask', () => {
		expect(decisionOf('npm install --no-audit').decision).toBe('ask');
	});

	test('"npm install pkg@version" → deny (version-pin precedes the install ask)', () => {
		expect(decisionOf('npm install jest@29.0.0').decision).toBe('deny');
	});
});

describe('Phase 3: jest path-form deny', () => {
	test('../../node_modules/.bin/jest tests/foo.test.js → deny', () => {
		const { decision, reason } = decisionOf('../../node_modules/.bin/jest tests/foo.test.js');
		expect(decision).toBe('deny');
		expect(reason).toMatch(/Use `jest` from \$PATH/);
	});

	test('bare jest tests/foo.test.js → allow (path-form rule does not fire)', () => {
		expect(decisionOf('jest tests/foo.test.js').decision).toBe('allow');
	});
});

describe('Phase 3: npx generic deny + npx jest specific deny', () => {
	test('npx prettier → deny with generic npx message', () => {
		const { decision, reason } = decisionOf('npx prettier --write .');
		expect(decision).toBe('deny');
		expect(reason).toMatch(/Project policy forbids `npx`/);
	});

	test('npx jest → deny with jest-redirect message', () => {
		const { decision, reason } = decisionOf('npx jest');
		expect(decision).toBe('deny');
		expect(reason).toMatch(/Use the `jest` binary from \$PATH/);
	});

	test('npx -y jest → deny with jest-redirect message', () => {
		const { decision, reason } = decisionOf('npx -y jest --listTests');
		expect(decision).toBe('deny');
		expect(reason).toMatch(/Use the `jest` binary from \$PATH/);
	});

	test('time npx jest → deny with jest-redirect (wrapper unwrapped, then npx-jest match)', () => {
		const { decision, reason } = decisionOf('time npx jest');
		expect(decision).toBe('deny');
		expect(reason).toMatch(/Use the `jest` binary from \$PATH/);
	});

	test('cd backend && npx prettier . → deny (compound merge)', () => {
		expect(decisionOf('cd backend && npx prettier .').decision).toBe('deny');
	});
});

describe('Phase 3: git remote-operation deny with verbatim command', () => {
	test('git push origin master --force → deny with the original command interpolated', () => {
		const { decision, reason } = decisionOf('git push origin master --force');
		expect(decision).toBe('deny');
		expect(reason).toMatch(/Ask the user to run `git push origin master --force` directly/);
	});

	test('git pull → deny', () => {
		expect(decisionOf('git pull').decision).toBe('deny');
	});

	test('git fetch --all --tags → deny', () => {
		expect(decisionOf('git fetch --all --tags').decision).toBe('deny');
	});

	test('git clone <url> → deny', () => {
		expect(decisionOf('git clone https://github.com/foo/bar').decision).toBe('deny');
	});

	test('git diff origin/main..HEAD → allow (remote refspec does not transform diff into a remote op)', () => {
		expect(decisionOf('git diff origin/main..HEAD').decision).toBe('allow');
	});
});

describe('Phase 3: sudo hard deny', () => {
	test('sudo make deploy → deny with verbatim command', () => {
		const { decision, reason } = decisionOf('sudo make deploy');
		expect(decision).toBe('deny');
		expect(reason).toMatch(/Ask the user to run `sudo make deploy` directly/);
	});

	test('xargs sudo cmd → deny (wrapper unwrap then sudo match)', () => {
		expect(decisionOf('xargs sudo cmd').decision).toBe('deny');
	});

	test('cd /tmp && sudo cat /etc/shadow → deny (compound merge)', () => {
		expect(decisionOf('cd /tmp && sudo cat /etc/shadow').decision).toBe('deny');
	});

	test('which sudo → allow (first token is which, which is allowed; sudo only blocked when it IS the command)', () => {
		expect(decisionOf('which sudo').decision).toBe('allow');
	});

	test('echo sudo → allow', () => {
		expect(decisionOf('echo sudo').decision).toBe('allow');
	});
});

describe('heredoc end-to-end propagation', () => {
	test('cat <<EOF\\nfoo\\nEOF → allow (cat allow rule matches stripped segment)', () => {
		expect(decisionOf('cat <<EOF\nfoo\nEOF').decision).toBe('allow');
	});

	test('cat <<END\\nbody\\nEND (alternative delimiter) → allow', () => {
		expect(decisionOf('cat <<END\nbody\nEND').decision).toBe('allow');
	});

	test('cat <<EOF\\n$(echo hi)\\nEOF → allow (inner echo is on the allow list)', () => {
		expect(decisionOf('cat <<EOF\n$(echo hi)\nEOF').decision).toBe('allow');
	});

	test('cat <<EOF\\n$(date)\\nEOF → allow (both cat and date are on the allow list)', () => {
		expect(decisionOf('cat <<EOF\n$(date)\nEOF').decision).toBe('allow');
	});

	test('cat <<EOF\\n$(htop)\\nEOF → no-match (inner htop has no allow rule; compound downgrades)', () => {
		const result = decisionOf('cat <<EOF\n$(htop)\nEOF');
		expect(result.decision).toBe('no-match');
		expect(result.decision).not.toBe('allow');
	});

	test('cat <<EOF\\n$(npx prettier)\\nEOF → deny with generic npx message', () => {
		const { decision, reason } = decisionOf('cat <<EOF\n$(npx prettier)\nEOF');
		expect(decision).toBe('deny');
		expect(reason).toMatch(/Project policy forbids `npx`/);
	});

	test(`cat <<'EOF'\\nfoo\\nEOF (single-quoted) → allow (body opaque, cat is on allow list)`, () => {
		expect(decisionOf(`cat <<'EOF'\nfoo\nEOF`).decision).toBe('allow');
	});

	test('cat <<"EOF"\\nfoo\\nEOF (double-quoted) → allow', () => {
		expect(decisionOf('cat <<"EOF"\nfoo\nEOF').decision).toBe('allow');
	});

	test('cat <<\\\\EOF\\nfoo\\nEOF (backslash-quoted) → allow', () => {
		expect(decisionOf('cat <<\\EOF\nfoo\nEOF').decision).toBe('allow');
	});

	test(`cat <<'EOF'\\n$(rm -rf /)\\nEOF → allow (quoted body is literal, $() never executes)`, () => {
		expect(decisionOf(`cat <<'EOF'\n$(rm -rf /)\nEOF`).decision).toBe('allow');
	});

	test('cat <<-EOF\\nfoo\\nEOF (tab-strip, deferred) → deny', () => {
		const { decision, reason } = decisionOf('cat <<-EOF\nfoo\nEOF');
		expect(decision).toBe('deny');
		expect(reason).toMatch(/could not be safely parsed/);
		expect(reason).toMatch(/debug\.js/);
	});

	test('cat <<EOF (no close, malformed) → deny', () => {
		expect(decisionOf('cat <<EOF').decision).toBe('deny');
	});

	test('echo before && cat <<EOF\\nbody\\nEOF → allow (compound of two allow-listed segments)', () => {
		expect(decisionOf('echo before && cat <<EOF\nbody\nEOF').decision).toBe('allow');
	});
});

describe('sh -c inner-script regulation', () => {
	test(`sh -c 'npm test' → allow (inner script segments carry the decision)`, () => {
		expect(decisionOf(`sh -c 'npm test'`).decision).toBe('allow');
	});

	test(`grep pipeline into xargs -I{} sh -c '...' → allow (wrapper-prefixed shell script re-parsed)`, () => {
		const command = `grep -rln "sign-in-card" /tmp/site --include="*.css" 2>/dev/null | head; echo ---; grep -rl "sign-in-card" /tmp/site 2>/dev/null | grep css | head -3 | xargs -I{} sh -c 'echo {}; grep -o "sign-in-card{margin[^;]*" "{}" | head -2'`;
		expect(decisionOf(command).decision).toBe('allow');
	});

	test(`sh -c 'htop' → no-match (inner command not on the allow list)`, () => {
		expect(decisionOf(`sh -c 'htop'`).decision).toBe('no-match');
	});

	test(`bash -c 'npx prettier' → deny (inner npx deny propagates)`, () => {
		expect(decisionOf(`bash -c 'npx prettier'`).decision).toBe('deny');
	});

	test('echo a | xargs sh -c → no-match (script arrives via stdin, opaque to the regulator)', () => {
		expect(decisionOf('echo a | xargs sh -c').decision).toBe('no-match');
	});
});

describe('subshell parens propagate through to per-segment evaluation', () => {
	test('cd && (git diff; echo b) | xargs grep ... → allow (all inner segments are on the allow list)', () => {
		const command = `cd /tmp && (git diff HEAD --name-only -- '*test*'; echo b) | xargs grep -lE "Gap [0-9]" 2>/dev/null`;
		expect(decisionOf(command).decision).toBe('allow');
	});

	test('(echo a; echo b) → allow', () => {
		expect(decisionOf('(echo a; echo b)').decision).toBe('allow');
	});

	test('(sudo rm -rf /) → deny (sudo rule fires inside the subshell)', () => {
		expect(decisionOf('(sudo rm -rf /)').decision).toBe('deny');
	});
});

describe('env-assignment substitution recursion (regression: for-loop with var=$(grep|sed) and var=$(basename))', () => {
	test('var=$(grep ...) → allow because grep is on the allow list', () => {
		expect(decisionOf('exports=$(grep foo bar)').decision).toBe('allow');
	});

	test('var=$(grep ... | sed ...) → allow because both grep and sed are on the allow list', () => {
		expect(decisionOf('out=$(grep foo file | sed s/a/b/)').decision).toBe('allow');
	});

	test('var=$(sudo rm -rf /) → deny because the substitution body matches the sudo deny rule', () => {
		expect(decisionOf('out=$(sudo rm -rf /)').decision).toBe('deny');
	});

	test('the exact for-loop command that originally required permission resolves to allow', () => {
		const command =
			'for f in lib/scoring-engine/src/strategies/engagement/*.js; do\n' +
			'  exports=$(grep -E "^export (const|function|class) " "$f" | sed -E \'s/^export (const|function|class) ([A-Za-z_$][A-Za-z0-9_$]*).*/\\2/\')\n' +
			'  base=$(basename "$f" .js)\n' +
			'  echo "$base.js → $exports"\n' +
			'done';
		expect(decisionOf(command).decision).toBe('allow');
	});
});

describe('process-control utilities on the common allow list', () => {
	test('pkill -f <pattern> → allow (sibling of kill/pgrep)', () => {
		expect(decisionOf('pkill -f "make test"').decision).toBe('allow');
	});

	test('sleep <n> → allow (benign no-op)', () => {
		expect(decisionOf('sleep 2').decision).toBe('allow');
	});

	test('the kill-then-poll smoke-test chain resolves to allow', () => {
		const command =
			'pkill -f "make.*smoke-test"; pkill -f "jest.*smoke"; sleep 2; ' +
			'echo "killed"; ps -ef 2>/dev/null | grep -iE "make smoke|jest" | grep -v grep | head -3';
		expect(decisionOf(command).decision).toBe('allow');
	});
});

describe('if/then/elif/else/fi conditionals collapse to their inner commands', () => {
	test('the [ test builtin is allowed', () => {
		expect(decisionOf('[ "$x" = "1" ]').decision).toBe('allow');
	});

	test('a simple if/then/fi with allowed commands resolves to allow', () => {
		expect(decisionOf('if [ "$x" = "1" ]; then echo yes; fi').decision).toBe('allow');
	});

	test('an if/then/else/fi with allowed commands resolves to allow', () => {
		expect(decisionOf('if grep -q foo bar; then echo a; else echo b; fi').decision).toBe('allow');
	});

	test('a deny inside an if body still denies (deny dominates the conditional)', () => {
		expect(decisionOf('if [ 1 = 1 ]; then sudo rm -rf /; fi').decision).toBe('deny');
	});
});

describe('$((arithmetic)) expansion is not treated as a command substitution', () => {
	test('an arithmetic assignment followed by an allowed command resolves to allow', () => {
		expect(decisionOf('n=$((1+2)); echo done').decision).toBe('allow');
	});

	test('arithmetic does not mask a denied command substitution', () => {
		expect(decisionOf('out=$(sudo rm -rf /)').decision).toBe('deny');
	});

	test('the DLQ-polling loop with conditional and arithmetic resolves to allow', () => {
		const command =
			'total=0; nonzero=0; for q in $(aws sqs list-queues --queue-name-prefix gojkolocal ' +
			"--query 'QueueUrls[]' --output text 2>/dev/null | tr '\\t' '\\n' | grep -iE \"dlq|dead\"); " +
			'do total=$((total+1)); n=$(aws sqs get-queue-attributes --queue-url "$q" ' +
			"--attribute-names ApproximateNumberOfMessages --query 'Attributes.ApproximateNumberOfMessages' " +
			'--output text 2>/dev/null); if [ "$n" != "0" ]; then nonzero=$((nonzero+1)); ' +
			'echo "NONZERO($n): ${q##*/}"; fi; done; echo "TOTAL_DLQS=$total NONZERO=$nonzero"';
		expect(decisionOf(command).decision).toBe('allow');
	});
});
