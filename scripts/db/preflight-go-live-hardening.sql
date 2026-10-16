-- Read only. Never include keys, endpoint tokens, email addresses or real documents.
SELECT jsonb_build_object(
  'atomic_pr_installed',to_regprocedure('public.save_purchase_request(uuid,uuid,jsonb,jsonb,boolean,timestamptz)') IS NOT NULL,
  'atomic_rfq_installed',to_regprocedure('public.create_rfq_draft(uuid,uuid,jsonb,uuid[])') IS NOT NULL,
  'actor_names_installed',to_regprocedure('public.document_actor_names(text,uuid[])') IS NOT NULL,
  'scoped_notifications_installed',to_regprocedure('public.notify_document_approvers(text,uuid,uuid,uuid,text,text,text)') IS NOT NULL,
  'old_unscoped_helper_absent',to_regprocedure('public.notify_permission_holders(text,uuid,text,text,text)') IS NULL,
  'push_registration_installed',to_regprocedure('public.register_my_push_subscription(text,text,text)') IS NOT NULL,
  'can_install_auth_email_trigger',has_table_privilege(current_user,'auth.users','TRIGGER'),
  'zero_value_test_stock_lines',(SELECT count(*) FROM public.warehouse_stock WHERE quantity_on_hand>0 AND total_value=0),
  'over_quota_push_accounts',(SELECT count(*) FROM (SELECT user_id FROM public.push_subscriptions GROUP BY user_id HAVING count(*)>10) x),
  'existing_push_key_shapes_valid',(SELECT coalesce(bool_and(p256dh ~ '^[A-Za-z0-9_-]{87}=?$' AND auth ~ '^[A-Za-z0-9_-]{22}(==)?$'),true) FROM public.push_subscriptions),
  'journal_entry_count',(SELECT count(*) FROM public.journal_entries),
  'journal_line_count',(SELECT count(*) FROM public.journal_lines),
  'stock_movement_count',(SELECT count(*) FROM public.inventory_transactions)
) AS release_preflight;
