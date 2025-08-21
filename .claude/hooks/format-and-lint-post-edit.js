import { exec as execWithCallback } from 'node:child_process';
import { json } from 'node:stream/consumers';

const data = await json(process.stdin);

const file = data.tool_input.file_path;

const prettier = `${process.env.CLAUDE_PROJECT_DIR}/node_modules/.bin/prettier`;
const eslint = `${process.env.CLAUDE_PROJECT_DIR}/node_modules/.bin/eslint`;

function exec(command) {
  return new Promise((resolve) => {
    const child = execWithCallback(
      command,
      (_, stdout, stderr) => {
        resolve({ stdout, stderr, exitCode: child.exitCode });
      },
      {},
    );
  });
}

const prettierCheck = await exec(`${prettier} --check ${file}`);
if (prettierCheck.exitCode !== 0) {
  console.error('File contains formatting errors. Auto-formatting...');
  await exec(`${prettier} --write ${file}`);
  console.error('File auto-formatted.');
}

const eslintCheck = await exec(`${eslint} ${file} --max-warnings 0`);
if (eslintCheck.exitCode !== 0) {
  console.error('File has linting errors.');
  console.error(eslintCheck.stdout);
  process.exit(2);
}
