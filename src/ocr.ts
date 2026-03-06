import { Agent, run } from '@openai/agents';
import { groq } from '@ai-sdk/groq'
import { aisdk } from '@openai/agents-extensions';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { z } from 'zod';

const model = aisdk(groq('meta-llama/llama-4-maverick-17b-128e-instruct'))

const IngredientSchema = z.object({
  is_food_item: z.boolean().describe("true if the image shows a food/beverage product's ingredient list, false if it's a non-food item like toothpaste, shampoo, soap, detergent, etc."),
  rejection_reason: z.string().nullable().describe("If is_food_item is false, a short reason like 'This appears to be a shampoo label'. Null if is_food_item is true."),
  ingredients: z.array(z.string()).describe("List of ingredients extracted from the image. Empty array if is_food_item is false.")
});

const agent = new Agent({
  name: 'Ingredient Extractor',
  instructions:
    'Extract Ingredients from Given Image',
    model,
    outputType: IngredientSchema,
});

export async function ocr(imagePath: string) {
  const absolutePath = resolve(imagePath);
  const imageBuffer = readFileSync(absolutePath);
  return ocrFromBuffer(imageBuffer);
}

export async function ocrFromBuffer(imageBuffer: Buffer) {
  const imageDataUrl = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

  const input = [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text: `First, determine if this image shows the ingredient list of a FOOD or BEVERAGE product. If it is a non-food item (e.g. toothpaste, shampoo, hair oil, soap, mosquito repellent, detergent, floor cleaner, cosmetics, medicine, cleaning products, or any non-edible product), set is_food_item to false, provide a short rejection_reason, and return an empty ingredients array.

Only if it IS a food/beverage product: Extract the ingredients list. Output ONE ingredient per item. Exclude percentages, quantities, and parentheses. Split compound ingredients (e.g., 'EMULSIFIER (SOY LECITHIN)' becomes ['emulsifier', 'soy lecithin']). Return lowercase, deduplicated ingredient names only.`,
        },
        {
          type: "input_image" as const,
          image: imageDataUrl,
          detail: "high" as const,
        },
      ],
    },
  ];

  const result = await run(agent, input);
  return result.finalOutput;
}