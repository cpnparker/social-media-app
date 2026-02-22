import { db } from "@/lib/db";
import { taskTemplates, productionTasks } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";

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
  // Fetch templates for this content type and workspace
  const templates = await db
    .select()
    .from(taskTemplates)
    .where(
      and(
        eq(taskTemplates.contentType, contentType as any),
        eq(taskTemplates.workspaceId, workspaceId)
      )
    )
    .orderBy(asc(taskTemplates.sortOrder));

  if (templates.length === 0) return;

  // Insert a production task for each template
  await db.insert(productionTasks).values(
    templates.map((template) => ({
      contentObjectId,
      workspaceId,
      title: template.title,
      description: template.description,
      status: "todo" as const,
      priority: "medium" as const,
      sortOrder: template.sortOrder,
      templateId: template.id,
      createdBy,
    }))
  );
}
