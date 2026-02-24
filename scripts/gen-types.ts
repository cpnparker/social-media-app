/**
 * Generates TypeScript types from Supabase's OpenAPI schema.
 * Uses the REST API endpoint which doesn't require CLI auth.
 *
 * Usage: npx tsx scripts/gen-types.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync } from "fs";
import { join } from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function main() {
  console.log("Fetching OpenAPI schema from Supabase...");

  const res = await fetch(`${SUPABASE_URL}/rest/v1/?apikey=${ANON_KEY}`, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch schema: ${res.status}`);
  }

  const schema = await res.json();
  const definitions = schema.definitions || {};
  const paths = schema.paths || {};

  console.log(`Found ${Object.keys(definitions).length} table definitions`);

  // Generate TypeScript
  let output = `export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {\n`;

  for (const [tableName, def] of Object.entries(definitions) as any[]) {
    const props = def.properties || {};
    const required = new Set(def.required || []);

    // Determine which columns are insertable/updatable
    // The OpenAPI spec has `x-` metadata we can inspect
    const columns = Object.entries(props) as [string, any][];

    output += `      ${tableName}: {\n`;

    // Row type
    output += `        Row: {\n`;
    for (const [col, colDef] of columns) {
      const tsType = openApiTypeToTS(colDef);
      const nullable = !required.has(col) ? " | null" : "";
      output += `          ${col}: ${tsType}${nullable}\n`;
    }
    output += `        }\n`;

    // Insert type (same as Row but with optionals for columns with defaults)
    output += `        Insert: {\n`;
    for (const [col, colDef] of columns) {
      const tsType = openApiTypeToTS(colDef);
      const hasDefault = colDef.default !== undefined || colDef.description?.includes("default");
      const isOptional = !required.has(col) || hasDefault;
      output += `          ${col}${isOptional ? "?" : ""}: ${tsType}${!required.has(col) ? " | null" : ""}\n`;
    }
    output += `        }\n`;

    // Update type (all optional)
    output += `        Update: {\n`;
    for (const [col, colDef] of columns) {
      const tsType = openApiTypeToTS(colDef);
      output += `          ${col}?: ${tsType}${!required.has(col) ? " | null" : ""}\n`;
    }
    output += `        }\n`;

    output += `        Relationships: []\n`;
    output += `      }\n`;
  }

  output += `    }\n`;
  output += `    Views: {\n`;

  // Views show up in paths but not definitions — check for GET-only paths
  // For simplicity, mark all non-table entries that appear in paths as views
  for (const [path, methods] of Object.entries(paths) as any[]) {
    const viewName = path.replace("/", "");
    if (viewName && !definitions[viewName] && methods.get) {
      // It's likely a view
      const params = methods.get.parameters?.filter((p: any) => p.in === "query" && p.name !== "select" && p.name !== "order" && p.name !== "limit" && p.name !== "offset") || [];
      output += `      ${viewName}: {\n`;
      output += `        Row: {\n`;
      for (const param of params) {
        output += `          ${param.name}: any\n`;
      }
      output += `        }\n`;
      output += `        Relationships: []\n`;
      output += `      }\n`;
    }
  }

  output += `    }\n`;
  output += `    Functions: {}\n`;
  output += `    Enums: {}\n`;
  output += `    CompositeTypes: {}\n`;
  output += `  }\n`;
  output += `}\n`;

  // Add helper types
  output += `
type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never
`;

  const outPath = join(__dirname, "..", "lib", "types", "supabase.ts");
  writeFileSync(outPath, output);
  console.log(`\n✅ Types written to lib/types/supabase.ts`);
  console.log(`   ${Object.keys(definitions).length} tables typed`);
}

function openApiTypeToTS(colDef: any): string {
  const { type, format, description } = colDef;

  // Handle arrays
  if (type === "array") {
    const itemType = colDef.items ? openApiTypeToTS(colDef.items) : "any";
    return `${itemType}[]`;
  }

  // Handle format-specific types
  if (format === "uuid") return "string";
  if (format === "timestamp with time zone" || format === "timestamp without time zone" || format === "date") return "string";
  if (format === "json" || format === "jsonb") return "Json";
  if (format === "bigint") return "number";
  if (format === "numeric" || format === "real" || format === "double precision") return "number";

  // Handle base types
  if (type === "integer" || type === "number") return "number";
  if (type === "boolean") return "boolean";
  if (type === "string") return "string";
  if (type === "object") return "Json";

  // Handle smallint (used for flags in Supabase)
  if (format === "smallint") return "number";

  return "any";
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
