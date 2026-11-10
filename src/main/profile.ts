import { DEFAULT_PROFILE, sanitizeName } from '../agents/pipe';

/** Reads `--profile <name>` / `--profile=<name>` (ADR-006). Falls back to $VB_PROFILE, then "privat". */
export function parseProfileArg(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--profile' && argv[i + 1]) return sanitizeName(argv[i + 1]!);
    if (a.startsWith('--profile=')) return sanitizeName(a.slice('--profile='.length));
  }
  return sanitizeName(env.VB_PROFILE || DEFAULT_PROFILE);
}
