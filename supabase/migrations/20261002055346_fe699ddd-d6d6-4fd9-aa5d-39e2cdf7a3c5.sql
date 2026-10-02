ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS department text;
UPDATE public.companies SET name='KK GROUP', legal_name=NULL, registered_address=NULL, office_address=NULL WHERE legal_name ILIKE 'KK Infra%' OR registered_address ILIKE '%Pune%';
UPDATE public.company_bank_accounts SET account_name='KK GROUP' WHERE account_name ILIKE 'KK Infra%';
UPDATE public.projects SET developer_details='KK GROUP' WHERE developer_details ILIKE 'KK Infra%';