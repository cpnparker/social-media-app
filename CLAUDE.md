# Project Memory

## Key Architecture Notes

- EngineAI uses multi-provider AI (Claude/Grok/GPT/Gemini) with streaming SSE
- Image generation: gpt-image-1 (DALL-E 3 fallback) for Claude/GPT/Gemini, native `grok-imagine-image` for Grok; image-to-image (attached reference images: logos, likeness portraits) always via gpt-image-1 edits regardless of chat model
- Images stored in Vercel Blob for permanent URLs
- Markdown → HTML pipeline: `parseSourcesFromContent()` → `formatMarkdown()` → `DOMPurify.sanitize()` → `dangerouslySetInnerHTML`
- AI response CSS classes all prefixed with `.ai-` in `globals.css`
