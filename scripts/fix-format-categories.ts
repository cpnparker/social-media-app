/**
 * One-off script: Move Newsletter, Original reporting / interview, and
 * Article with interview from "Other" into the "Written" content type,
 * and rename "Original reporting / interview" to
 * "Original reporting / interview add-on".
 *
 * Usage: npx tsx scripts/fix-format-categories.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // 1. List all content types to find the Written type
  const { data: types, error: typesErr } = await supabase
    .from("types_content")
    .select("id_type, key_type, type_content, flag_active");

  if (typesErr) {
    console.error("Failed to fetch content types:", typesErr);
    return;
  }

  console.log("Content types found:");
  types?.forEach((t) =>
    console.log(`  id_type=${t.id_type}  key=${t.key_type}  name=${t.type_content}  active=${t.flag_active}`)
  );

  // Find Written type (could be keyed as "article", "written", or named "Written")
  const writtenType = types?.find(
    (t) =>
      t.key_type === "article" ||
      t.key_type === "written" ||
      t.type_content?.toLowerCase() === "written"
  );

  if (!writtenType) {
    console.error("Could not find Written content type!");
    console.log("Available types:", types?.map((t) => `${t.key_type} (${t.type_content})`).join(", "));
    return;
  }

  console.log(`\nWritten type: id_type=${writtenType.id_type}, key=${writtenType.key_type}, name=${writtenType.type_content}`);

  // 2. Find the 3 formats to move
  const { data: allFormats } = await supabase
    .from("calculator_content")
    .select("id, name, format, id_type, sort_order")
    .order("sort_order");

  const targetNames = ["Newsletter", "Original reporting / interview", "Article with interview"];
  const formatsToMove = allFormats?.filter((f) =>
    targetNames.some((target) => f.name?.toLowerCase().includes(target.toLowerCase()))
  );

  console.log(`\nFormats to move to Written (${formatsToMove?.length || 0}):`);
  formatsToMove?.forEach((f) =>
    console.log(`  id=${f.id}  name="${f.name}"  format=${f.format}  id_type=${f.id_type}`)
  );

  if (!formatsToMove || formatsToMove.length === 0) {
    console.error("No matching formats found. Available formats:");
    allFormats?.forEach((f) => console.log(`  id=${f.id}  name="${f.name}"  id_type=${f.id_type}`));
    return;
  }

  // 3. Update id_type to Written type for all 3
  for (const fmt of formatsToMove) {
    if (fmt.id_type === writtenType.id_type) {
      console.log(`  "${fmt.name}" already has Written type, skipping id_type update`);
    } else {
      const { error } = await supabase
        .from("calculator_content")
        .update({ id_type: writtenType.id_type })
        .eq("id", fmt.id);

      if (error) {
        console.error(`  Failed to update "${fmt.name}":`, error);
      } else {
        console.log(`  Updated "${fmt.name}" → id_type=${writtenType.id_type} (Written)`);
      }
    }
  }

  // 4. Rename "Original reporting / interview" → "Original reporting / interview add-on"
  const reportingFormat = formatsToMove.find((f) =>
    f.name?.toLowerCase().includes("original reporting") &&
    !f.name?.toLowerCase().includes("add-on")
  );

  if (reportingFormat) {
    const newName = "Original reporting / interview add-on";
    const { error } = await supabase
      .from("calculator_content")
      .update({ name: newName })
      .eq("id", reportingFormat.id);

    if (error) {
      console.error(`  Failed to rename:`, error);
    } else {
      console.log(`  Renamed "${reportingFormat.name}" → "${newName}"`);
    }
  } else {
    console.log("  No 'Original reporting / interview' found to rename (may already be renamed)");
  }

  console.log("\nDone!");
}

main().catch(console.error);
