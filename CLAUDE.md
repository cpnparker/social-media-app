# Project Memory

## Key Architecture Notes

- EngineGPT uses multi-provider AI (Claude/Grok/GPT/Gemini) with streaming SSE
- Image generation: DALL-E 3 for Claude/GPT/Gemini, native `grok-imagine-image` for Grok
- Images stored in Vercel Blob for permanent URLs
- Markdown → HTML pipeline: `parseSourcesFromContent()` → `formatMarkdown()` → `DOMPurify.sanitize()` → `dangerouslySetInnerHTML`
- AI response CSS classes all prefixed with `.ai-` in `globals.css`
