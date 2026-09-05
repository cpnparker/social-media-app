const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Check client sample (potential overlap with customer_accounts)
  const { data: client } = await s.from('clients').select('*').limit(1);
  console.log('--- clients sample (non-null fields) ---');
  if (client && client[0]) {
    Object.entries(client[0]).forEach(([k,v]) => {
      if (v !== null && v !== '') console.log('  ' + k + ': ' + JSON.stringify(v));
    });
  }

  // Check social columns (potential overlap with team_accounts/customer_accounts)
  const { data: social } = await s.from('social').select('*').limit(1);
  console.log('\n--- social columns ---');
  console.log(Object.keys(social[0] || {}).join(', '));

  // Check if social has account-level data
  const { data: socialSample } = await s.from('social').select('id_social, id_client, id_content, network').limit(3);
  console.log('\n--- social samples ---');
  (socialSample || []).forEach(r => console.log(JSON.stringify(r)));

  // Check app_social view columns
  const { data: appSocial } = await s.from('app_social').select('*').limit(1);
  console.log('\n--- app_social columns ---');
  console.log(Object.keys(appSocial[0] || {}).join(', '));

  // Check files table (potential overlap with content_assets)
  const { data: files } = await s.from('files').select('*').limit(2);
  console.log('\n--- files sample ---');
  files.forEach(f => console.log(JSON.stringify(f)));

  // Check if there's any existing account-linking or workspace concept
  const { data: accounts } = await s.from('accounts').select('*', { count: 'exact', head: true });
  console.log('\n--- accounts table ---');
  console.log(accounts ? 'exists' : 'does not exist');

  // Check for content engagement/performance data in existing tables
  const { data: appContent } = await s.from('app_content').select('*').limit(1);
  console.log('\n--- app_content columns ---');
  console.log(Object.keys(appContent[0] || {}).join(', '));

  // Check the users table for role/group fields (potential overlap with teams)
  const { data: user } = await s.from('users').select('*').limit(1);
  console.log('\n--- users columns ---');
  console.log(Object.keys(user[0] || {}).join(', '));
  console.log('\n--- users sample roles ---');
  const { data: roles } = await s.from('users').select('role_user, role_job').limit(5);
  roles.forEach(r => console.log(JSON.stringify(r)));

  // Check distinct role_user values
  const { data: allUsers } = await s.from('users').select('role_user').is('date_deleted', null);
  const roleCounts = {};
  allUsers.forEach(u => { roleCounts[u.role_user] = (roleCounts[u.role_user] || 0) + 1; });
  console.log('\n--- role_user distribution ---');
  Object.entries(roleCounts).sort((a,b) => b[1] - a[1]).forEach(([role, count]) => {
    console.log('  ' + role + ': ' + count);
  });
}

run().catch(console.error);
