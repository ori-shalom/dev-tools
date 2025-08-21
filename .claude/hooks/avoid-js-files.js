import { json } from 'node:stream/consumers';
import { stdin, exit } from 'node:process';
import { error } from 'node:console';

const data = await json(stdin);

const isJsFile = data.tool_input.file_path.match(/\.[cm]?js$/);

if (isJsFile) {
  error('Avoid JavaScript files. Use TypeScript instead.');
  exit(2);
}
