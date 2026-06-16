import { describe, test, expect } from '@jest/globals';
import { unwrapWrappers } from '../src/unwrap-wrappers.js';
import { wrappers } from '../src/wrappers.js';

const unwrap = (commandString) => unwrapWrappers(commandString.split(' ').filter((t) => t.length > 0), wrappers);

describe('unwrapWrappers', () => {
	describe('single wrapper, no flags', () => {
		test('time make test → make test', () => {
			expect(unwrap('time make test')).toEqual(['make', 'test']);
		});

		test('nohup make deploy → make deploy', () => {
			expect(unwrap('nohup make deploy')).toEqual(['make', 'deploy']);
		});

		test('xargs ls → ls', () => {
			expect(unwrap('xargs ls')).toEqual(['ls']);
		});
	});

	describe('wrapper with flags (glued / double-dash / equals)', () => {
		test('time -p make test → make test', () => {
			expect(unwrap('time -p make test')).toEqual(['make', 'test']);
		});

		test('time --verbose make test → make test', () => {
			expect(unwrap('time --verbose make test')).toEqual(['make', 'test']);
		});

		test('time -o/tmp/x.log make test → make test (glued)', () => {
			expect(unwrap('time -o/tmp/x.log make test')).toEqual(['make', 'test']);
		});

		test('nohup -- make deploy → make deploy (bare double-dash consumed)', () => {
			expect(unwrap('nohup -- make deploy')).toEqual(['make', 'deploy']);
		});

		test('nice -n10 make build → make build (glued)', () => {
			expect(unwrap('nice -n10 make build')).toEqual(['make', 'build']);
		});

		test('xargs -n1 -P4 ls → ls', () => {
			expect(unwrap('xargs -n1 -P4 ls')).toEqual(['ls']);
		});

		test('xargs -I{} basename → basename (glued curly)', () => {
			expect(unwrap('xargs -I{} basename')).toEqual(['basename']);
		});

		test('xargs --max-args=1 ls → ls (equals form)', () => {
			expect(unwrap('xargs --max-args=1 ls')).toEqual(['ls']);
		});

		test('env --unset=TEST make → make (equals form)', () => {
			expect(unwrap('env --unset=TEST make')).toEqual(['make']);
		});
	});

	describe('space-form flag arguments (documented limitations)', () => {
		test('time -o /tmp/x.log make test → /tmp/x.log make test', () => {
			expect(unwrap('time -o /tmp/x.log make test')).toEqual(['/tmp/x.log', 'make', 'test']);
		});

		test('nice -n 10 make build → 10 make build', () => {
			expect(unwrap('nice -n 10 make build')).toEqual(['10', 'make', 'build']);
		});

		test('xargs -I {} basename → {} basename', () => {
			expect(unwrap('xargs -I {} basename')).toEqual(['{}', 'basename']);
		});

		test('env -u TEST make → TEST make', () => {
			expect(unwrap('env -u TEST make')).toEqual(['TEST', 'make']);
		});
	});

	describe('env-style assignment consumption', () => {
		test('env TEST=ci AWS_REGION=us-east-2 make deploy → make deploy', () => {
			expect(unwrap('env TEST=ci AWS_REGION=us-east-2 make deploy')).toEqual(['make', 'deploy']);
		});

		test('time TEST=ci make test → make test', () => {
			expect(unwrap('time TEST=ci make test')).toEqual(['make', 'test']);
		});

		test('leading assignments without a wrapper are stripped: TEST=ci make deploy → make deploy', () => {
			expect(unwrap('TEST=ci make deploy')).toEqual(['make', 'deploy']);
		});

		test('multiple leading assignments are all stripped', () => {
			expect(unwrap('TEST=ci AWS=us-east-2 make deploy')).toEqual(['make', 'deploy']);
		});
	});

	describe('chained wrappers', () => {
		test('time nohup nice make build → make build', () => {
			expect(unwrap('time nohup nice make build')).toEqual(['make', 'build']);
		});

		test('time nohup nice -X make build → make build (flag between wrappers consumed)', () => {
			expect(unwrap('time nohup nice -X make build')).toEqual(['make', 'build']);
		});
	});

	describe('edge cases', () => {
		test('bare wrapper (no further tokens) → unchanged', () => {
			expect(unwrap('nohup')).toEqual(['nohup']);
		});

		test('bare env → unchanged (so common-allowed-commands can fire)', () => {
			expect(unwrap('env')).toEqual(['env']);
		});

		test('wrapper with only flags → unchanged', () => {
			expect(unwrap('xargs -n1 -P4')).toEqual(['xargs', '-n1', '-P4']);
		});

		test('env with only flags → unchanged', () => {
			expect(unwrap('env -i')).toEqual(['env', '-i']);
		});

		test('sudo is NOT a wrapper — segment unchanged', () => {
			expect(unwrap('sudo make deploy')).toEqual(['sudo', 'make', 'deploy']);
		});

		test('non-wrapper first token is returned unchanged', () => {
			expect(unwrap('make -j8 deploy')).toEqual(['make', '-j8', 'deploy']);
		});

		test('flag-leading segment without a wrapper is returned unchanged', () => {
			expect(unwrap('-X make')).toEqual(['-X', 'make']);
		});

		test('empty token list is returned unchanged', () => {
			expect(unwrapWrappers([], wrappers)).toEqual([]);
		});

		test('bare hyphen (stdin marker) is NOT consumed as a flag', () => {
			expect(unwrap('xargs - cat')).toEqual(['-', 'cat']);
		});
	});

	describe('purity and bounds', () => {
		test('identical input produces identical output (pure)', () => {
			const input = ['time', 'nohup', 'make', 'test'];
			const first = unwrapWrappers(input, wrappers);
			const second = unwrapWrappers(input, wrappers);
			expect(first).toEqual(second);
		});

		test('does not mutate the input array', () => {
			const input = ['time', 'make', 'test'];
			unwrapWrappers(input, wrappers);
			expect(input).toEqual(['time', 'make', 'test']);
		});

		test('eight-deep chained wrappers fully unwrap (bound not exceeded)', () => {
			const input = ['time', 'nohup', 'nice', 'stdbuf', 'xargs', 'env', 'time', 'nohup', 'make'];
			expect(unwrapWrappers(input, wrappers)).toEqual(['make']);
		});

		test('beyond the bound the loop stops gracefully (no infinite loop)', () => {
			const input = Array(20).fill('time').concat(['make']);
			const result = unwrapWrappers(input, wrappers);
			expect(Array.isArray(result)).toBe(true);
		});
	});
});
