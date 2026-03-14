/**
 * Trusted Procurement Portal Registry
 *
 * Allowlist of known procurement portal domains with metadata for:
 * - URL confidence scoring (trusted domain = higher confidence)
 * - Fallback search links (when a specific RFP URL is broken, link to the portal search)
 * - Portal name display in the UI
 *
 * This list mirrors the portals in buildSearchPrompt() — keep them in sync.
 */

export interface TrustedPortal {
  name: string;
  domains: string[];
  searchUrl: string;
  category: "un" | "government" | "ngo" | "development_bank" | "aggregator" | "eu";
}

export const TRUSTED_PORTALS: TrustedPortal[] = [
  // ── UN & Multilateral ──
  {
    name: "UNGM",
    domains: ["ungm.org"],
    searchUrl: "https://www.ungm.org/Public/Notice",
    category: "un",
  },
  {
    name: "UNDP Procurement",
    domains: ["procurement-notices.undp.org"],
    searchUrl: "https://procurement-notices.undp.org/",
    category: "un",
  },
  {
    name: "UNICEF Supply",
    domains: ["unicef.org"],
    searchUrl: "https://www.unicef.org/supply/service-contracts-tender-calendar",
    category: "un",
  },
  {
    name: "UNOPS",
    domains: ["unops.org"],
    searchUrl: "https://www.unops.org/opportunities",
    category: "un",
  },
  {
    name: "World Bank",
    domains: ["worldbank.org"],
    searchUrl: "https://projects.worldbank.org/en/projects-operations/procurement",
    category: "un",
  },
  {
    name: "WHO",
    domains: ["who.int"],
    searchUrl: "https://www.who.int/about/procurement",
    category: "un",
  },
  {
    name: "UNEP",
    domains: ["unep.org", "wedocs.unep.org"],
    searchUrl: "https://www.unep.org/about-un-environment/procurement",
    category: "un",
  },
  {
    name: "UNESCO",
    domains: ["unesco.org"],
    searchUrl: "https://www.unesco.org/en/procurement",
    category: "un",
  },
  {
    name: "FAO",
    domains: ["fao.org"],
    searchUrl: "https://www.fao.org/procurement/en/",
    category: "un",
  },
  {
    name: "WFP",
    domains: ["wfp.org"],
    searchUrl: "https://www.wfp.org/doing-business",
    category: "un",
  },
  {
    name: "UNFPA",
    domains: ["unfpa.org"],
    searchUrl: "https://www.unfpa.org/suppliers",
    category: "un",
  },
  {
    name: "UNHCR",
    domains: ["unhcr.org"],
    searchUrl: "https://www.unhcr.org/what-we-do/how-we-work/procurement",
    category: "un",
  },
  {
    name: "UN Partner Portal",
    domains: ["unpartnerportal.org"],
    searchUrl: "https://www.unpartnerportal.org/",
    category: "un",
  },

  // ── Development Banks ──
  {
    name: "African Development Bank",
    domains: ["afdb.org"],
    searchUrl: "https://www.afdb.org/en/about-us/corporate-procurement/procurement-notices/current-solicitations",
    category: "development_bank",
  },
  {
    name: "Asian Development Bank",
    domains: ["adb.org"],
    searchUrl: "https://www.adb.org/projects/tenders",
    category: "development_bank",
  },
  {
    name: "Inter-American Development Bank",
    domains: ["iadb.org"],
    searchUrl: "https://www.iadb.org/en/how-we-can-work-together/procurement/procurement-projects/procurement-notices",
    category: "development_bank",
  },
  {
    name: "EBRD",
    domains: ["ebrd.com"],
    searchUrl: "https://www.ebrd.com/work-with-us/procurement.html",
    category: "development_bank",
  },

  // ── EU & European Institutions ──
  {
    name: "TED (EU Tenders)",
    domains: ["ted.europa.eu"],
    searchUrl: "https://ted.europa.eu/en/search/result",
    category: "eu",
  },
  {
    name: "EU eTendering",
    domains: ["etendering.ted.europa.eu"],
    searchUrl: "https://etendering.ted.europa.eu/",
    category: "eu",
  },

  // ── Government Portals ──
  {
    name: "SAM.gov",
    domains: ["sam.gov"],
    searchUrl: "https://sam.gov/search/?index=opp",
    category: "government",
  },
  {
    name: "UK Find a Tender",
    domains: ["find-tender.service.gov.uk"],
    searchUrl: "https://www.find-tender.service.gov.uk/Search",
    category: "government",
  },
  {
    name: "Canada BuyAndSell",
    domains: ["buyandsell.gc.ca"],
    searchUrl: "https://buyandsell.gc.ca/procurement-data/search/site",
    category: "government",
  },
  {
    name: "AusTender",
    domains: ["tenders.gov.au"],
    searchUrl: "https://www.tenders.gov.au/Search/CurrentOpenSearch",
    category: "government",
  },

  // ── NGO & Humanitarian ──
  {
    name: "Save the Children",
    domains: ["savethechildren.net"],
    searchUrl: "https://www.savethechildren.net/tenders",
    category: "ngo",
  },
  {
    name: "IFRC Procurement",
    domains: ["procurement.ifrc.org", "ifrc.org"],
    searchUrl: "https://www.ifrc.org/our-promise/global-humanitarian-services/business-opportunities",
    category: "ngo",
  },
  {
    name: "Danish Refugee Council",
    domains: ["drc.ngo", "pro.drc.ngo"],
    searchUrl: "https://pro.drc.ngo/resources/tenders/",
    category: "ngo",
  },
  {
    name: "Welthungerhilfe",
    domains: ["welthungerhilfe.org"],
    searchUrl: "https://www.welthungerhilfe.org/tenders/",
    category: "ngo",
  },

  // ── Aggregators ──
  {
    name: "Devex",
    domains: ["devex.com"],
    searchUrl: "https://www.devex.com/funding/tenders-grants",
    category: "aggregator",
  },
  {
    name: "DevelopmentAid",
    domains: ["developmentaid.org"],
    searchUrl: "https://www.developmentaid.org/tenders/search",
    category: "aggregator",
  },
  {
    name: "dgMarket",
    domains: ["dgmarket.com"],
    searchUrl: "https://www.dgmarket.com/",
    category: "aggregator",
  },
  {
    name: "GlobalTenders",
    domains: ["globaltenders.com"],
    searchUrl: "https://www.globaltenders.com/",
    category: "aggregator",
  },
  {
    name: "ReliefWeb",
    domains: ["reliefweb.int"],
    searchUrl: "https://reliefweb.int/jobs?list=Consultancy+Jobs&advanced-search=(TY264)",
    category: "aggregator",
  },
  {
    name: "DevBusiness",
    domains: ["devbusiness.com"],
    searchUrl: "https://www.devbusiness.com/",
    category: "aggregator",
  },
  {
    name: "RFPMart",
    domains: ["rfpmart.com"],
    searchUrl: "https://www.rfpmart.com/marketing-and-branding-rfp-government-contract.html",
    category: "aggregator",
  },
  {
    name: "TendersOnTime",
    domains: ["tendersontime.com"],
    searchUrl: "https://www.tendersontime.com/",
    category: "aggregator",
  },
];

/**
 * Look up a portal by URL hostname. Returns the portal or undefined.
 * Handles www. prefix and subdomain matching.
 */
export function findPortalByDomain(hostname: string): TrustedPortal | undefined {
  const clean = hostname.replace(/^www\./, "").toLowerCase();
  return TRUSTED_PORTALS.find((p) =>
    p.domains.some((d) => clean === d || clean.endsWith("." + d))
  );
}

/** Check if a hostname belongs to a trusted procurement portal. */
export function isTrustedDomain(hostname: string): boolean {
  return findPortalByDomain(hostname) !== undefined;
}

/** Try to find a relevant portal for an organisation name. */
export function findPortalForOrganisation(orgName: string): TrustedPortal | undefined {
  const org = orgName.toLowerCase();

  // Direct UN agency matches
  if (org.includes("undp")) return TRUSTED_PORTALS.find((p) => p.name === "UNDP Procurement");
  if (org.includes("unicef")) return TRUSTED_PORTALS.find((p) => p.name === "UNICEF Supply");
  if (org.includes("who") || org.includes("world health")) return TRUSTED_PORTALS.find((p) => p.name === "WHO");
  if (org.includes("unep") || org.includes("un environment")) return TRUSTED_PORTALS.find((p) => p.name === "UNEP");
  if (org.includes("unesco")) return TRUSTED_PORTALS.find((p) => p.name === "UNESCO");
  if (org.includes("fao") || org.includes("food and agriculture")) return TRUSTED_PORTALS.find((p) => p.name === "FAO");
  if (org.includes("wfp") || org.includes("world food")) return TRUSTED_PORTALS.find((p) => p.name === "WFP");
  if (org.includes("unfpa")) return TRUSTED_PORTALS.find((p) => p.name === "UNFPA");
  if (org.includes("unhcr")) return TRUSTED_PORTALS.find((p) => p.name === "UNHCR");
  if (org.includes("unops")) return TRUSTED_PORTALS.find((p) => p.name === "UNOPS");
  if (org.includes("world bank") || org.includes("ibrd")) return TRUSTED_PORTALS.find((p) => p.name === "World Bank");

  // Development banks
  if (org.includes("african development")) return TRUSTED_PORTALS.find((p) => p.name === "African Development Bank");
  if (org.includes("asian development") || org.includes("adb")) return TRUSTED_PORTALS.find((p) => p.name === "Asian Development Bank");
  if (org.includes("inter-american") || org.includes("iadb") || org.includes("idb")) return TRUSTED_PORTALS.find((p) => p.name === "Inter-American Development Bank");
  if (org.includes("ebrd")) return TRUSTED_PORTALS.find((p) => p.name === "EBRD");

  // EU
  if (org.includes("european commission") || org.includes("european union") || org.includes("eu ")) return TRUSTED_PORTALS.find((p) => p.name === "TED (EU Tenders)");

  // NGOs
  if (org.includes("save the children")) return TRUSTED_PORTALS.find((p) => p.name === "Save the Children");
  if (org.includes("red cross") || org.includes("ifrc")) return TRUSTED_PORTALS.find((p) => p.name === "IFRC Procurement");
  if (org.includes("danish refugee") || org.includes("drc")) return TRUSTED_PORTALS.find((p) => p.name === "Danish Refugee Council");

  // Generic UN — point to UNGM
  if (org.includes("united nations") || org.includes("un ")) return TRUSTED_PORTALS.find((p) => p.name === "UNGM");

  return undefined;
}

/** Get the portal's search URL. */
export function getPortalSearchUrl(portal: TrustedPortal): string {
  return portal.searchUrl;
}
