import { z } from 'zod';

/**
 * Schema for the main config file loaded by the cli.
 * @type {ZodObject<{apis: ZodArray<ZodString, "many">}, "strip", ZodTypeAny, {[k_1 in keyof objectUtil.addQuestionMarks<{[k in keyof {apis: ZodArray<ZodString, "many">}]: {apis: ZodArray<ZodString, "many">}[k]["_output"]}>]: objectUtil.addQuestionMarks<{[k in keyof {apis: ZodArray<ZodString, "many">}]: {apis: ZodArray<ZodString, "many">}[k]["_output"]}>[k_1]}, {[k_3 in keyof objectUtil.addQuestionMarks<{[k_2 in keyof {apis: ZodArray<ZodString, "many">}]: {apis: ZodArray<ZodString, "many">}[k_2]["_input"]}>]: objectUtil.addQuestionMarks<{[k_2 in keyof {apis: ZodArray<ZodString, "many">}]: {apis: ZodArray<ZodString, "many">}[k_2]["_input"]}>[k_3]}>}
 */
export const configFileSchema = z.object({
  apis: z.array(z.string())
});
