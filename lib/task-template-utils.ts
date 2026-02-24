import { supabase } from "@/lib/supabase";

/**
 * Creates production tasks from templates for a given content type.
 * Called when commissioning an idea into a content object.
 */
export async function createTasksFromTemplates(
  contentObjectId: string,
  contentType: string,
  workspaceId: string,
  createdBy: string
): Promise<void> {
  // Resolve contentType to id_type
  const { data: typeRow } = await supabase
    .from("types_content")
    .select("id_type")
    .or(`key_type.eq.${contentType},type_content.ilike.${contentType}`)
    .limit(1)
    .single();

  if (!typeRow) return;

  // Fetch templates for this content type
  const { data: templates } = await supabase
    .from("templates_tasks_content")
    .select("*")
    .eq("id_type", typeRow.id_type)
    .order("order_sort", { ascending: true });

  if (!templates || templates.length === 0) return;

  // Insert a production task for each template
  const taskRows = templates.map((template) => ({
    id_content: parseInt(contentObjectId, 10),
    type_task: template.type_task,
    information_notes: template.information_notes,
    order_sort: template.order_sort,
    units_content: template.units_content,
    user_created: parseInt(createdBy, 10),
    date_created: new Date().toISOString(),
  }));

  await supabase.from("tasks_content").insert(taskRows);
}
