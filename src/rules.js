import { nodeAbsolutePathRule } from './rules/node-absolute-path.js';
import { requireFromPath } from './rules/require-from-path.js';
import { jestRootdirRule } from './rules/jest-rootdir.js';
import { testPathPatternRule } from './rules/test-path-pattern.js';
import { awsDescribeRule } from './rules/aws-describe.js';
import { awsListRule } from './rules/aws-list.js';
import { awsGetRule } from './rules/aws-get.js';
import { npmInstallRule } from './rules/npm-install.js';
import { npxRule } from './rules/npx.js';
import { npxJestRule } from './rules/npx-jest.js';
import { gitRemoteRule } from './rules/git-remote.js';
import { sudoRule } from './rules/sudo.js';
import { allowCommands } from './allow-commands.js';
import { regexAllowRule } from './regex-allow-rule.js';
import { regexAskRule } from './regex-ask-rule.js';
import { regexDenyRule } from './regex-deny-rule.js';

const rules = [
	requireFromPath({
		id: 'require-from-path',
		commands: ['jest', 'eslint', 'prettier', 'sass', 'cfn-lint']
	}),

	nodeAbsolutePathRule,
	jestRootdirRule,
	testPathPatternRule,

	regexDenyRule({
		id: 'npm-install-version-pin',
		regex: /^npm\s+(install|i)\s.*[\w._-]@/,
		reason: "Do not pin a version when installing. Run 'npm install <package>' (or '--save-dev <package>') without an '@<version>' specifier."
	}),
	regexDenyRule({
		id: 'npm-with-prefix',
		regex: /^npm\s.*--prefix(\s|=|$)/,
		reason: "Do not invoke npm with --prefix. Change into the target project directory first and run 'npm ...' there."
	}),
	regexDenyRule({
		id: 'npm-run-lint',
		regex: /^npm\s+run\s+lint(\s|$)/,
		reason: "Do not use 'npm run lint'. Run 'eslint' directly from $PATH."
	}),
	regexDenyRule({
		id: 'perl',
		regex: /^perl(\s|$)/,
		reason: 'Project policy forbids `perl`. Use `sed`/`awk` for text transformation, or `node`/`python3` for general scripting.'
	}),
	regexDenyRule({
		id: 'shell-comment',
		regex: /^#/,
		reason: 'Commands must not contain `#` comment lines. Resend the command without comments.'
	}),
	regexDenyRule({
		id: 'export-env-var',
		regex: /^export\s+\w+=/,
		reason: 'Do not use `export` to set environment variables. Prefix the command with NAME=VALUE pairs instead (e.g. `FOO=bar some-command`).'
	}),
	regexDenyRule({
		id: 'aws-lambda-update',
		regex: /^aws\s+lambda\s+update-function-(code|configuration)(\s|$)/,
		reason: 'Do not update Lambda code or configuration directly. Deploy through CloudFormation instead (e.g. `make deploy-<environment>`).'
	}),

	npxJestRule,
	npxRule,
	gitRemoteRule,
	sudoRule,

	awsDescribeRule,
	awsListRule,
	awsGetRule,

	allowCommands({
		id: 'common-allowed-commands',
		commands: [
			'awk',
			'basename',
			'bundle',
			'cat',
			'break',
			'cd',
			'env',
			'cfn-lint',
			'chmod',
			'chromium',
			'/usr/bin/chromium',
			'convert',
			'cp',
			'curl',
			'cut',
			'date',
			'diff',
			'dirname',
			'echo',
			'esbuild',
			'eslint',
			'file',
			'find',
			'grep',
			'head',
			'jekyll',
			'jest',
			'jq',
			'kill',
			'ls',
			'lsof',
			'magick',
			'make',
			'md5sum',
			'mkdir',
			'mv',
			'node',
			'nproc',
			'pgrep',
			'pkill',
			'prettier',
			'printf',
			'ps',
			'pwd',
			'python3',
			'rm',
			'rmdir',
			'ruby',
			'sass',
			'sed',
			'sleep',
			'sort',
			'split',
			'sqlite3',
			'stat',
			'tail',
			'tee',
			'test',
			'[',
			'touch',
			'tr',
			'true',
			'uniq',
			'unzip',
			'wc',
			'which',
			'yq',
			'zcat'
		]
	}),

	allowCommands({
		id: 'aws-readonly-subcommands',
		commands: [
			'aws cloudformation',
			'aws codebuild batch-get-reports',
			'aws codepipeline',
			'aws dynamodb get-item',
			'aws dynamodb scan',
			'aws dynamodb wait',
			'aws lambda invoke',
			'aws logs',
			'aws s3 ls',
			'aws sqs receive-message',
			'aws sts'
		]
	}),

	allowCommands({
		id: 'rain-readonly-subcommands',
		commands: ['rain cat', 'rain diff', 'rain fmt', 'rain logs', 'rain ls', 'rain tree', 'rain watch']
	}),

	regexAllowRule({
		id: 'git-stash-readonly',
		regex: /^git(\s+(-[Cc]\s+\S+|--no-pager))*\s+stash\s+(list|show)(\s|$)/
	}),

	regexAskRule({
		id: 'git-mutating-local',
		regex: /^git(\s+(-[Cc]\s+\S+|--no-pager))*\s+(add|checkout|commit|stash|revert)(\s|$)/,
		reason:
			'This git operation changes local repository or working-tree state (add/commit/stash/revert/checkout). Confirm before running, or ask the user to run it directly.'
	}),

	regexAllowRule({
		id: 'git-readonly-subcommands',
		regex: /^git(\s+(-[Cc]\s+\S+|--no-pager))*\s+(blame|diff|log|mv|rm|status|show)(\s|$)/
	}),

	allowCommands({
		id: 'mvn-test-and-npm-test',
		commands: ['npm t', 'npm test']
	}),

	regexAllowRule({
		id: 'bash-pdf-script',
		regex: /^bash \.claude\/skills\/pdf\/scripts\/bin\/md-to-pdf\.sh(\s|$)/
	}),

	regexAllowRule({
		id: 'node-fuzzy-e2e-scripts',
		regex: /^node\s+\.claude\/skills\/fuzzy-e2e-testing\/scripts\/bin\/[a-z-]+\.js(\s|$)/
	}),
	npmInstallRule
];

export { rules };
