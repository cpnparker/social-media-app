const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // ================================================================
  // 1. DISTRIBUTION table — potential replacement for team_accounts / customer_accounts
  // ================================================================
  console.log('=== DISTRIBUTION TABLE ===');
  const { data: distSample, error: distErr } = await s.from('distribution').select('*').limit(3);
  if (distErr) {
    console.log('Error:', distErr.message);
  } else {
    console.log('Columns:', Object.keys((distSample || [])[0] || {}).join(', '));
    console.log('Sample rows:', JSON.stringify(distSample, null, 2));
  }
  const { count: distCount } = await s.from('distribution').select('*', { count: 'exact', head: true });
  console.log('Total rows:', distCount);

  // ================================================================
  // 2. SOCIAL_ANALYTICS / POST_ANALYTICS / METRICS — potential for content_performance
  // ================================================================
  const analyticsTables = ['social_analytics', 'post_analytics', 'analytics_data', 'metrics', 'social_metrics', 'distribution_data'];
  for (const t of analyticsTables) {
    console.log('\n=== ' + t.toUpperCase() + ' ===');
    const { data, error } = await s.from(t).select('*').limit(2);
    if (error) {
      console.log('Error:', error.message);
    } else {
      console.log('Columns:', Object.keys((data || [])[0] || {}).join(', '));
      console.log('Sample:', JSON.stringify(data, null, 2));
    }
    const { count } = await s.from(t).select('*', { count: 'exact', head: true });
    console.log('Total rows:', count);
  }

  // ================================================================
  // 3. FILES table deep dive — potential for content_assets
  // ================================================================
  console.log('\n=== FILES TABLE (deeper) ===');
  const { data: filesSample } = await s.from('files').select('*').limit(3);
  console.log('Columns:', Object.keys((filesSample || [])[0] || {}).join(', '));
  console.log('Sample:', JSON.stringify(filesSample, null, 2));

  // How many content items link to files?
  const { data: contentWithFiles } = await s.from('content')
    .select('id_content, id_file')
    .not('id_file', 'is', null)
    .limit(1);
  const { count: contentFileCount } = await s.from('content')
    .select('*', { count: 'exact', head: true })
    .not('id_file', 'is', null);
  console.log('Content items with id_file:', contentFileCount);

  // ================================================================
  // 4. Check social → distribution linkage pattern
  // ================================================================
  console.log('\n=== SOCIAL → DISTRIBUTION LINKAGE ===');
  const { count: socialWithDist } = await s.from('social')
    .select('*', { count: 'exact', head: true })
    .not('id_distribution', 'is', null);
  const { count: socialTotal } = await s.from('social')
    .select('*', { count: 'exact', head: true });
  console.log('Social posts with distribution:', socialWithDist, '/', socialTotal);

  // Check what a distribution record looks like in context
  const { data: socialJoined } = await s.from('social')
    .select('id_social, id_client, id_distribution, network, name_social')
    .not('id_distribution', 'is', null)
    .limit(5);
  console.log('Social with distribution sample:', JSON.stringify(socialJoined, null, 2));

  // ================================================================
  // 5. Check client → user relationships beyond user_account_manager
  // ================================================================
  console.log('\n=== CLIENT-USER RELATIONSHIPS ===');
  // Check if there are junction tables for client members
  const { data: clientUserData, error: cuErr } = await s.from('client_user').select('*').limit(3);
  if (cuErr) {
    console.log('client_user error:', cuErr.message);
  } else {
    console.log('client_user columns:', Object.keys((clientUserData || [])[0] || {}).join(', '));
    console.log('Sample:', JSON.stringify(clientUserData, null, 2));
    const { count: cuCount } = await s.from('client_user').select('*', { count: 'exact', head: true });
    console.log('Total rows:', cuCount);
  }
}

run().catch(console.error);
