ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text;
UPDATE public.profiles SET username = lower(split_part(email, '@', 1)) WHERE username IS NULL AND email ILIKE '%@staff.kkgroup.local';
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_key ON public.profiles (lower(username));
ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_format CHECK (username IS NULL OR username ~ '^[a-z0-9._-]{3,32}$');