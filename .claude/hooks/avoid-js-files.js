import { json } from 'node:stream/consumers';

const data = await json(process.stdin);

const isJsFile = data.tool_input.file_path.match(/\.[cm]?js$/);

if (isJsFile) {
  console.error('Avoid JavaScript files. Use TypeScript instead.');
  process.exit(2);
}
