import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { ingredientCache, type ComplianceResult } from "./db/schema";
import { normalizeIngredients } from "./normalize";

const FUZZY_THRESHOLD = 0.75;

/**
 * Look up ingredients in the cache.
 * 1. Try exact match via MD5 hash
 * 2. Fall back to trigram fuzzy match on concatenated text
 * Returns the compliance result if found, or null if cache miss.
 */
export async function lookupCache(
  ingredients: string[]
): Promise<{ compliance: ComplianceResult; exact: boolean } | null> {
  const { hash, text } = normalizeIngredients(ingredients);

  // 1. Exact match
  const exactRows = await db
    .select({ id: ingredientCache.id, compliance: ingredientCache.compliance })
    .from(ingredientCache)
    .where(eq(ingredientCache.ingredientsHash, hash))
    .limit(1);

  const row = exactRows[0];
  if (row) {
    // Increment hit count
    await db
      .update(ingredientCache)
      .set({
        hitCount: sql`${ingredientCache.hitCount} + 1`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(ingredientCache.id, row.id));

    return { compliance: row.compliance!, exact: true };
  }

  // 2. Fuzzy match via trigram similarity
  const fuzzyRows = await db
    .select({
      id: ingredientCache.id,
      compliance: ingredientCache.compliance,
      simScore: sql<number>`similarity(${ingredientCache.ingredientsText}, ${text})`.mapWith(Number),
    })
    .from(ingredientCache)
    .where(sql`${ingredientCache.ingredientsText} % ${text}`)
    .orderBy(sql`similarity(${ingredientCache.ingredientsText}, ${text}) DESC`)
    .limit(3);

  const best = fuzzyRows[0];
  if (best && best.simScore >= FUZZY_THRESHOLD) {
    // Increment hit count
    await db
      .update(ingredientCache)
      .set({
        hitCount: sql`${ingredientCache.hitCount} + 1`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(ingredientCache.id, best.id));

    return { compliance: best.compliance!, exact: false };
  }

  return null;
}

/**
 * Insert a new compliance result into the cache after an LLM call.
 */
export async function insertCache(
  ingredients: string[],
  compliance: ComplianceResult,
  source: string = "ocr"
): Promise<number | undefined> {
  const { array, hash, text } = normalizeIngredients(ingredients);

  const rows = await db
    .insert(ingredientCache)
    .values({
      ingredientsHash: hash,
      ingredientsArray: array,
      ingredientsText: text,
      compliance,
      source,
    })
    .onConflictDoNothing()
    .returning({ id: ingredientCache.id });

  return rows[0]?.id;
}
