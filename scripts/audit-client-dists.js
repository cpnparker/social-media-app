const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Get distinct client→distribution pairs from social table
  const { data } = await s.from('social')
    .select('id_client, id_distribution')
    .not('id_distribution', 'is', null)
    .not('id_client', 'is', null);

  const pairs = {};
  (data || []).forEach(r => {
    const key = r.id_client + '-' + r.id_distribution;
    if (pairs[key] === undefined) {
      pairs[key] = { id_client: r.id_client, id_distribution: r.id_distribution, count: 0 };
    }
    pairs[key].count++;
  });

  const sorted = Object.values(pairs).sort((a, b) => b.count - a.count);
  console.log('Total unique client→distribution pairs:', sorted.length);

  // Get client 1 (TCE) accounts
  const client1 = sorted.filter(p => p.id_client === 1);
  console.log('\nClient 1 (TCE) has', client1.length, 'distribution channels');
  for (const cd of client1) {
    const { data: dist } = await s.from('posting_distributions')
      .select('id_distribution, network, name_resource, type_distribution, flag_active')
      .eq('id_distribution', cd.id_distribution);
    if (dist && dist[0]) {
      console.log('  ' + dist[0].network + ' | ' + dist[0].name_resource + ' | ' + dist[0].type_distribution + ' | active=' + dist[0].flag_active);
    }
  }

  // Check if there's a direct client→distribution table
  const { data: lookupTest, error: lookupErr } = await s.from('lookup_clients_distributions').select('*').limit(1);
  if (lookupErr) {
    console.log('\nlookup_clients_distributions: does not exist');
  } else {
    console.log('\nlookup_clients_distributions EXISTS:', Object.keys((lookupTest || [])[0] || {}).join(', '));
  }

  // Check all tables matching *client* or *distribution*
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/';
  const res = await fetch(url, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  });
  const openapi = await res.json();
  const paths = Object.keys(openapi.paths || {}).map(p => p.replace('/', ''));
  const relevant = paths.filter(p => p.includes('client') || p.includes('distribut'));
  console.log('\nAll tables/views matching client or distribution:', relevant);
}

run().catch(console.error);
