-- New installations must create the permission before assigning it.
-- Earlier production databases already contain this permission.
INSERT INTO public.permissions(code,module,description,sort_order)
VALUES ('vendors.manage','Vendors','Create and edit vendors and classifications',73)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions(role,permission_code)
VALUES ('accounts_manager','vendors.manage')
ON CONFLICT DO NOTHING;
