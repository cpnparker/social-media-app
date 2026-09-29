/**
 * Shared team / user hierarchy used by team-production and timeline-resourcing.
 *
 * Leaf nodes are user IDs (as strings). Branch nodes group people for the
 * UI tree picker. Pages may augment this list with an "Other Team Members"
 * branch by fetching /api/operations/team-members.
 */

export interface TeamNode {
  label: string;
  value: string;
  children?: TeamNode[];
}

export const TEAMS: TeamNode[] = [
  {
    label: "All Staff",
    value: "all",
    children: [
      {
        label: "Account Managers",
        value: "accountmanagers",
        children: [
          { label: "Arne Dumez", value: "12" },
          { label: "Catherine Allen", value: "14" },
          { label: "Ceri Radford", value: "17" },
          { label: "Charlie Filmer-Court", value: "172" },
          { label: "Ed Brereton", value: "42" },
          { label: "Jack Heslehurst", value: "62" },
          { label: "Katie Roberts", value: "75" },
          { label: "John Hills", value: "667" },
          { label: "Amy White", value: "666" },
        ],
      },
      {
        label: "Hybrid",
        value: "hybrid",
        children: [{ label: "Charlie Avery", value: "191" }],
      },
      {
        label: "Content Managers",
        value: "content_managers",
        children: [
          { label: "Holly Goodall", value: "252" },
          { label: "Marzia Daudzai", value: "61" },
          { label: "Manali Bhutwala", value: "691" },
        ],
      },
      {
        label: "Video Team",
        value: "video",
        children: [
          { label: "Carlota Caldeira da Silva", value: "92" },
          { label: "Nathan Lomax-Cooke", value: "124" },
        ],
      },
      {
        label: "Video Freelancers",
        value: "videofreelancers",
        children: [
          { label: "Espranza", value: "383" },
          { label: "Hustle Media", value: "539" },
          { label: "The Junxion (Agency User)", value: "648" },
          { label: "The Junxion (Freelancer User)", value: "653" },
          { label: "Kennedy Oduor", value: "79" },
          { label: "Pearse Owens", value: "591" },
          { label: "Nostro People", value: "697" },
        ],
      },
      {
        label: "Visuals Team",
        value: "visuals",
        children: [
          { label: "Jessica Foley", value: "43" },
          { label: "Katie Romvari", value: "164" },
          { label: "Nell Prieto", value: "749" },
          { label: "Nell Prieto (archived)", value: "328" },
        ],
      },
      {
        label: "Visual Freelancers",
        value: "visualfreelancers",
        children: [
          { label: "Jenny Amer", value: "46" },
          { label: "Emily Waterfiled", value: "686" },
          { label: "Nick Venables", value: "227" },
          { label: "Harry Tate", value: "326" },
          { label: "Emma Lansdown", value: "609" },
          { label: "Fatma Al Mansoury", value: "650" },
        ],
      },
      {
        label: "Voiceover Artists",
        value: "voiceover",
        children: [
          { label: "Alison Tilley", value: "166" },
          { label: "David Gilbert", value: "435" },
          { label: "Harriet Leitch", value: "535" },
          { label: "Ally Ibach", value: "574" },
          { label: "Sakshi Sharma", value: "418" },
          { label: "Wanda Rush", value: "454" },
        ],
      },
      {
        label: "Writers Team",
        value: "writers",
        children: [{ label: "Farahnaz Mohammed", value: "387" }],
      },
      {
        label: "Writers Freelance",
        value: "writersfreelance",
        children: [
          { label: "Andrew Wright", value: "52" },
          { label: "Si Brandon", value: "26" },
          { label: "Hilary Lamb", value: "77" },
          { label: "Andrew Pettie", value: "68" },
          { label: "Kate Thomas", value: "468" },
          { label: "Nick Walshe", value: "350" },
          { label: "Stephanie Thomson", value: "467" },
          { label: "Angela Wipperman", value: "44" },
        ],
      },
      {
        label: "Strategy Team",
        value: "strategy_team",
        children: [
          { label: "Prachi Srivastava", value: "150" },
          { label: "Edward Brydon", value: "253" },
          { label: "Gabriella Beer", value: "13" },
        ],
      },
      {
        label: "Strategy Freelancers",
        value: "strategy_freelance",
        children: [{ label: "Sophia D'Cruz", value: "611" }],
      },
      {
        label: "Analytics",
        value: "analytics",
        children: [{ label: "Edward Rycroft", value: "455" }],
      },
    ],
  },
];

/** Get all leaf (user) IDs from a node */
/**
 * One person, several Engine accounts.
 *
 * When someone changes status (staff -> freelancer) they get a new Engine login
 * and the old account is NOT retired. If both keep the same display name, the
 * Engine's assignee picker shows two identical entries, assigners use either,
 * and the person's work splits across accounts that look the same here.
 *
 * Two ways to handle it, in order of preference:
 *
 *  1. Rename the old account in the Engine (e.g. "Nell Prieto (archived)") and
 *     list BOTH ids in TEAMS under their own names. Each shows as its own row,
 *     both are selected with their team, and nothing needs merging. This is how
 *     Nell Prieto is handled: 749 is her freelancer login (since 29 Jul 2026),
 *     328 her archived staff account.
 *
 *  2. If the old account can't be renamed, alias it here (alias -> canonical) so
 *     its work is fetched and reported under one row. Do NOT merge on matching
 *     names: twelve names in app_users are held by two or more accounts, and most
 *     are different people. The helpers are symmetric, so an alias keeps working
 *     whichever of the person's ids TEAMS holds.
 */
export const ACCOUNT_ALIASES: Record<string, string> = {};

/** The id a person is reported under, whichever of their accounts did the work. */
export function canonicalUserId(id: string): string {
  return ACCOUNT_ALIASES[id] || id;
}

/** Every account id belonging to the people behind `ids`. */
export function expandAliases(ids: string[]): string[] {
  const out: Record<string, true> = {};
  const aliasKeys = Object.keys(ACCOUNT_ALIASES);
  for (let i = 0; i < ids.length; i++) {
    const canon = canonicalUserId(ids[i]);
    out[ids[i]] = true;
    out[canon] = true;
    for (let j = 0; j < aliasKeys.length; j++) {
      if (ACCOUNT_ALIASES[aliasKeys[j]] === canon) out[aliasKeys[j]] = true;
    }
  }
  return Object.keys(out);
}

export function getLeafIds(node: TeamNode): string[] {
  if (!node.children || node.children.length === 0) return [node.value];
  return node.children.flatMap(getLeafIds);
}

/** Check if a node is a leaf (user) — branches always have a children array */
export function isLeaf(node: TeamNode): boolean {
  return !node.children || node.children.length === 0;
}
