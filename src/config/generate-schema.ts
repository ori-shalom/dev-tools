import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { toJSONSchema } from 'zod';
import { ConfigSchema } from './schema.js';

const jsonSchema = toJSONSchema(ConfigSchema, {
  // We want the schema represent valid input values (allow optional fields) not the output values (with marked as required due to the default values)
  io: 'input',
});

// Ensure schemas directory exists
const schemaPath = join(process.cwd(), 'schemas', 'config-schema.json');

await mkdir(dirname(schemaPath), { recursive: true }).catch(() => {});

// Write the JSON schema
await writeFile(schemaPath, JSON.stringify(jsonSchema, null, 2));

console.log(`Generated JSON schema at: ${schemaPath}`);
