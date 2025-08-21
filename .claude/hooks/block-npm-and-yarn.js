import { json } from 'node:stream/consumers';
import { stdin, exit } from 'node:process';
import { error } from 'node:console';

const data = await json(stdin);

const [command] = data.tool_input.command.split(' ');

// if command is "npm" or "yarn", then block the command.
if (command === 'npm' || command === 'yarn') {
  error('This project is using `pnpm`, NOT `npm` or `yarn`!\nUse `pnpm` equivalents instead.');
  exit(2);
}
