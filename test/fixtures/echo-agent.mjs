// Minimal "agent" for integration tests: echoes every submitted line.
import { createInterface } from 'node:readline';

process.stdout.write('echo-agent bereit\n');
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  // eslint-disable-next-line no-control-regex
  const text = line.replace(/\x1b\[20[01]~/g, '');
  if (text === 'exit') process.exit(0);
  process.stdout.write(`ECHO:${text}\n`);
});
