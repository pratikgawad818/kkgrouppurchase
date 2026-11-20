-- 0084: Add the Senior Sales Executive as a dedicated app role.
-- It receives NO general procurement, inventory-management or finance rights.
-- PostgreSQL enum additions must commit before the new value is used by
-- the next migration.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'senior_sales_executive';
