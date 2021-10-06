import { z } from 'zod';

/**
 * Schema for the main config file loaded by the cli.
 * @type {ZodObject<{basePath: ZodOptional<ZodString>, apis: ZodArray<ZodString>}, "strip", ZodTypeAny, {[k_1 in keyof objectUtil.addQuestionMarks<{[k in keyof {basePath: ZodOptional<ZodString>, apis: ZodArray<ZodString>}]: {basePath: ZodOptional<ZodString>, apis: ZodArray<ZodString>}[k]["_output"]}>]: objectUtil.addQuestionMarks<{[k in keyof {basePath: ZodOptional<ZodString>, apis: ZodArray<ZodString>}]: {basePath: ZodOptional<ZodString>, apis: ZodArray<ZodString>}[k]["_output"]}>[k_1]}, {[k_3 in keyof objectUtil.addQuestionMarks<{[k_2 in keyof {basePath: ZodOptional<ZodString>, apis: ZodArray<ZodString>}]: {basePath: ZodOptional<ZodString>, apis: ZodArray<ZodString>}[k_2]["_input"]}>]: objectUtil.addQuestionMarks<{[k_2 in keyof {basePath: ZodOptional<ZodString>, apis: ZodArray<ZodString>}]: {basePath: ZodOptional<ZodString>, apis: ZodArray<ZodString>}[k_2]["_input"]}>[k_3]}>}
 */
export const configFileSchema = z.object({
  basePath: z.string().default(''),
  apis: z.string().array()
});
