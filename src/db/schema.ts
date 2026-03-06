import { pgTable, bigserial, text, jsonb, timestamp, numeric, bigint, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** The shape of the compliance JSONB stored in the cache */
export type ComplianceResult = {
  guessed_item: string;
  is_vegetarian: boolean;
  is_jain: boolean;
  is_upvas: boolean;
  is_swaminarayan: boolean;
  is_vegan: boolean;
  reason_vegetarian?: string | null;
  reason_jain?: string | null;
  reason_upvas?: string | null;
  reason_swaminarayan?: string | null;
  reason_vegan?: string | null;
};

export const ingredientCache = pgTable(
  "ingredient_cache",
  {
    id: bigserial({ mode: "number" }).primaryKey(),

    /** MD5 hash of normalized sorted ingredients — used for exact match */
    ingredientsHash: text("ingredients_hash").notNull().unique(),

    /** Sorted, normalized, lowercase ingredients as text array */
    ingredientsArray: text("ingredients_array").array().notNull(),

    /** Concatenated string for trigram fuzzy search (computed in app layer) */
    ingredientsText: text("ingredients_text").notNull(),

    /** Full compliance result */
    compliance: jsonb().$type<ComplianceResult>().notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    source: text(),
    confidence: numeric({ precision: 4, scale: 3 }).default("0.950"),
    hitCount: bigint("hit_count", { mode: "number" }).default(0),
  },
  (table) => [
    index("idx_ingredient_cache_array_exact").using("gin", table.ingredientsArray),
    index("idx_ingredient_cache_text_trgm").using("gin", sql`${table.ingredientsText} gin_trgm_ops`),
    index("idx_ingredient_cache_compliance").using("gin", table.compliance),
  ]
);
