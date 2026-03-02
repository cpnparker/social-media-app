import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { requireAuth } from "@/lib/permissions";

// POST /api/google-docs/insert — insert AI-generated content into a Google Doc
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { documentId, content, mode } = await req.json();

    if (!documentId || !content) {
      return NextResponse.json(
        { error: "documentId and content are required" },
        { status: 400 }
      );
    }

    // Parse the service account credentials
    const serviceAccountJson = process.env.GOOGLE_SERVICE;
    if (!serviceAccountJson) {
      return NextResponse.json(
        { error: "Google service account not configured", canInsert: false },
        { status: 503 }
      );
    }

    let credentials: any;
    try {
      credentials = JSON.parse(serviceAccountJson);
    } catch {
      return NextResponse.json(
        { error: "Invalid Google service account credentials", canInsert: false },
        { status: 500 }
      );
    }

    // Authenticate with Google using service account
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/documents"],
    });

    const docs = google.docs({ version: "v1", auth });

    // Convert HTML content to structured text for Google Docs
    const textContent = htmlToPlainText(content);

    if (mode === "replace") {
      // Replace: clear doc body and insert new content
      // First, get the current document to find the end index
      const doc = await docs.documents.get({ documentId });
      const body = doc.data.body;
      const endIndex = body?.content
        ? body.content[body.content.length - 1]?.endIndex || 1
        : 1;

      const requests: any[] = [];

      // Delete existing content (if any beyond the initial newline)
      if (endIndex > 2) {
        requests.push({
          deleteContentRange: {
            range: { startIndex: 1, endIndex: endIndex - 1 },
          },
        });
      }

      // Insert the new content
      requests.push({
        insertText: {
          location: { index: 1 },
          text: textContent,
        },
      });

      await docs.documents.batchUpdate({
        documentId,
        requestBody: { requests },
      });
    } else {
      // Append: add content at the end of the document
      const doc = await docs.documents.get({ documentId });
      const body = doc.data.body;
      const endIndex = body?.content
        ? body.content[body.content.length - 1]?.endIndex || 1
        : 1;

      // Insert at the end (before the final newline)
      const insertIndex = Math.max(1, endIndex - 1);

      const requests: any[] = [
        {
          insertText: {
            location: { index: insertIndex },
            text: (insertIndex > 1 ? "\n\n" : "") + textContent,
          },
        },
      ];

      await docs.documents.batchUpdate({
        documentId,
        requestBody: { requests },
      });
    }

    return NextResponse.json({ success: true, canInsert: true });
  } catch (error: any) {
    console.error("Google Docs insert error:", error.message || error);

    // Check if it's a permissions/auth issue
    if (
      error.code === 403 ||
      error.code === 404 ||
      error.message?.includes("not found") ||
      error.message?.includes("forbidden")
    ) {
      return NextResponse.json(
        {
          error: "Cannot access this Google Doc. The service account may not have edit permissions.",
          canInsert: false,
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: error.message || "Failed to insert into Google Doc", canInsert: false },
      { status: 500 }
    );
  }
}

// GET /api/google-docs/insert?documentId=xxx — check if we can insert into a doc
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  try {
    const documentId = req.nextUrl.searchParams.get("documentId");
    if (!documentId) {
      return NextResponse.json({ canInsert: false });
    }

    const serviceAccountJson = process.env.GOOGLE_SERVICE;
    if (!serviceAccountJson) {
      return NextResponse.json({ canInsert: false });
    }

    let credentials: any;
    try {
      credentials = JSON.parse(serviceAccountJson);
    } catch {
      return NextResponse.json({ canInsert: false });
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/documents"],
    });

    const docs = google.docs({ version: "v1", auth });

    // Try to get the document — if we can read it, we likely have write access
    await docs.documents.get({ documentId });

    return NextResponse.json({ canInsert: true });
  } catch {
    return NextResponse.json({ canInsert: false });
  }
}

/**
 * Convert HTML content to plain text with basic formatting preserved.
 * Handles headings, paragraphs, lists, bold, etc.
 */
function htmlToPlainText(html: string): string {
  let text = html;

  // Replace headings with text + newlines
  text = text.replace(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi, (_, content) => {
    return stripTags(content).toUpperCase() + "\n\n";
  });
  text = text.replace(/<h[4-6][^>]*>(.*?)<\/h[4-6]>/gi, (_, content) => {
    return stripTags(content) + "\n\n";
  });

  // Replace list items
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, (_, content) => {
    return "  \u2022 " + stripTags(content).trim() + "\n";
  });

  // Replace <br> and closing block tags with newlines
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/blockquote>/gi, "\n\n");

  // Remove all remaining HTML tags
  text = stripTags(text);

  // Clean up excessive whitespace
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  return text;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}
