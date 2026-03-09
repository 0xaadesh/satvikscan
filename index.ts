import { ocr } from './src/ocr';
import { checkDiet } from './src/dietChecker';
import { lookupCache, insertCache } from './src/cache';

// Skip flags (e.g. --cwd injected by pm2)
const imagePath = process.argv.slice(2).find(arg => !arg.startsWith("-"));

// If no image path provided, start the web server
if (!imagePath) {
  await import('./src/server');
} else {
  // CLI mode
  const ocrResult = await ocr(imagePath);

  if (!ocrResult?.is_food_item) {
    console.error(ocrResult?.rejection_reason ?? 'This does not appear to be a food product. Please upload a food/beverage ingredient label.');
    process.exit(1);
  }

  const ingredients = ocrResult.ingredients;
  console.log('Ingredients:', ingredients);

  // Try cache first
  const cached = await lookupCache(ingredients);

  if (cached) {
    console.log(`Compliance (cached, ${cached.exact ? 'exact match' : 'fuzzy match'}):`, cached.compliance);
  } else {
    // Cache miss — call LLM
    const compliance = await checkDiet(ingredients);
    console.log('Compliance:', compliance);

    // Store in cache for future lookups
    if (compliance) {
      await insertCache(ingredients, compliance, 'ocr');
      console.log('Result cached for future scans.');
    }
  }
}