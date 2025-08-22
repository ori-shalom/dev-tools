import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { toJSONSchema } from 'zod';
import { ConfigSchema } from './schema.js';

export function generateJsonSchema() {
  return toJSONSchema(ConfigSchema, {
    // We want the schema represent valid input values (allow optional fields) not the output values (with marked as required due to the default values)
    io: 'input',
  });
}

export async function writeJsonSchemaToFile(outputPath?: string) {
  const jsonSchema = generateJsonSchema();

  // Ensure schemas directory exists
  const schemaPath = outputPath || join(process.cwd(), 'schemas', 'config-schema.json');

  await mkdir(dirname(schemaPath), { recursive: true }).catch(() => {});

  // Write the JSON schema
  await writeFile(schemaPath, JSON.stringify(jsonSchema, null, 2));

  return schemaPath;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const schemaPath = await writeJsonSchemaToFile();
  console.log(`Generated JSON schema at: ${schemaPath}`);
}
