import { pipePath } from '../agents/pipe';
import { USAGE, parseCliArgs } from './args';
import { loadNodePty } from './pty';
import { runWrapped } from './run';

declare const __APP_VERSION__: string;

async function main(): Promise<number> {
  const cmd = parseCliArgs(process.argv.slice(2));
  switch (cmd.kind) {
    case 'help':
      process.stdout.write(USAGE);
      return 0;
    case 'version':
      process.stdout.write(`${__APP_VERSION__}\n`);
      return 0;
    case 'error':
      process.stderr.write(`vb: ${cmd.message}\n\n${USAGE}`);
      return 2;
    case 'run': {
      const pty = loadNodePty();
      const handle = runWrapped({
        command: cmd.command,
        args: cmd.args,
        name: cmd.name,
        title: cmd.title,
        pipePath: pipePath(cmd.profile),
        spawn: pty.spawn,
      });
      return handle.exited;
    }
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`vb: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
