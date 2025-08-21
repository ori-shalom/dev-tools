import { json } from 'node:stream/consumers';

const data = await json(process.stdin);

const [command] = data.tool_input.command.split(' ');

// if command is "npm" or "yarn", then block the command.
if (command === 'npm' || command === 'yarn') {
  console.error('This project is using `pnpm`, NOT `npm` or `yarn`!\nUse `pnpm` equivalents instead.');
  process.exit(2);
}
