import { describe, expect, it } from 'vitest';
import {
  initialSelection,
  mergeSessions,
  moveSelection,
  type SessionView,
} from '../../../src/core';
import { session } from '../../fakes';

const views = (n: number, gone: number[] = []): SessionView[] =>
  Array.from({ length: n }, (_, i) => ({ ...session(i + 1), gone: gone.includes(i + 1) }));

describe('initialSelection', () => {
  it('prefers the last used session if still present', () => {
    expect(initialSelection([session(1), session(2)], 's2')).toBe('s2');
  });
  it('falls back to the first session', () => {
    expect(initialSelection([session(1), session(2)], 's9')).toBe('s1');
    expect(initialSelection([], null)).toBeNull();
  });
});

describe('moveSelection', () => {
  it('moves cyclically in both directions', () => {
    expect(moveSelection(views(3), 's3', 1)).toBe('s1');
    expect(moveSelection(views(3), 's1', -1)).toBe('s3');
    expect(moveSelection(views(5), 's1', 3)).toBe('s4');
  });
  it('skips gone sessions', () => {
    expect(moveSelection(views(4, [2]), 's1', 1)).toBe('s3');
    expect(moveSelection(views(4, [2]), 's2', 1)).toBe('s3');
  });
  it('keeps the selection when nothing is live', () => {
    expect(moveSelection(views(2, [1, 2]), 's1', 1)).toBe('s1');
  });
  it('selects the first/last live session when nothing was selected', () => {
    expect(moveSelection(views(3), null, 1)).toBe('s1');
    expect(moveSelection(views(3), null, -1)).toBe('s3');
  });
});

describe('mergeSessions', () => {
  it('keeps a vanished selected session at its place, marked as gone', () => {
    const merged = mergeSessions(views(3), [session(1), session(3)], 's2');
    expect(merged.map((v) => [v.id, v.gone])).toEqual([
      ['s1', false],
      ['s2', true],
      ['s3', false],
    ]);
  });
  it('drops vanished sessions that are not selected', () => {
    expect(mergeSessions(views(3), [session(1)], 's1').map((v) => v.id)).toEqual(['s1']);
  });
  it('adds new sessions', () => {
    expect(mergeSessions(views(1), [session(1), session(7)], 's1').map((v) => v.id)).toEqual([
      's1',
      's7',
    ]);
  });
});
