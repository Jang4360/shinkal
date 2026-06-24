import { and, eq } from 'drizzle-orm';
import { getDb } from './client';
import { branch, ingredientCategory, ingredientItem, ingredientUnitOption, productItem } from './schema';
import { branchesSeed, ingredientCategoriesSeed, ingredientUnitOptionsSeed, productItemsSeed } from './seed-data';

const db = getDb();

async function seedBranches() {
  for (const [index, name] of branchesSeed.entries()) {
    await db.insert(branch).values({ name, isActive: 1 }).onConflictDoNothing({ target: branch.name });
  }
}

async function seedIngredientUnitOptions() {
  for (const group of ingredientUnitOptionsSeed) {
    for (const [index, value] of group.values.entries()) {
      await db
        .insert(ingredientUnitOption)
        .values({ unit: group.unit, value, sortOrder: index, isActive: 1 })
        .onConflictDoNothing({ target: [ingredientUnitOption.unit, ingredientUnitOption.value] });
    }
  }
}

async function seedIngredientCatalog() {
  for (const [categoryIndex, categorySeed] of ingredientCategoriesSeed.entries()) {
    const existing = await db
      .select()
      .from(ingredientCategory)
      .where(eq(ingredientCategory.name, categorySeed.name))
      .limit(1);

    const categoryId =
      existing[0]?.categoryId ??
      (
        await db
          .insert(ingredientCategory)
          .values({ name: categorySeed.name, sortOrder: categoryIndex, isActive: 1 })
          .returning({ categoryId: ingredientCategory.categoryId })
      )[0].categoryId;

    for (const [itemIndex, name] of categorySeed.items.entries()) {
      const exists = await db
        .select({ itemId: ingredientItem.itemId })
        .from(ingredientItem)
        .where(and(eq(ingredientItem.categoryId, categoryId), eq(ingredientItem.name, name)))
        .limit(1);
      if (exists.length === 0) {
        await db.insert(ingredientItem).values({
          categoryId,
          name,
          defaultUnit: 'Kg',
          sortOrder: itemIndex,
          isActive: 1,
        });
      }
    }
  }
}

async function seedProductItems() {
  for (const [index, item] of productItemsSeed.entries()) {
    const exists = await db.select({ itemId: productItem.itemId }).from(productItem).where(eq(productItem.name, item.name)).limit(1);
    if (exists.length === 0) {
      await db.insert(productItem).values({ name: item.name, defaultUnit: item.defaultUnit, spareStock: item.spareStock, sortOrder: index, isActive: 1 });
    } else {
      await db
        .update(productItem)
        .set({ defaultUnit: item.defaultUnit, spareStock: item.spareStock })
        .where(and(eq(productItem.itemId, exists[0].itemId), eq(productItem.isActive, 1)));
    }
  }
}

await seedBranches();
await seedIngredientUnitOptions();
await seedIngredientCatalog();
await seedProductItems();

console.log('Seed data applied');
