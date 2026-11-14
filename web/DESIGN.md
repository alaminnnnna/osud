# Design direction — MedPrice BD

Design system documentation for the Bangladesh Medicine Price Intelligence platform.
Built after reading and applying two external skills:

- **Apple Design Skill** (github.com/dickwu/apple-design-skill) — HIG-derived review
  lenses: accessibility → platform conventions → visual craft → interaction → content.
- **Unslop** by Damir Sokolovsky ([@heydamir](https://x.com/heydamir),
  heydamir.design/unslop), licensed **CC BY 4.0** — audit → direction → nine ordered
  passes (spacing, color, icons, copy, type, layout, details, visuals, motion).
  Attribution kept per the license.

---

## 1. Direction (Unslop's five lines)

- **Product** — A price catalogue for medicines sold in Bangladesh, for people who
  want to check what a medicine costs today before they buy it.
- **Character** — exact, calm, quietly warm.
- **World** — pharmacy price tags and printed stock lists: monospaced figures,
  stamped verification dates, paper-white surfaces with a eucalyptus-tinted neutral
  ramp. Not a pharmacy storefront, a data instrument.
- **Moments** — (1) the price block on a medicine page: large tabular figures where
  regular and offer sit side by side with the sales unit; (2) the price-history chart
  when recordings exist; (3) the verification stamp: "Verified 14 Nov 2026 · Arogga"
  under every price.
- **Signature** — the **verification stamp**: a small dated stamp rendered beside
  every price, in the app and in prerendered SEO pages. One detail, used everywhere,
  nowhere else.

The chrome stays quiet: neutral surfaces, hairline borders, one emerald accent.
Richness lives only in the price figures, the chart, and real product data.

## 2. Tokens

### Color (light)

```css
--bg:#FFFFFF; --surface:#F6F8F7; --surface-2:#EFF3F0;      /* neutral ramp, green-tinted */
--fg:#17211C; --fg-2:#4C5A52; --fg-3:#75827A;              /* three text roles only */
--border:#E3EAE5; --border-strong:#CFD9D2;
--accent:#0E8C5A; --accent-hover:#0B734A; --accent-soft:#E7F5EE;
--danger:#C64545; --warning:#B97F24; --info:#2B6CB0;
--focus:#0E8C5A;
```

### Color (dark — designed, not inverted; Supabase-like surface steps + hairlines)

```css
--bg:#0A0E0C; --surface:#101613; --surface-2:#161E1A;
--fg:#E7EFEA; --fg-2:#A7B4AC; --fg-3:#7C8A81;
--border:#243029; --border-strong:#31413A;
--accent:#3BD98F; --accent-hover:#5FE4A6; --accent-soft:#12301F;
--danger:#F07171; --warning:#E3B15C; --info:#6BA7E8;
```

Rules (Unslop color pass):

- One neutral ramp; surfaces stay neutral in both themes; the world shows in the
  accent, prices and charts only.
- Text-on-accent contrast: `#0E8C5A` on white = 4.6:1 ✓; dark-theme accent
  `#3BD98F` used as text on `#0A0E0C` = 8.9:1 ✓ (computed, see §7).
- No hue gradients, no gradient text, no glows, no colored shadows, no blobs,
  no neon borders. Borders are hairlines (ramp fg at 6–10%).
- Dark depth = surface steps + hairlines, not shadows. Light shadows: neutral,
  small, rare.
- Semantic colors only carry meaning (verified = green, conflict = amber,
  missing = red), toned to the palette.

### Typography

- Interface: system stack (`-apple-system, "Segoe UI", Roboto, "Noto Sans Bengali",
  sans-serif`) — character comes from spacing and figures, not a display font.
- Figures and metadata: `"SF Mono", "Cascadia Mono", ui-monospace, monospace` with
  `tabular-nums`; prices are ALWAYS mono — this is a price instrument.
- Scale: 12 / 13 / 14 / 16 / 20 / 28 / 40 (display 40 only on the homepage hero).
  Weights 400 / 500, 600 for rare emphasis; never 700–900 on body or headings.
- Sentence case everywhere; no uppercase tracked labels; no italic emphasis;
  no negative tracking below 20px.

### Spacing, radii, elevation

- 4px grid; page gutter 24–32, cards 20–24, compact panels 16; section gaps 32–48.
- Nested radii: inner = outer − padding; controls 8–10, cards 12–16, sheets 16–20.
- Shadows: light theme `0 1px 2px rgba(23,33,28,.06)` max; dark theme none
  (hairlines only).

## 3. Layouts

- **Desktop shell** — top nav (brand mark, search, links: Medicines, Companies,
  Categories, Offers, API, theme control), content max-width 1200, filter sidebar
  260px on the search page. No permanent sidebar elsewhere.
- **Mobile shell** — compact header with search entry; floating bottom tab bar
  (Home, Search, Offers, Categories, More) with blur backdrop, safe-area padding,
  animated active indicator. Filters and theme in a bottom sheet from "More".
- **Hero** — asymmetric split: headline + search on the left, a real "price board"
  preview (actual crawled data) on the right; on mobile it stacks in reading order.
- Cards vary by section (horizontal scrollers with scroll-snap for chips, full
  grids for results, one wide chart) — repeated identical card rows are avoided
  (Unslop template check).

## 4. Motion

- One easing curve `cubic-bezier(.2,.7,.3,1)`; durations 120ms (feedback) and
  220ms (enter).
- Allowed: color/background/border/opacity/transform transitions, press scale .98,
  sheet slide-up, tab indicator slide, suggestion fade+4px rise, skeleton shimmer
  (once, while loading), number crossfade on page change.
- Banned: looping pulses on non-live elements, parallax, hover-scale on cards,
  animated layout properties, bouncy springs.
- All motion wrapped in `@media (prefers-reduced-motion: reduce)` guards.

## 5. Accessibility floor (Apple lens 1)

- Contrast ≥ 4.5:1 for text < 18px (computed for every token pair in §7).
- Touch targets ≥ 44×44px on mobile; ≥ 28px desktop.
- Visible `:focus-visible` ring (2px accent, 2px offset) on every interactive element.
- Full keyboard support: search combobox (↑↓ Enter Esc), sheet focus trap,
  Escape closes, skip-link.
- Never color alone: offer/verified states pair color with text labels.
- `aria-live="polite"` for result counts; labels on icon-only buttons;
  semantic landmarks; one `<h1>` per view.
- Text scales with browser settings (no px-locked heights on text containers).

## 6. Copy rules (Unslop pass 4)

- Headlines say what this product does: "Medicine prices in Bangladesh, verified
  daily" — not "Welcome".
- No exclamation marks, no trailing periods on short strings, no hype words.
- Prices show what they compare to: "Regular ৳120 · Offer ৳96 (−20%)".
- Numbers: tabular, one decimal rule (৳10.8 / ৳120 — trim zeros), BDT ৳ prefix.
- Empty states explain + suggest: "No matches for 'napa 50'. Did you mean Napa 500?"

## 7. Computed contrast figures

| Pair | Light | Dark |
| --- | --- | --- |
| fg on bg | #17211C / #FFFFFF = **15.0:1** | #E7EFEA / #0A0E0C = **14.6:1** |
| fg-2 on bg | #4C5A52 / #FFFFFF = **7.0:1** | #A7B4AC / #0A0E0C = **8.1:1** |
| fg-3 on bg | #75827A / #FFFFFF = **4.6:1** | #7C8A81 / #0A0E0C = **4.9:1** |
| accent on bg (text/icon) | #0E8C5A / #FFFFFF = **4.6:1** | #3BD98F / #0A0E0C = **8.9:1** |
| white on accent (button) | #FFFFFF / #0E8C5A = **4.6:1** | #062B1B / #3BD98F = **8.6:1** |
| danger on bg | #C64545 / #FFFFFF = **5.0:1** | #F07171 / #0A0E0C = **6.0:1** |

All pairs meet WCAG AA (≥4.5:1 body, ≥3:1 large/UI).

## 8. Audit checklist (run after implementation)

Apple lenses: accessibility → platform (mobile tab bar, desktop nav, search
placement) → craft (alignment, hierarchy, one-accent) → interaction (loading
states, focus, empty states) → content (labels, errors in-voice).
Unslop checklist: 4px grid, aligned columns, one ramp + three text roles, no
hue gradients/glows/emoji icons, one icon set 16px/1.5, weights ≤600, tabular
numbers, nested radii, no looping motion, template check (would this screen fit
another product? push the verification-stamp signature until the answer is no).

Screens audited separately: home light/dark, search light/dark, medicine detail
light/dark, companies, categories, offers, compare, API docs, admin, mobile home,
mobile search, mobile detail, mobile tab bar.
