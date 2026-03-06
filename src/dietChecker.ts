import { Agent, run } from '@openai/agents';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import z from 'zod';

// Load prompt instructions from prompt.md (update the file with the new prompt above)
const promptPath = resolve(import.meta.dirname!, 'prompt.md');
const instructions = readFileSync(promptPath, 'utf-8');

export const ComplianceSchema = z.object({
  guessed_item: z.string(),

  is_vegetarian: z.boolean(),
  is_jain: z.boolean(),
  is_upvas: z.boolean(),
  is_swaminarayan: z.boolean(),
  is_vegan: z.boolean(),

  reason_vegetarian:   z.string().nullable().optional(), 
  reason_jain:         z.string().nullable().optional(),
  reason_upvas:         z.string().nullable().optional(),
  reason_swaminarayan: z.string().nullable().optional(),
  reason_vegan:        z.string().nullable().optional(),
});

const agent = new Agent({
  name: 'Diet Compliance Checker',
  instructions,
  model: "gpt-5.2",
  outputType: ComplianceSchema,
});

export async function checkDiet(ingredients: string[]) {
  const input = JSON.stringify({ ingredients });
  const result = await run(agent, input);
  return result.finalOutput; 
}