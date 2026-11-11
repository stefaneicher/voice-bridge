// Fake "Copilot" for integration tests: asks for folder trust, then shows the input field.
import { createInterface } from 'node:readline';

process.stdout.write('Confirm folder trust\nDo you trust the files in this folder?\n');
const rl = createInterface({ input: process.stdin });
let trusted = false;
rl.on('line', (line) => {
  // eslint-disable-next-line no-control-regex
  const text = line.replace(/\x1b\[20[01]~/g, '');
  if (text === 'exit') process.exit(0);
  if (!trusted) {
    trusted = true;
    process.stdout.write('/ for commands, or ? for shortcuts\n');
    return;
  }
  process.stdout.write(`ECHO:${text}\n`);
});
