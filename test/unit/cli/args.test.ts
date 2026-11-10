import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../../../src/cli/args';
import { resolveSpawn } from '../../../src/cli/run';

describe('vb arguments', () => {
  it('parses run with options and command', () => {
    expect(
      parseCliArgs(
        ['run', '--profile', 'citrix', '--name', 'billing', '--', 'copilot', '--resume'],
        {},
      ),
    ).toEqual({
      kind: 'run',
      profile: 'citrix',
      name: 'billing',
      title: undefined,
      command: 'copilot',
      args: ['--resume'],
    });
  });
  it('uses VB_PROFILE and allows omitting --', () => {
    expect(parseCliArgs(['run', 'copilot'], { VB_PROFILE: 'citrix' })).toMatchObject({
      profile: 'citrix',
      command: 'copilot',
    });
  });
  it('reports errors and help', () => {
    expect(parseCliArgs([], {})).toEqual({ kind: 'help' });
    expect(parseCliArgs(['run', '--'], {})).toMatchObject({ kind: 'error' });
    expect(parseCliArgs(['run', '--name'], {})).toMatchObject({ kind: 'error' });
    expect(parseCliArgs(['launch'], {})).toMatchObject({ kind: 'error' });
    expect(parseCliArgs(['--version'], {})).toEqual({ kind: 'version' });
  });
});

describe('resolveSpawn', () => {
  it('runs npm .cmd shims through cmd.exe on Windows', () => {
    const env = { Path: 'C:\\npm', PATHEXT: '.EXE;.CMD', ComSpec: 'C:\\Windows\\cmd.exe' };
    const exists = (p: string) => p.toLowerCase().endsWith('copilot.cmd');
    expect(resolveSpawn('copilot', ['--x'], env, 'win32', exists)).toEqual({
      file: 'C:\\Windows\\cmd.exe',
      args: ['/d', '/s', '/c', expect.stringMatching(/copilot\.cmd$/i), '--x'],
    });
  });
  it('starts .exe files directly and leaves other platforms alone', () => {
    const exists = (p: string) => p.endsWith('agent.EXE');
    expect(
      resolveSpawn('agent', [], { PATH: '/bin', PATHEXT: '.EXE' }, 'win32', exists).file,
    ).toMatch(/agent\.EXE$/);
    expect(resolveSpawn('copilot', ['a'], {}, 'linux')).toEqual({ file: 'copilot', args: ['a'] });
  });
});
