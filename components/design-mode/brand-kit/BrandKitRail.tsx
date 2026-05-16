"use client";

import { useMemo, useState } from "react";
import { BadgeCheck, AlertTriangle, Wand2, PanelLeftClose, PanelLeftOpen, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DesignBrandKit, DesignClient, DesignShot, VisualIdentity } from "@/lib/design/types";

interface BrandKitRailProps {
  brandKit: DesignBrandKit | null;
  client: DesignClient | null;
  shots: DesignShot[];
  currentShot: DesignShot | null;
  defaultCollapsed?: boolean;
}

/**
 * Always-visible 280px brand kit rail. Renders the client's visual identity
 * (palette + typography + voice + do's/don'ts), the sandstone cap meter, and
 * a "current shot check" card that flips between on-brand and drift.
 */
export function BrandKitRail({ brandKit, client, shots, currentShot, defaultCollapsed }: BrandKitRailProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);

  if (!brandKit) {
    if (collapsed) {
      return (
        <CollapsedRail onExpand={() => setCollapsed(false)} hasBrand={false} clientName={client?.name} primaryHex={undefined} secondaryHexes={[]} onBrand={true} />
      );
    }
    return (
      <aside
        className="flex w-[280px] flex-shrink-0 flex-col gap-3 overflow-y-auto border-r p-4"
        style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg-elev))" }}
      >
        <div className="flex items-center justify-between">
          <div className="section-label muted">Brand kit</div>
          <button
            onClick={() => setCollapsed(true)}
            className="rounded p-1 text-muted-foreground hover:bg-[hsl(var(--design-border))]/40 hover:text-foreground"
            title="Collapse"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="rounded-lg border border-dashed p-3 text-[11.5px] leading-relaxed text-muted-foreground"
             style={{ borderColor: "hsl(var(--design-border-strong))" }}>
          {client
            ? <>Brand kit not extracted yet for <span className="font-medium">{client.name}</span>. Upload a styleguide and we&apos;ll auto-build the kit.</>
            : <>No client selected. Brand auto-injection is off.</>
          }
        </div>
      </aside>
    );
  }

  const v = brandKit.visualIdentity;
  const primary = normalizePalette(v.primary, v.primary_colors, ["Primary"]);
  const secondary = normalizePalette(v.secondary, v.secondary_colors, ["Sandstone", "Pearl", "Stone"]);
  const dos = v.dos || v.do || [];
  const donts = v.donts || v.dont || [];
  const typography = v.typography || {};

  const onBrandCount = shots.filter((s) => s.onBrand).length;
  const totalShots = shots.length || 1;
  const allOnBrand = onBrandCount === totalShots;

  if (collapsed) {
    return (
      <CollapsedRail
        onExpand={() => setCollapsed(false)}
        hasBrand
        clientName={client?.name}
        primaryHex={primary[0]?.hex}
        secondaryHexes={[...primary.slice(1), ...secondary].slice(0, 4).map((c) => c.hex)}
        onBrand={allOnBrand}
      />
    );
  }

  return (
    <aside
      className="flex w-[280px] flex-shrink-0 flex-col gap-4 overflow-y-auto border-r p-4"
      style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg-elev))" }}
    >
      {/* Head */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <div className="section-label">Brand kit</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">{brandKit.versionTag}</div>
        </div>
        <div className="flex items-center gap-1">
          <ClientMark name={client?.name || "?"} />
          <button
            onClick={() => setCollapsed(true)}
            className="rounded p-1 text-muted-foreground hover:bg-[hsl(var(--design-border))]/40 hover:text-foreground"
            title="Collapse"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div>
        <div className="editorial-display text-[18px] leading-tight">{client?.name || "—"}</div>
        {client?.industry && (
          <div className="text-[11px] text-muted-foreground">{client.industry}</div>
        )}
      </div>

      {/* Applied strip */}
      <div
        className="flex items-center justify-between rounded-lg px-3 py-2 text-[11px]"
        style={{ background: "hsl(var(--design-accent-soft))" }}
      >
        <span style={{ color: "hsl(var(--design-accent))" }}>
          Applied · {onBrandCount}/{totalShots} shots
        </span>
        <button className="text-[11px] underline" style={{ color: "hsl(var(--design-accent))" }}>
          Override
        </button>
      </div>

      {/* Palette */}
      <Section label="Palette">
        <div className="grid grid-cols-2 gap-1.5">
          {primary.slice(0, 1).map((c) => (
            <Swatch key={c.hex} color={c} large />
          ))}
          {primary.slice(1, 2).map((c) => (
            <Swatch key={c.hex} color={c} />
          ))}
          {secondary.slice(0, 4).map((c) => (
            <Swatch key={c.hex} color={c} />
          ))}
        </div>
      </Section>

      {/* Sandstone-cap meter — example of a quantitative brand rule */}
      <SandstoneCapMeter currentShot={currentShot} />

      {/* Typography */}
      {(typography.display || typography.headline || typography.body || typography.mono) && (
        <Section label="Typography">
          {(typography.display || typography.headline) && (
            <TypeRow role="Display" face={(typography.display || typography.headline) as string} />
          )}
          {typography.body && <TypeRow role="Body" face={typography.body} />}
          {typography.mono && <TypeRow role="Mono" face={typography.mono} />}
        </Section>
      )}

      {/* Voice */}
      {v.voice && (
        <Section label="Voice">
          <p className="text-[11.5px] italic leading-snug text-muted-foreground">{v.voice}</p>
        </Section>
      )}

      {/* Do's / Don'ts */}
      {(dos.length > 0 || donts.length > 0) && (
        <Section label="Rules">
          {dos.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--design-success))]">Do</div>
              <ul className="space-y-0.5 text-[11px] text-foreground">
                {dos.slice(0, 4).map((r, i) => (
                  <li key={i} className="leading-snug">· {r}</li>
                ))}
              </ul>
            </div>
          )}
          {donts.length > 0 && (
            <div className="space-y-1 pt-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--design-danger))]">Don&apos;t</div>
              <ul className="space-y-0.5 text-[11px] text-foreground">
                {donts.slice(0, 4).map((r, i) => (
                  <li key={i} className="leading-snug">· {r}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {/* Current shot check card */}
      <CurrentShotCheck shot={currentShot} />
    </aside>
  );
}

/**
 * Slim collapsed brand kit rail — 56px wide. Shows the palette as a vertical
 * swatch stack, with click-to-expand. Frees the canvas to breathe.
 */
function CollapsedRail({
  onExpand, hasBrand, clientName, primaryHex, secondaryHexes, onBrand,
}: {
  onExpand: () => void;
  hasBrand: boolean;
  clientName?: string;
  primaryHex?: string;
  secondaryHexes: string[];
  onBrand: boolean;
}) {
  return (
    <aside
      className="flex w-14 flex-shrink-0 flex-col items-center gap-2 border-r py-3"
      style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg-elev))" }}
    >
      <button
        onClick={onExpand}
        className="rounded-full p-1.5 text-muted-foreground hover:bg-[hsl(var(--design-border))]/40 hover:text-foreground"
        title="Open brand kit"
      >
        <PanelLeftOpen className="h-4 w-4" />
      </button>

      {/* Vertical palette stack */}
      <div className="flex flex-col items-center gap-1">
        {primaryHex ? (
          <button
            onClick={onExpand}
            title={clientName || "Brand palette"}
            className="h-7 w-7 rounded-md ring-1 ring-black/5 transition-transform hover:scale-110"
            style={{ background: primaryHex }}
          />
        ) : (
          <button
            onClick={onExpand}
            title="No brand kit"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-dashed"
            style={{ borderColor: "hsl(var(--design-border-strong))" }}
          >
            <Palette className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
        {secondaryHexes.map((hex, i) => (
          <button
            key={i}
            onClick={onExpand}
            className="h-5 w-5 rounded ring-1 ring-black/5 transition-transform hover:scale-110"
            style={{ background: hex }}
          />
        ))}
      </div>

      {/* On-brand indicator at bottom */}
      <div className="mt-auto">
        {hasBrand && (
          <div
            className="flex h-6 w-6 items-center justify-center rounded-full"
            style={{
              background: onBrand ? "hsl(var(--design-success))" : "hsl(var(--design-warning))",
              color: "white",
            }}
            title={onBrand ? "All shots on brand" : "Some shots drifting"}
          >
            {onBrand ? <BadgeCheck className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          </div>
        )}
      </div>
    </aside>
  );
}

function ClientMark({ name }: { name: string }) {
  const initial = (name || "?").slice(0, 1).toUpperCase();
  return (
    <div className="relative h-9 w-9">
      <div className="dot-ring absolute inset-0" style={{ color: "hsl(var(--design-accent))" }} />
      <div
        className="absolute inset-1 flex items-center justify-center rounded-full text-[12px] font-semibold text-white"
        style={{
          background: "radial-gradient(circle at 35% 30%, hsl(var(--design-accent)), hsl(220 50% 25%))",
        }}
      >
        {initial}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="section-label muted">{label}</div>
      {children}
    </div>
  );
}

interface Color { name: string; hex: string }

function Swatch({ color, large }: { color: Color; large?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col justify-between overflow-hidden rounded-md p-2 text-[10px]",
        large ? "row-span-2 h-[88px]" : "h-[42px]",
      )}
      style={{ background: color.hex, color: getContrastText(color.hex) }}
    >
      <span className="font-medium leading-none">{color.name}</span>
      <span className="font-mono opacity-80">{color.hex.toUpperCase()}</span>
    </div>
  );
}

function TypeRow({ role, face }: { role: string; face: string }) {
  return (
    <div className="flex items-baseline justify-between border-b py-1 last:border-0"
         style={{ borderColor: "hsl(var(--design-border))" }}>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{role}</span>
      <span className="editorial-display text-[13px]">{face}</span>
    </div>
  );
}

/**
 * Sandstone-cap meter — example of how to surface a quantitative brand rule.
 * Falls back to a stylized placeholder when the brand has no such rule.
 */
function SandstoneCapMeter({ currentShot }: { currentShot: DesignShot | null }) {
  const value = useMemo(() => {
    if (!currentShot) return 9.2;
    // Read from brand cert metadata if present; otherwise use a deterministic
    // pseudo-value derived from the shot id (purely visual until we wire the
    // real brand-check engine).
    const meta = currentShot.versions[currentShot.versions.length - 1]?.metadata;
    if (meta?.sandstone_pct != null) return Number(meta.sandstone_pct);
    if (!currentShot.onBrand) return 18;
    return 9.2;
  }, [currentShot]);

  const cap = 14;
  const over = value > cap;
  const widthPct = Math.min((value / 20) * 100, 100);

  return (
    <Section label="Sandstone cap">
      <div className="space-y-1.5 rounded-lg border p-2.5"
           style={{ borderColor: "hsl(var(--design-border))" }}>
        <div className="flex items-baseline justify-between">
          <span className="editorial-numeric text-[16px]" style={{ color: over ? "hsl(var(--design-danger))" : "hsl(var(--design-fg))" }}>
            {value.toFixed(1)}<span className="ml-0.5 text-[9px] uppercase text-muted-foreground">%</span>
          </span>
          <span className="text-[10px] text-muted-foreground">cap {cap}%</span>
        </div>
        <div className="relative h-1.5 overflow-hidden rounded-full" style={{ background: "hsl(var(--design-border))" }}>
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${widthPct}%`, background: over ? "hsl(var(--design-danger))" : "hsl(var(--design-success))" }}
          />
          {/* Cap marker */}
          <div className="absolute top-0 h-full w-px"
               style={{ left: `${(cap / 20) * 100}%`, background: "hsl(var(--design-fg) / 0.6)" }}
          />
        </div>
        <div className="text-[10px] text-muted-foreground">Sandstone never exceeds {cap}% of frame.</div>
      </div>
    </Section>
  );
}

function CurrentShotCheck({ shot }: { shot: DesignShot | null }) {
  if (!shot) {
    return (
      <div className="rounded-lg border p-3 text-[11px] text-muted-foreground"
           style={{ borderColor: "hsl(var(--design-border))" }}>
        Pick a shot to see brand check.
      </div>
    );
  }
  if (shot.onBrand) {
    return (
      <div className="space-y-1.5 rounded-lg border p-3"
           style={{ borderColor: "hsl(var(--design-success) / 0.4)", background: "hsl(158 60% 96%)" }}>
        <div className="flex items-center gap-1.5 text-[hsl(var(--design-success))]">
          <BadgeCheck className="h-3.5 w-3.5" />
          <span className="text-[12px] font-semibold">On brand</span>
        </div>
        <div className="text-[11px] leading-snug text-foreground/80">
          Shot {shot.idx} passes all brand checks.
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border p-3"
         style={{ borderColor: "hsl(var(--design-warning) / 0.5)", background: "hsl(38 85% 95%)" }}>
      <div className="flex items-center gap-1.5" style={{ color: "hsl(25 70% 35%)" }}>
        <AlertTriangle className="h-3.5 w-3.5" />
        <span className="text-[12px] font-semibold">Drift detected</span>
      </div>
      <div className="text-[11px] leading-snug text-foreground/80">
        {shot.note || "Brand rule violated."}
      </div>
      <div className="flex gap-1.5">
        <button className="inline-flex items-center gap-1 rounded-md bg-[hsl(var(--design-accent))] px-2 py-1 text-[10.5px] font-medium text-white">
          <Wand2 className="h-3 w-3" /> Auto-correct
        </button>
        <button className="rounded-md border px-2 py-1 text-[10.5px] font-medium"
                style={{ borderColor: "hsl(var(--design-border))" }}>
          Mark intentional
        </button>
      </div>
    </div>
  );
}

/** Heuristic — pure black or pure white text based on perceived luminance. */
function getContrastText(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return "#000";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.62 ? "#1a1a1a" : "#ffffff";
}

function normalizePalette(
  arrA: VisualIdentity["primary"],
  arrB: VisualIdentity["primary_colors"],
  defaults: string[]
): Color[] {
  if (Array.isArray(arrA) && arrA.length > 0) return arrA;
  if (Array.isArray(arrB) && arrB.length > 0) {
    return arrB.map((hex, i) => ({ name: defaults[i] || `Color ${i + 1}`, hex }));
  }
  return [];
}
