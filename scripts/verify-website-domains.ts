/**
 * Turning a website into an email domain, tested on the real cases.
 *
 * Every fixture below is a client from the actual proposal run, because the
 * generic version of this function passes a hand-written test and then takes
 * the last two labels of cybathlon.ethz.ch and produces "ethz.ch" by accident
 * and "co.uk" on purpose.
 */
import { emailDomainFromWebsite } from "./propose-client-domains-from-website";

let failures = 0;
const is = (label: string, got: unknown, want: unknown) =>
  got === want ? console.log(`  ok    ${label} → ${JSON.stringify(got)}`)
    : (failures++, console.log(`  FAIL  ${label} → got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

console.log("\n1. Real clients from the proposal run");
is("undrr.org", emailDomainFromWebsite("undrr.org"), "undrr.org");
is("a full URL", emailDomainFromWebsite("https://www.marsh.com/uk/home.html"), "marsh.com");
is("a project subdomain drops to the institution", emailDomainFromWebsite("cybathlon.ethz.ch"), "ethz.ch");
is("an alumni subdomain likewise", emailDomainFromWebsite("alumni.ethz.ch"), "ethz.ch");
is("a novel TLD survives", emailDomainFromWebsite("zurich.foundation"), "zurich.foundation");
is("a .eu domain", emailDomainFromWebsite("eitfood.eu"), "eitfood.eu");

console.log("\n2. Two-part public suffixes must not collapse to the suffix");
is("a .co.uk keeps its name", emailDomainFromWebsite("https://globalgreengrants.org.uk/about"), "globalgreengrants.org.uk");
is("a .com.sg keeps its name", emailDomainFromWebsite("temasek.com.sg"), "temasek.com.sg");
is("a .co.uk subdomain", emailDomainFromWebsite("news.example.co.uk"), "example.co.uk");

console.log("\n3. Things that must never become a client domain");
is("our own domain", emailDomainFromWebsite("thecontentengine.com"), null);
is("our other domain", emailDomainFromWebsite("https://authorityon.ai"), null);
is("a free mail host", emailDomainFromWebsite("gmail.com"), null);
is("a site builder", emailDomainFromWebsite("https://someone.wixsite.com/page"), null);
is("empty", emailDomainFromWebsite(""), null);
is("null", emailDomainFromWebsite(null), null);
is("not a domain", emailDomainFromWebsite("see their linkedin"), null);
is("a bare word", emailDomainFromWebsite("tbc"), null);

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
