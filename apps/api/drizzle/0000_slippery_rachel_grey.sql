CREATE TABLE `branch` (
	`branch_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branch_name_unique` ON `branch` (`name`);--> statement-breakpoint
CREATE TABLE `ingredient_category` (
	`category_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ingredient_category_order_idx` ON `ingredient_category` (`sort_order`);--> statement-breakpoint
CREATE TABLE `ingredient_item` (
	`item_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`name` text NOT NULL,
	`default_unit` text,
	`default_unit_option` text,
	`default_base_usage` real,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `ingredient_category`(`category_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ingredient_item_category_order_idx` ON `ingredient_item` (`category_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `ingredient_line` (
	`line_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`record_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`unit` text,
	`unit_option` text,
	`base_usage` real,
	`actual_usage` real,
	`verdict` text DEFAULT '정상' NOT NULL,
	`cause` text,
	`stock` real,
	`prev_unit_price` real,
	`unit_price` real,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `ingredient_record`(`record_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `ingredient_item`(`item_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingredient_line_unique_item` ON `ingredient_line` (`record_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `ingredient_line_item_idx` ON `ingredient_line` (`item_id`);--> statement-breakpoint
CREATE TABLE `ingredient_record` (
	`record_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`business_date` text NOT NULL,
	`manager_name` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branch`(`branch_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingredient_record_unique_run` ON `ingredient_record` (`branch_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `ingredient_record_branch_date_idx` ON `ingredient_record` (`branch_id`,`business_date`);--> statement-breakpoint
CREATE TABLE `ingredient_unit_option` (
	`option_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`unit` text NOT NULL,
	`value` real NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingredient_unit_option_unique_unit_value` ON `ingredient_unit_option` (`unit`,`value`);--> statement-breakpoint
CREATE INDEX `ingredient_unit_option_unit_order_idx` ON `ingredient_unit_option` (`unit`,`sort_order`);--> statement-breakpoint
CREATE TABLE `operation_check` (
	`check_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`record_id` integer NOT NULL,
	`item_key` text NOT NULL,
	`section_name` text,
	`item_label` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`checked` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `operation_record`(`record_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_check_unique_item` ON `operation_check` (`record_id`,`item_key`);--> statement-breakpoint
CREATE TABLE `operation_record` (
	`record_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`business_date` text NOT NULL,
	`checklist_id` integer NOT NULL,
	`phase` text NOT NULL,
	`checklist_name` text NOT NULL,
	`total_score` integer DEFAULT 0 NOT NULL,
	`total_items` integer DEFAULT 0 NOT NULL,
	`manager_name` text,
	`manager_position` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branch`(`branch_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_record_unique_run` ON `operation_record` (`branch_id`,`business_date`,`checklist_id`);--> statement-breakpoint
CREATE INDEX `operation_record_branch_date_idx` ON `operation_record` (`branch_id`,`business_date`);--> statement-breakpoint
CREATE TABLE `product_item` (
	`item_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`default_unit` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `product_item_order_idx` ON `product_item` (`sort_order`);--> statement-breakpoint
CREATE TABLE `product_line` (
	`line_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`record_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`stock` real,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `product_record`(`record_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `product_item`(`item_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_line_unique_item` ON `product_line` (`record_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `product_record` (
	`record_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`business_date` text NOT NULL,
	`manager_name` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branch`(`branch_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_record_unique_run` ON `product_record` (`branch_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `product_record_branch_date_idx` ON `product_record` (`branch_id`,`business_date`);