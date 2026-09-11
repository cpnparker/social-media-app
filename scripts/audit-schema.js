const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Use RPC to query information_schema for all tables across all schemas
  const { data, error } = await s.rpc('', {}).select('*');

  // Alternative: use raw SQL-like approach via the REST API
  // Let's check what tables are actually in the public schema
  // by hitting the OpenAPI endpoint
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/';
  const res = await fetch(url, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  });
  const openapi = await res.json();

  // Get all paths (tables/views)
  const paths = Object.keys(openapi.paths || {}).map(p => p.replace('/', ''));
  console.log('=== ALL ACCESSIBLE TABLES/VIEWS (' + paths.length + ') ===');
  paths.sort().forEach(p => console.log('  ' + p));

  // Now check specifically for distribution-like tables
  console.log('\n=== DISTRIBUTION/ANALYTICS RELATED ===');
  const relevant = paths.filter(p =>
    p.includes('dist') || p.includes('analytic') || p.includes('metric') ||
    p.includes('perform') || p.includes('engage') || p.includes('campaign') ||
    p.includes('team') || p.includes('asset') || p.includes('file') ||
    p.includes('account') || p.includes('member')
  );
  relevant.forEach(p => console.log('  ' + p));

  // For each relevant table, get the columns
  for (const table of relevant) {
    const def = openapi.definitions ? openapi.definitions[table] : null;
    if (def && def.properties) {
      console.log('\n--- ' + table + ' columns ---');
      console.log(Object.keys(def.properties).join(', '));
    }
  }
}

run().catch(console.error);
