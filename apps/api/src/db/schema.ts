import { relations, sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const timestamp = () => text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`);
const updatedAt = () => text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`);

export const branch = sqliteTable('branch', {
  branchId: integer('branch_id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  isActive: integer('is_active').notNull().default(1),
  createdAt: timestamp(),
});

export const loginAttempt = sqliteTable('login_attempt', {
  loginKey: text('login_key').primaryKey(),
  count: integer('count').notNull().default(0),
  firstAt: integer('first_at').notNull(),
  blockedUntil: integer('blocked_until').notNull().default(0),
  updatedAt: updatedAt(),
});

export const operationRecord = sqliteTable(
  'operation_record',
  {
    recordId: integer('record_id').primaryKey({ autoIncrement: true }),
    branchId: integer('branch_id').notNull().references(() => branch.branchId),
    businessDate: text('business_date').notNull(),
    checklistId: integer('checklist_id').notNull(),
    phase: text('phase').notNull(),
    checklistName: text('checklist_name').notNull(),
    totalScore: integer('total_score').notNull().default(0),
    totalItems: integer('total_items').notNull().default(0),
    managerName: text('manager_name'),
    managerPosition: text('manager_position'),
    managers: text('managers'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    uniqueRun: uniqueIndex('operation_record_unique_run').on(table.branchId, table.businessDate, table.checklistId),
    byBranchDate: index('operation_record_branch_date_idx').on(table.branchId, table.businessDate),
  }),
);

export const operationCheck = sqliteTable(
  'operation_check',
  {
    checkId: integer('check_id').primaryKey({ autoIncrement: true }),
    recordId: integer('record_id').notNull().references(() => operationRecord.recordId, { onDelete: 'cascade' }),
    itemKey: text('item_key').notNull(),
    sectionName: text('section_name'),
    itemLabel: text('item_label').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    checked: integer('checked').notNull().default(0),
  },
  (table) => ({
    uniqueItem: uniqueIndex('operation_check_unique_item').on(table.recordId, table.itemKey),
  }),
);

export const ingredientCategory = sqliteTable(
  'ingredient_category',
  {
    categoryId: integer('category_id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active').notNull().default(1),
    version: integer('version').notNull().default(1),
    createdAt: timestamp(),
  },
  (table) => ({
    byOrder: index('ingredient_category_order_idx').on(table.sortOrder),
  }),
);

export const ingredientItem = sqliteTable(
  'ingredient_item',
  {
    itemId: integer('item_id').primaryKey({ autoIncrement: true }),
    categoryId: integer('category_id').notNull().references(() => ingredientCategory.categoryId),
    name: text('name').notNull(),
    defaultUnit: text('default_unit'),
    defaultUnitOption: text('default_unit_option'),
    defaultBaseUsage: real('default_base_usage'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active').notNull().default(1),
    version: integer('version').notNull().default(1),
    createdAt: timestamp(),
  },
  (table) => ({
    byCategoryOrder: index('ingredient_item_category_order_idx').on(table.categoryId, table.sortOrder),
  }),
);

export const ingredientUnitOption = sqliteTable(
  'ingredient_unit_option',
  {
    optionId: integer('option_id').primaryKey({ autoIncrement: true }),
    unit: text('unit').notNull(),
    value: real('value').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active').notNull().default(1),
    version: integer('version').notNull().default(1),
    createdAt: timestamp(),
  },
  (table) => ({
    uniqueUnitValue: uniqueIndex('ingredient_unit_option_unique_unit_value').on(table.unit, table.value),
    byUnitOrder: index('ingredient_unit_option_unit_order_idx').on(table.unit, table.sortOrder),
  }),
);

export const ingredientRecord = sqliteTable(
  'ingredient_record',
  {
    recordId: integer('record_id').primaryKey({ autoIncrement: true }),
    branchId: integer('branch_id').notNull().references(() => branch.branchId),
    businessDate: text('business_date').notNull(),
    managerName: text('manager_name'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    uniqueRun: uniqueIndex('ingredient_record_unique_run').on(table.branchId, table.businessDate),
    byBranchDate: index('ingredient_record_branch_date_idx').on(table.branchId, table.businessDate),
  }),
);

export const ingredientLine = sqliteTable(
  'ingredient_line',
  {
    lineId: integer('line_id').primaryKey({ autoIncrement: true }),
    recordId: integer('record_id').notNull().references(() => ingredientRecord.recordId, { onDelete: 'cascade' }),
    itemId: integer('item_id').notNull().references(() => ingredientItem.itemId),
    unit: text('unit'),
    unitOption: text('unit_option'),
    baseUsage: real('base_usage'),
    actualUsage: real('actual_usage'),
    verdict: text('verdict').notNull().default('정상'),
    cause: text('cause'),
    stock: real('stock'),
    prevUnitPrice: real('prev_unit_price'),
    unitPrice: real('unit_price'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => ({
    uniqueItem: uniqueIndex('ingredient_line_unique_item').on(table.recordId, table.itemId),
    byItem: index('ingredient_line_item_idx').on(table.itemId),
  }),
);

export const productItem = sqliteTable(
  'product_item',
  {
    itemId: integer('item_id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    defaultUnit: text('default_unit'),
    spareStock: real('spare_stock'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active').notNull().default(1),
    version: integer('version').notNull().default(1),
    createdAt: timestamp(),
  },
  (table) => ({
    byOrder: index('product_item_order_idx').on(table.sortOrder),
  }),
);

export const productRecord = sqliteTable(
  'product_record',
  {
    recordId: integer('record_id').primaryKey({ autoIncrement: true }),
    branchId: integer('branch_id').notNull().references(() => branch.branchId),
    businessDate: text('business_date').notNull(),
    managerName: text('manager_name'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    uniqueRun: uniqueIndex('product_record_unique_run').on(table.branchId, table.businessDate),
    byBranchDate: index('product_record_branch_date_idx').on(table.branchId, table.businessDate),
  }),
);

export const productLine = sqliteTable(
  'product_line',
  {
    lineId: integer('line_id').primaryKey({ autoIncrement: true }),
    recordId: integer('record_id').notNull().references(() => productRecord.recordId, { onDelete: 'cascade' }),
    itemId: integer('item_id').notNull().references(() => productItem.itemId),
    unit: text('unit'),
    stock: real('stock'),
    restockQty: real('restock_qty'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => ({
    uniqueItem: uniqueIndex('product_line_unique_item').on(table.recordId, table.itemId),
  }),
);

export const ingredientCategoryRelations = relations(ingredientCategory, ({ many }) => ({
  items: many(ingredientItem),
}));

export const ingredientItemRelations = relations(ingredientItem, ({ one }) => ({
  category: one(ingredientCategory, {
    fields: [ingredientItem.categoryId],
    references: [ingredientCategory.categoryId],
  }),
}));

export type Branch = typeof branch.$inferSelect;
