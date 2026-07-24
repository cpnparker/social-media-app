-- Add AuthorityOn access flag to users_access table
ALTER TABLE intelligence.users_access
ADD COLUMN IF NOT EXISTS flag_access_authorityon smallint NOT NULL DEFAULT 0;
