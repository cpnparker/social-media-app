import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
} from "docx";

// GET /api/rfp/responses/[id]/export
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const { id } = await params;

  try {
    const { data: response } = await intelligenceDb
      .from("rfp_responses")
      .select("*")
      .eq("id_response", id)
      .single();

    if (!response) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, response.id_workspace);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const sections = response.document_sections || [];

    // Build document
    const children: Paragraph[] = [];

    // Title page
    children.push(
      new Paragraph({
        text: response.title,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );

    children.push(
      new Paragraph({
        text: "The Content Engine",
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: "The Content Engine",
            size: 28,
            color: "666666",
          }),
        ],
      })
    );

    children.push(
      new Paragraph({
        text: new Date().toLocaleDateString("en-GB", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        alignment: AlignmentType.CENTER,
        spacing: { after: 800 },
        children: [
          new TextRun({
            text: new Date().toLocaleDateString("en-GB", {
              year: "numeric",
              month: "long",
              day: "numeric",
            }),
            size: 22,
            color: "999999",
          }),
        ],
      })
    );

    // Sections
    for (const section of sections) {
      if (!section.content) continue;

      // Section heading
      children.push(
        new Paragraph({
          text: section.title,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
        })
      );

      // Section content — split by newlines into paragraphs
      const paragraphs = section.content.split("\n").filter((line: string) => line.trim());
      for (const para of paragraphs) {
        // Handle markdown headings
        const h2Match = para.match(/^##\s+(.+)/);
        const h3Match = para.match(/^###\s+(.+)/);
        const bulletMatch = para.match(/^[-*]\s+(.+)/);

        if (h2Match) {
          children.push(
            new Paragraph({
              text: h2Match[1],
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 200, after: 100 },
            })
          );
        } else if (h3Match) {
          children.push(
            new Paragraph({
              text: h3Match[1],
              heading: HeadingLevel.HEADING_3,
              spacing: { before: 150, after: 80 },
            })
          );
        } else if (bulletMatch) {
          children.push(
            new Paragraph({
              text: bulletMatch[1],
              bullet: { level: 0 },
              spacing: { after: 60 },
            })
          );
        } else {
          // Handle bold markdown (**text**)
          const parts = para.split(/(\*\*[^*]+\*\*)/);
          const runs = parts.map((part: string) => {
            const boldMatch = part.match(/^\*\*(.+)\*\*$/);
            return new TextRun({
              text: boldMatch ? boldMatch[1] : part,
              bold: !!boldMatch,
              size: 22,
            });
          });

          children.push(
            new Paragraph({
              children: runs,
              spacing: { after: 120 },
            })
          );
        }
      }
    }

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1440,
                right: 1440,
                bottom: 1440,
                left: 1440,
              },
            },
          },
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text: "The Content Engine — ",
                      size: 16,
                      color: "999999",
                    }),
                    new TextRun({
                      text: response.title,
                      size: 16,
                      color: "999999",
                      italics: true,
                    }),
                  ],
                }),
              ],
            }),
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      children: [PageNumber.CURRENT],
                      size: 16,
                      color: "999999",
                    }),
                  ],
                }),
              ],
            }),
          },
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const uint8 = new Uint8Array(buffer);

    const fileName = `${response.title.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "_")}_TCE.docx`;

    return new NextResponse(uint8, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error: any) {
    console.error("[RFP Export] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
