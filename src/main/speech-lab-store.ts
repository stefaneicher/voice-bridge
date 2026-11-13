import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { AudioClip } from '../core';
import {
  parseLabPackage,
  validLabId,
  type LabAttempt,
  type LabPackage,
} from '../shared/speech-lab';
import { writeJson } from './store';

export function labPackage(attempt: LabAttempt, clip: AudioClip): LabPackage {
  const result = parseLabPackage({
    schemaVersion: 1,
    attempt,
    audio: {
      mimeType: clip.mimeType,
      encoding: 'base64',
      data: Buffer.from(clip.data).toString('base64'),
    },
  });
  if (!result || Buffer.byteLength(JSON.stringify(result, null, 2) + '\n', 'utf8') > 12_000_000) {
    throw new Error('Testpaket ist ungültig oder zu gross.');
  }
  return result;
}

/** One self-contained JSON/WAV package per explicitly saved recording, in the profile directory. */
export class SpeechLabStore {
  constructor(private readonly directory: string) {}

  list(): { entries: LabAttempt[]; warning?: string } {
    if (!existsSync(this.directory)) return { entries: [] };
    const entries: LabAttempt[] = [];
    let invalid = 0;
    let files: string[];
    try {
      files = readdirSync(this.directory);
    } catch {
      return { entries, warning: 'Der lokale Testordner konnte nicht gelesen werden.' };
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const p = this.read(file.slice(0, -5));
      if (p) entries.push(p.attempt);
      else invalid++;
    }
    return {
      entries: entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      ...(invalid ? { warning: `${invalid} ungültige Testdatei(en) wurden übersprungen.` } : {}),
    };
  }

  read(id: string): LabPackage | null {
    if (!validLabId(id)) return null;
    try {
      const path = join(this.directory, `${id}.json`);
      if (statSync(path).size > 12_000_000) return null;
      const result = parseLabPackage(JSON.parse(readFileSync(path, 'utf8')));
      return result?.attempt.id === id ? result : null;
    } catch {
      return null;
    }
  }

  save(attempt: LabAttempt, clip: AudioClip, consent: boolean): void {
    if (consent !== true)
      throw new Error('Lokales Speichern braucht Ihre ausdrückliche Zustimmung.');
    const p = labPackage(attempt, clip);
    if (!this.read(attempt.id) && this.list().entries.length >= 100) {
      throw new Error('100 Tests gespeichert. Bitte zuerst einen alten Test löschen.');
    }
    const destination = join(this.directory, `${p.attempt.id}.json`);
    try {
      writeJson(destination, p);
    } catch (error) {
      const partial = `${destination}.${process.pid}.tmp`;
      if (existsSync(partial)) unlinkSync(partial);
      throw error;
    }
  }

  delete(id: string): void {
    if (!validLabId(id)) throw new Error('Ungültige Test-ID.');
    unlinkSync(join(this.directory, `${id}.json`));
  }
}
