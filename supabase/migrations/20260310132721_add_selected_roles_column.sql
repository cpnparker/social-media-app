ALTER TABLE intelligence.users_access
ADD COLUMN IF NOT EXISTS data_selected_roles jsonb DEFAULT '[]'::jsonb;
