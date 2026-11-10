import { DEFAULT_PROFILE } from '../agents/pipe';

export type CliCommand =
  | { kind: 'help' }
  | { kind: 'version' }
  | {
      kind: 'run';
      profile: string;
      name?: string;
      title?: string;
      command: string;
      args: string[];
    }
  | { kind: 'error'; message: string };

export const USAGE = `Voice-Bridge Wrapper

Verwendung:
  vb run [--profile <name>] [--name <name>] [--title <text>] -- <befehl> [argumente...]

Beispiele:
  vb run -- copilot
  vb run --profile citrix --name billing -- copilot

Optionen:
  --profile <name>  Profil der Voice-Bridge-Instanz (Standard: $VB_PROFILE oder "${DEFAULT_PROFILE}")
  --name <name>     Anzeigename im Session-Popup (Standard: Ordnername)
  --title <text>    Kurzbeschreibung im Session-Popup
  -h, --help        Hilfe anzeigen
  -v, --version     Version anzeigen
`;

export function parseCliArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CliCommand {
  const [sub, ...rest] = argv;
  if (!sub || sub === '-h' || sub === '--help' || sub === 'help') return { kind: 'help' };
  if (sub === '-v' || sub === '--version') return { kind: 'version' };
  if (sub !== 'run') return { kind: 'error', message: `Unbekannter Befehl: ${sub}` };

  let profile = env.VB_PROFILE || DEFAULT_PROFILE;
  let name: string | undefined;
  let title: string | undefined;
  let i = 0;
  for (; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--') {
      i++;
      break;
    }
    const value = rest[i + 1];
    if (a === '--profile' || a === '--name' || a === '--title') {
      if (value === undefined || value === '--') {
        return { kind: 'error', message: `${a} braucht einen Wert` };
      }
      if (a === '--profile') profile = value;
      else if (a === '--name') name = value;
      else title = value;
      i++;
      continue;
    }
    if (a === '-h' || a === '--help') return { kind: 'help' };
    if (a.startsWith('-')) {
      const hint = a.startsWith('--') ? ` Meintest du: vb run -- ${a.slice(2)}` : '';
      return { kind: 'error', message: `Unbekannte Option: ${a}.${hint}` };
    }
    // First non-option starts the command (the `--` is recommended but optional).
    break;
  }
  const [command, ...args] = rest.slice(i);
  if (!command) return { kind: 'error', message: 'Kein Befehl angegeben, z. B. vb run -- copilot' };
  return { kind: 'run', profile, name, title, command, args };
}
