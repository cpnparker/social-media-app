const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // 1. POSTING_DISTRIBUTIONS — the real social accounts table
  console.log('=== POSTING_DISTRIBUTIONS ===');
  const { data: dist, count: distCount } = await s.from('posting_distributions')
    .select('*', { count: 'exact' }).limit(3);
  console.log('Total rows:', distCount);
  console.log('Columns:', Object.keys((dist || [])[0] || {}).join(', '));
  (dist || []).forEach(d => {
    console.log(JSON.stringify({
      id_distribution: d.id_distribution,
      network: d.network,
      name_resource: d.name_resource,
      type_distribution: d.type_distribution,
      flag_active: d.flag_active,
      flag_enabled: d.flag_enabled
    }));
  });

  // 2. How does social link to clients through distribution?
  console.log('\n=== SOCIAL → CLIENT → DISTRIBUTION ===');
  // Get distinct distribution IDs per client
  const { data: clientDists } = await s.from('social')
    .select('id_client, id_distribution, network')
    .not('id_distribution', 'is', null)
    .not('id_client', 'is', null)
    .limit(100);
  const clientDistMap = {};
  (clientDists || []).forEach(r => {
    const key = r.id_client + '-' + r.id_distribution;
    if (!clientDistMap[key]) {
      clientDistMap[key] = { id_client: r.id_client, id_distribution: r.id_distribution, network: r.network };
    }
  });
  const uniqueLinks = Object.values(clientDistMap).slice(0, 10);
  console.log('Unique client→distribution links (sample):', JSON.stringify(uniqueLinks, null, 2));

  // 3. ASSETS_CONTENT — the existing content assets table
  console.log('\n=== ASSETS_CONTENT ===');
  const { data: assetContent, count: acCount } = await s.from('assets_content')
    .select('*', { count: 'exact' }).limit(3);
  console.log('Total rows:', acCount);
  console.log('Columns:', Object.keys((assetContent || [])[0] || {}).join(', '));
  (assetContent || []).forEach(a => console.log(JSON.stringify(a)));

  // 4. ASSETS_CLIENTS
  console.log('\n=== ASSETS_CLIENTS ===');
  const { data: assetClients, count: aclCount } = await s.from('assets_clients')
    .select('*', { count: 'exact' }).limit(3);
  console.log('Total rows:', aclCount);
  console.log('Columns:', Object.keys((assetClients || [])[0] || {}).join(', '));

  // 5. ASSETS_IDEAS
  console.log('\n=== ASSETS_IDEAS ===');
  const { data: assetIdeas, count: aiCount } = await s.from('assets_ideas')
    .select('*', { count: 'exact' }).limit(3);
  console.log('Total rows:', aiCount);
  console.log('Columns:', Object.keys((assetIdeas || [])[0] || {}).join(', '));

  // 6. APP_ASSETS_CONTENT view — enriched with file info
  console.log('\n=== APP_ASSETS_CONTENT (view) ===');
  const { data: appAssets } = await s.from('app_assets_content').select('*').limit(2);
  console.log('Columns:', Object.keys((appAssets || [])[0] || {}).join(', '));
  (appAssets || []).forEach(a => console.log(JSON.stringify(a)));

  // 7. LOOKUP_USERS_CLIENTS — user-client relationships
  console.log('\n=== LOOKUP_USERS_CLIENTS ===');
  const { data: userClients, count: ucCount } = await s.from('lookup_users_clients')
    .select('*', { count: 'exact' }).limit(5);
  console.log('Total rows:', ucCount);
  console.log('Columns:', Object.keys((userClients || [])[0] || {}).join(', '));
  (userClients || []).forEach(r => console.log(JSON.stringify(r)));
}

run().catch(console.error);
