const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Check social table for engagement columns
  const { data: social } = await s.from('social').select('*').limit(1);
  const cols = Object.keys(social[0] || {});
  const engagementCols = cols.filter(c =>
    c.includes('engage') || c.includes('impression') ||
    c.includes('reaction') || c.includes('click') ||
    c.includes('share') || c.includes('view')
  );
  console.log('Social engagement columns:', engagementCols.length ? engagementCols.join(', ') : 'NONE');

  // Check for possible analytics/engagement tables
  const testTables = [
    'distribution', 'distribution_data', 'analytics_data',
    'social_analytics', 'post_analytics', 'metrics', 'social_metrics',
    'client_user', 'client_users', 'user_clients', 'client_members',
    'campaigns', 'topics', 'events', 'tags', 'types',
    'content_types', 'units', 'unit_definitions'
  ];

  for (const t of testTables) {
    const { count, error } = await s.from(t).select('*', { count: 'exact', head: true });
    if (error === null) {
      console.log('Table EXISTS: ' + t + ' (' + count + ' rows)');
    }
  }

  // Check id_distribution on social table
  const { data: withDist } = await s.from('social')
    .select('id_social, id_distribution, network')
    .not('id_distribution', 'is', null)
    .limit(3);
  console.log('\nSocial rows with id_distribution:', JSON.stringify(withDist));

  // Check how clients relate to users
  const { data: clientMgrs } = await s.from('clients')
    .select('id_client, name_client, user_account_manager')
    .limit(5);
  console.log('\nClient account managers:');
  (clientMgrs || []).forEach(c =>
    console.log('  ' + c.name_client + ' -> user ' + c.user_account_manager)
  );

  // Check files table - is it being used as content_assets already?
  const { count: fileCount } = await s.from('files').select('*', { count: 'exact', head: true });
  console.log('\nFiles table: ' + fileCount + ' rows');

  // Check what links to files
  const { data: contentWithFiles } = await s.from('content')
    .select('id_content, name_content, id_file')
    .not('id_file', 'is', null)
    .limit(3);
  console.log('Content with id_file:', JSON.stringify(contentWithFiles));
}

run().catch(console.error);
