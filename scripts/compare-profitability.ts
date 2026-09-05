import { config } from 'dotenv';
config({ path: '.env.local' });
import { getClockifyClients, getClockifyProjects, getAllTimeEntries, buildClientProfitability, fuzzyMatchClient } from '../lib/clockify';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const fromISO = '2026-01-01T00:00:00Z';
  const toISO = '2026-01-31T23:59:59Z';

  console.log('Fetching Clockify data for January 2026...');
  const [clients, projects, entries] = await Promise.all([
    getClockifyClients(),
    getClockifyProjects(),
    getAllTimeEntries(fromISO, toISO),
  ]);

  console.log(`  ${entries.length} time entries, ${clients.length} clients, ${projects.length} projects`);

  const { byClient, unmatchedProjects } = buildClientProfitability(entries, projects, clients);

  const clientNameMap = new Map<string, string>();
  for (const c of clients) clientNameMap.set(c.id, c.name);

  // Fetch Supabase data
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const [clientsRes, contractsRes, contentTasksRes, socialTasksRes] = await Promise.all([
    supabase.from('app_clients').select('*').order('name_client', { ascending: true }),
    supabase.from('app_contracts').select('*'),
    supabase.from('app_tasks_content')
      .select('id_client, id_contract, units_content, date_completed, flag_spiked')
      .gte('date_completed', fromISO)
      .lte('date_completed', toISO),
    supabase.from('app_tasks_social')
      .select('id_client, id_contract, units_content, date_completed, flag_spiked')
      .gte('date_completed', fromISO)
      .lte('date_completed', toISO),
  ]);

  const supabaseClients = clientsRes.data || [];
  const contentTasks = contentTasksRes.data || [];
  const socialTasks = socialTasksRes.data || [];

  // Sum CUs per client for January
  const periodCUsByClient = new Map<string, number>();
  for (const t of [...contentTasks, ...socialTasks]) {
    if (t.flag_spiked === 1) continue;
    const clientId = t.id_client ? String(t.id_client) : null;
    if (!clientId) continue;
    const cus = Number(t.units_content) || 0;
    periodCUsByClient.set(clientId, (periodCUsByClient.get(clientId) || 0) + cus);
  }

  const supabaseClientList = supabaseClients.map((sc: any) => ({
    id: String(sc.id_client),
    name: (sc.name_client || '').trim(),
  }));

  // Build rows
  interface Row {
    name: string;
    acctMgmt: number;
    contentProd: number;
    strategy: number;
    other: number;
    total: number;
    cusInPeriod: number;
    hoursPerCU: number | null;
    matchedTo: string | null;
  }

  const rows: Row[] = [];
  let totalAcctMgmt = 0, totalContentProd = 0, totalStrategy = 0, totalOther = 0, totalHours = 0, totalCUs = 0;

  for (const [clientId, data] of Object.entries(byClient)) {
    const name = clientNameMap.get(clientId) || 'Unknown';
    const acctMgmt = data.activityBreakdown['Account Management'] || 0;
    const contentProd = data.activityBreakdown['Content Production'] || 0;
    const strategy = data.activityBreakdown['Strategy'] || 0;
    const other = data.activityBreakdown['Other'] || 0;
    const total = data.totalHours;

    // Fuzzy match
    const match = fuzzyMatchClient(name, supabaseClientList);
    const cusInPeriod = match ? (periodCUsByClient.get(match.id) || 0) : 0;
    const hoursPerCU = cusInPeriod > 0 ? total / cusInPeriod : null;

    totalAcctMgmt += acctMgmt;
    totalContentProd += contentProd;
    totalStrategy += strategy;
    totalOther += other;
    totalHours += total;
    totalCUs += cusInPeriod;

    rows.push({ name, acctMgmt, contentProd, strategy, other, total, cusInPeriod, hoursPerCU, matchedTo: match?.name || null });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));

  // Print comparison table
  console.log('\n' + '='.repeat(130));
  console.log('CLOCKIFY DATA vs SPREADSHEET — January 2026');
  console.log('='.repeat(130));
  console.log(
    'CLIENT'.padEnd(30) + '| ' +
    'ACCT MGT'.padStart(8) + ' | ' +
    'CONT PRD'.padStart(8) + ' | ' +
    'STRATEGY'.padStart(8) + ' | ' +
    'OTHER'.padStart(6) + ' | ' +
    'TOTAL'.padStart(7) + ' | ' +
    'CUs'.padStart(6) + ' | ' +
    'Hrs/CU'.padStart(7) + ' | ' +
    'Matched To'
  );
  console.log('-'.repeat(130));
  for (const r of rows) {
    console.log(
      r.name.padEnd(30) + '| ' +
      r.acctMgmt.toFixed(1).padStart(8) + ' | ' +
      r.contentProd.toFixed(1).padStart(8) + ' | ' +
      r.strategy.toFixed(1).padStart(8) + ' | ' +
      r.other.toFixed(1).padStart(6) + ' | ' +
      r.total.toFixed(1).padStart(7) + ' | ' +
      r.cusInPeriod.toFixed(1).padStart(6) + ' | ' +
      (r.hoursPerCU !== null ? r.hoursPerCU.toFixed(1) + 'h' : 'N/A').padStart(7) + ' | ' +
      (r.matchedTo || '❌ no match')
    );
  }
  console.log('-'.repeat(130));
  console.log(
    'TOTALS'.padEnd(30) + '| ' +
    totalAcctMgmt.toFixed(1).padStart(8) + ' | ' +
    totalContentProd.toFixed(1).padStart(8) + ' | ' +
    totalStrategy.toFixed(1).padStart(8) + ' | ' +
    totalOther.toFixed(1).padStart(6) + ' | ' +
    totalHours.toFixed(1).padStart(7) + ' | ' +
    totalCUs.toFixed(1).padStart(6) + ' | ' +
    (totalCUs > 0 ? (totalHours / totalCUs).toFixed(1) + 'h' : 'N/A').padStart(7) + ' |'
  );

  console.log('\n\nSPREADSHEET TOTALS (for comparison):');
  console.log('  Account Management: 588.6h');
  console.log('  Content Production: 703.8h');
  console.log('  Strategy:           177.6h');
  console.log('  Total Hours:      1,470.0h');

  // Show differences
  console.log('\n\nDIFFERENCES:');
  console.log(`  Account Management: Clockify=${totalAcctMgmt.toFixed(1)} vs Spreadsheet=588.6 → Δ ${(totalAcctMgmt - 588.6).toFixed(1)}`);
  console.log(`  Content Production: Clockify=${totalContentProd.toFixed(1)} vs Spreadsheet=703.8 → Δ ${(totalContentProd - 703.8).toFixed(1)}`);
  console.log(`  Strategy:           Clockify=${totalStrategy.toFixed(1)} vs Spreadsheet=177.6 → Δ ${(totalStrategy - 177.6).toFixed(1)}`);
  console.log(`  Total Hours:        Clockify=${totalHours.toFixed(1)} vs Spreadsheet=1470.0 → Δ ${(totalHours - 1470.0).toFixed(1)}`);
  if (totalOther > 0) {
    console.log(`  Other (not in spreadsheet): ${totalOther.toFixed(1)}h`);
  }

  // Per-client comparison with spreadsheet values
  const spreadsheet: Record<string, { acctMgmt: number; contentProd: number; strategy: number; total: number }> = {
    'ABB': { acctMgmt: 2.4, contentProd: 18.0, strategy: 0.0, total: 20.5 },
    'Accountability Accelerator': { acctMgmt: 30.0, contentProd: 12.7, strategy: 0.0, total: 42.7 },
    'Bahrain': { acctMgmt: 32.1, contentProd: 59.7, strategy: 19.0, total: 110.7 },
    'BeOne': { acctMgmt: 10.8, contentProd: 0.0, strategy: 1.0, total: 11.8 },
    'CFEG': { acctMgmt: 48.3, contentProd: 58.8, strategy: 0.0, total: 107.1 },
    'CFG': { acctMgmt: 16.3, contentProd: 34.7, strategy: 13.2, total: 64.2 },
    'ESMO': { acctMgmt: 14.1, contentProd: 2.0, strategy: 0.2, total: 16.3 },
    'GESDA': { acctMgmt: 1.4, contentProd: 1.4, strategy: 0.0, total: 2.9 },
    'Global Renewals Alliance': { acctMgmt: 36.0, contentProd: 0.8, strategy: 0.0, total: 36.8 },
    'IEEE': { acctMgmt: 6.4, contentProd: 0.5, strategy: 20.9, total: 27.8 },
    'International Energy Forum': { acctMgmt: 59.4, contentProd: 16.6, strategy: 63.1, total: 139.2 },
    'Inter-Parliamentary Union': { acctMgmt: 10.8, contentProd: 2.3, strategy: 0.0, total: 13.0 },
    'Marsh': { acctMgmt: 43.6, contentProd: 63.4, strategy: 0.0, total: 107.0 },
    'OMV': { acctMgmt: 22.3, contentProd: 66.1, strategy: 0.0, total: 88.4 },
    'Temasek': { acctMgmt: 16.1, contentProd: 55.5, strategy: 12.4, total: 84.0 },
    'UBS Instagram': { acctMgmt: 42.0, contentProd: 40.1, strategy: 2.1, total: 84.2 },
    'UBS Sustainability': { acctMgmt: 23.2, contentProd: 50.6, strategy: 0.0, total: 73.7 },
    'Varo': { acctMgmt: 16.0, contentProd: 7.5, strategy: 2.0, total: 25.5 },
    'WBCSD': { acctMgmt: 43.8, contentProd: 74.1, strategy: 36.6, total: 154.5 },
    'WBCSD Social': { acctMgmt: 23.8, contentProd: 11.3, strategy: 0.0, total: 35.1 },
    'World Bank CGAP': { acctMgmt: 45.5, contentProd: 81.0, strategy: 7.2, total: 133.7 },
    'Z Zurich Foundation': { acctMgmt: 19.5, contentProd: 6.0, strategy: 0.0, total: 25.5 },
    'Zurich Insurance': { acctMgmt: 12.4, contentProd: 6.1, strategy: 0.0, total: 18.5 },
    'Zurich Resilience': { acctMgmt: 12.6, contentProd: 34.7, strategy: 0.0, total: 47.3 },
  };

  console.log('\n\nPER-CLIENT HOUR DIFFERENCES (Clockify vs Spreadsheet):');
  console.log('CLIENT'.padEnd(30) + '| ' + 'Δ TOTAL'.padStart(8) + ' | ' + 'Δ ACCT'.padStart(7) + ' | ' + 'Δ CONT'.padStart(7) + ' | ' + 'Δ STRAT'.padStart(7) + ' | NOTE');
  console.log('-'.repeat(100));

  const matched = new Set<string>();
  for (const r of rows) {
    const ss = spreadsheet[r.name];
    if (ss) {
      matched.add(r.name);
      const dTotal = r.total - ss.total;
      const dAcct = r.acctMgmt - ss.acctMgmt;
      const dCont = r.contentProd - ss.contentProd;
      const dStrat = r.strategy - ss.strategy;
      const flag = Math.abs(dTotal) > 1 ? ' ⚠️' : ' ✅';
      console.log(
        r.name.padEnd(30) + '| ' +
        (dTotal >= 0 ? '+' : '') + dTotal.toFixed(1).padStart(7) + ' | ' +
        (dAcct >= 0 ? '+' : '') + dAcct.toFixed(1).padStart(6) + ' | ' +
        (dCont >= 0 ? '+' : '') + dCont.toFixed(1).padStart(6) + ' | ' +
        (dStrat >= 0 ? '+' : '') + dStrat.toFixed(1).padStart(6) + ' |' + flag
      );
    }
  }

  // Show Clockify clients not in spreadsheet
  console.log('\n\nIN CLOCKIFY BUT NOT IN SPREADSHEET:');
  for (const r of rows) {
    if (!spreadsheet[r.name]) {
      console.log(`  ${r.name}: ${r.total.toFixed(1)}h (AcctMgmt=${r.acctMgmt.toFixed(1)}, ContProd=${r.contentProd.toFixed(1)}, Strat=${r.strategy.toFixed(1)}, Other=${r.other.toFixed(1)})`);
    }
  }

  // Show spreadsheet clients not in Clockify
  console.log('\nIN SPREADSHEET BUT NOT IN CLOCKIFY:');
  for (const name of Object.keys(spreadsheet)) {
    if (!rows.find(r => r.name === name)) {
      console.log(`  ${name}: ${spreadsheet[name].total}h`);
    }
  }
}

main().catch(console.error);
