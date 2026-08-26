import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { deliveryGroups, pillsFor } from "../lib/card-summary";

/**
 * Guards the mobile layer.
 *
 * The dashboard is responsive by a single rule: unprefixed classes describe the
 * phone, `md:` restores the desktop surface that operators already know. These
 * assertions cover the handful of places where breaking that rule is silent —
 * the page renders, and only a phone (or only the desktop) is wrong.
 */

const source = (path: string) => readFile(resolve(path), "utf8");

async function fileExists(path: string) {
  try {
    await readFile(resolve(path));
    return true;
  } catch {
    return false;
  }
}

test("the viewport is declared, or mobile Safari renders a zoomed-out desktop page", async () => {
  const layout = await source("app/layout.tsx");

  const start = layout.indexOf("export const viewport: Viewport");
  assert.notEqual(start, -1, "layout must export viewport metadata");
  // The object literal only — a mention in a comment must not satisfy this.
  const declaration = layout.slice(start, layout.indexOf("};", start));

  assert.match(declaration, /width:\s*"device-width"/);
  assert.match(declaration, /initialScale:\s*1\b/);
  // Pinch-zoom must stay available: operators zoom into project codes and ids.
  assert.doesNotMatch(declaration, /maximumScale|userScalable/, "user zoom must not be disabled");
});

test("exactly one header shows per breakpoint", async () => {
  const shell = await source("components/DashboardShell.tsx");
  const headers = shell.match(/<header className="[^"]*"/g) ?? [];

  assert.equal(headers.length, 2, "one mobile bar and one desktop header");
  const mobile = headers.filter((h) => h.includes("md:hidden"));
  const desktop = headers.filter((h) => h.includes("md:flex") && h.includes("hidden"));
  assert.equal(mobile.length, 1, "the mobile bar must be md:hidden");
  assert.equal(desktop.length, 1, "the desktop header must be hidden below md");

  // The phone bar carries the search box — the primary way to find a project.
  const mobileBar = shell.slice(shell.indexOf(mobile[0]), shell.indexOf(headers[1]));
  assert.match(mobileBar, /type="search"/, "the mobile bar must keep the search input");
  assert.match(mobileBar, /Open menu/, "the mobile bar must open the service drawer");
});

test("mobile-only overlays can never appear on desktop", async () => {
  for (const file of ["components/ProjectSheet.tsx", "components/ServiceDrawer.tsx"]) {
    const text = await source(file);
    const root = text.slice(text.indexOf("return ("), text.indexOf("return (") + 200);
    assert.match(root, /className="md:hidden"/, `${file} root must be md:hidden`);
  }
});

test("the card defers detail to the sheet on mobile and keeps the desktop card intact", async () => {
  const card = await source("components/ProjectCard.tsx");

  // Whole-card tap target, phone only.
  assert.match(card, /absolute inset-0 z-20[^"]*md:hidden/, "tap overlay must be mobile-only");
  // Editing on a phone goes through the sheet, so the inline button is md-only.
  assert.match(card, /onClick=\{onEdit\}[\s\S]{0,240}md:block/, "the inline Edit button must be md-only");
  // The chip list and derived links are the details a phone card drops.
  assert.match(card, /className="hidden md:block">\s*\n\s*<div className="mb-1[^"]*">Delivery/);
  assert.match(card, /className="hidden flex-wrap gap-2 md:flex"/, "auto links must be md-only");
});

test("the editor is a full screen on a phone and the same drawer on desktop", async () => {
  const editor = await source("components/ConfigEditor.tsx");

  assert.match(editor, /fixed inset-0 z-50[^"]*md:inset-y-0[^"]*md:w-\[min\(760px,100vw\)\]/);
  // A 240px label column leaves no room for a control at phone width.
  assert.match(editor, /grid-cols-1[^`]*md:grid-cols-\[240px_1fr\]/);
  // Touch targets: a 24px switch is below the 44px minimum.
  assert.match(editor, /min-h-11[^"]*md:min-h-0/);
});

test("phone-only CSS stays inside its media query", async () => {
  const css = await source("app/globals.css");

  // iOS zooms the page when a focused control's text is under 16px.
  const zoomFix = /@media \(max-width: 767px\) \{\s*input,\s*select,\s*textarea \{\s*font-size: 16px;/;
  assert.match(css, zoomFix, "controls must reach 16px on phones");

  // These are declared after Tailwind's utilities, so an unscoped version would
  // out-rank `md:py-*` and change the desktop padding.
  const safeArea = css.slice(css.indexOf(".pt-safe") - 400, css.indexOf(".pb-safe"));
  assert.match(safeArea, /@media \(max-width: 767px\)/, "safe-area padding must be phone-scoped");
});

test("long unbreakable tokens cannot push a card past the viewport", async () => {
  const authForm = await source("components/auth-form.tsx");
  const codeTags = authForm.match(/<code className="[^"]*"/g) ?? [];

  assert.ok(codeTags.length > 0);
  for (const tag of codeTags) {
    assert.match(tag, /break-all/, `env-var names must wrap: ${tag}`);
  }
});

test("the formatter preview stays a desktop affordance", async () => {
  const component = await source("components/FormatterPreview.tsx");

  // A 900px comparison panel has nowhere to go on a phone, so the `?` is
  // desktop-only until there is a mobile design for it. `hidden` alone would
  // remove it everywhere; `md:inline-flex` alone would show it everywhere.
  const button = component.slice(component.indexOf("export function FormatterPreviewButton"));
  assert.match(button, /className="hidden [^"]*md:inline-flex/);
});

test("a disabled card is dimmed once, not twice", async () => {
  const card = await source("components/ProjectCard.tsx");
  // Only the class list, not the comments around it — the comment above this
  // block names `opacity-60` while describing why it was removed, and matching
  // prose instead of code is how this test would lie.
  const block = card.slice(card.indexOf('"bg-card",'), card.indexOf("].join("));

  // The original bug was compounding: opacity-60 AND a 45% scrim made a disabled
  // card unreadable, and since every new project starts disabled there was no way
  // to enable one from the UI. A light wash is fine; stacking is what broke it.
  const classes = block.replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(classes, /opacity-\d\d/, "no blanket opacity on the card");
  assert.ok(block.includes("? ") && block.includes(": emphasis !== \"active\""), "the two are exclusive");

  // Every wash, in the order they appear: disabled, then manual, then idle.
  const washes = [...classes.matchAll(/after:bg-black\/(\d+)/g)].map((m) => Number(m[1]));
  assert.equal(washes.length, 3, "one wash for disabled, one for manual, one for idle");
  const [disabled, manual, idle] = washes;

  // 45% stacked with opacity-60 is what made a disabled card unfindable, and
  // every new project starts disabled. Anything approaching that is the bug.
  for (const wash of washes) assert.ok(wash <= 35, `a ${wash}% wash is too heavy to read through`);

  // A disabled card must never be the darkest thing on screen: it is the one a
  // reader has to find and open in order to switch the project on.
  assert.ok(disabled <= idle, `disabled (${disabled}%) is darker than idle (${idle}%)`);
  // Manual ingestion still does real work, so it is the dimmest wash of the three.
  assert.ok(manual <= disabled && manual <= idle, `manual (${manual}%) should be the lightest`);

  // And the signal a reader actually needs stays at full contrast.
  assert.match(card, /border-2 border-warn\/50/, "disabled keeps its amber border");
  assert.match(card, /bg-warn\/20 px-1\.5 py-0\.5 text-warn/, "and its loud badge");
});

test("the company watermark cannot swallow a click, and stays readable to a reader", async () => {
  const mark = await source("components/CompanyMark.tsx");

  // It sits over the whole card, so if it were not inert it would eat every
  // click on the card beneath it — including Edit and the group links.
  assert.match(mark, /pointer-events-none/, "the watermark must be inert");
  assert.match(mark, /absolute/, "and positioned out of flow");
  // Centred on both axes. It was first pinned to the right edge, which put it
  // under the delivery chips instead of behind the middle of the card.
  assert.match(mark, /left-1\/2/, "centred horizontally");
  assert.match(mark, /top-1\/2/, "centred vertically");
  assert.match(mark, /-translate-x-1\/2/, "and actually offset back, not just positioned");
  assert.match(mark, /-translate-y-1\/2/);
  // Subtle enough not to fight the text it sits behind.
  // A range, not a fixed value: the right level depends on the artwork, and
  // these three differ. Past roughly a third it stops being a watermark and
  // starts competing with the text it sits behind.
  const raw = mark.match(/opacity-(?:\[(0\.\d+)\]|(\d{1,2}))/);
  const opacity = raw?.[1] ? Number(raw[1]) : Number(raw?.[2] ?? 100) / 100;
  assert.ok(opacity > 0 && opacity <= 0.33, `opacity ${opacity} is not a watermark`);

  // A fixed pixel box, not a share of the card. It was 70% of each card, which
  // made the same logo appear at two sizes on one screen, because card height
  // varies with how many delivery groups a project lists.
  const box = mark.match(/h-\[(\d+)px\]\s+w-\[(\d+)px\]/);
  assert.ok(box, "the watermark box must be fixed in pixels, not a percentage");
  const [, boxHeight, boxWidth] = box!.map(Number);

  // And it must fit the SHORTEST card. The card is `relative` with no
  // overflow-hidden, so an oversized mark spills past its edge instead of being
  // clipped. 404 x 257 is the smallest card the desktop grid produces.
  const scales = [...mark.matchAll(/scale-(\d+)/g)].map((m) => Number(m[1]) / 100);
  const largest = Math.max(1, ...scales);
  assert.ok(
    boxHeight * largest <= 257 && boxWidth * largest <= 404,
    `the box is ${boxWidth}x${boxHeight} and scale-${largest * 100} makes it ` +
      `${Math.round(boxWidth * largest)}x${Math.round(boxHeight * largest)}, past a 404x257 card`,
  );

  // A logo is unreadable to anyone who does not already know it — a new joiner,
  // or a screen reader. The name has to survive in text.
  assert.match(mark, /sr-only/, "the company name must remain in the accessible name");
  assert.match(mark, /aria-hidden="true"/, "the image itself is decorative");
  assert.match(mark, /alt=""/, "an empty alt, since the sr-only span carries the name");
  // Keeps each logo's own proportions; the three supplied files differ in shape.
  assert.match(mark, /object-contain/, "no stretching");

  // An unmapped company must render as itself rather than disappear.
  assert.match(mark, /if \(!asset\)/, "there is a fallback branch for an unmapped company");
  assert.match(mark, /\{company\}/, "and it prints the name");
});

test("every company in the dropdown has an asset that exists on disk", async () => {
  // A missing file renders a broken image, not a fallback — the fallback branch
  // only catches a company with no entry at all. So the files are checked.
  const mark = await source("components/CompanyMark.tsx");
  const spec = await source("lib/field-spec.ts");
  const companies = [...spec.matchAll(/COMPANIES = \[([^\]]+)\]/g)][0]?.[1] ?? "";
  const names = [...companies.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ["Wohhup", "Obayashi", "PentaOcean"], "the dropdown list");

  const assets = Object.fromEntries(
    [...mark.matchAll(/(\w+): \{ src: "(\/company\/[^"]+)"/g)].map((m) => [m[1], m[2]]),
  );
  for (const name of names) {
    const path = assets[name];
    assert.ok(path, `${name} needs an entry in ASSETS`);
    assert.equal(await fileExists(`public${path}`), true, `${path} must exist in public/`);
  }
});

test("a Water Parade delivery group is marked with a droplet, not a speech bubble", async () => {
  const card = await source("components/ProjectCard.tsx");

  // The icon must be derived from the role deliveryGroups already assigns from
  // water_parade_outbound_group_id. Re-reading the column in the component
  // would let the icon and the tooltip beside it disagree.
  assert.match(card, /groupIcon = \(role\?: string\) =>/, "one helper, taking the role");
  assert.match(card, /role\?\.includes\("water parade"\).*💧.*💬/s, "droplet on the water-parade role");
  // Comments stripped first: the helper's own comment names the column while
  // explaining why the component does not read it, and matching prose instead
  // of code is how this test would lie.
  const code = card.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /water_parade_outbound_group_id/, "the component must not re-read the column");

  // Both surfaces use it: the desktop chip list and the truncated mobile line.
  assert.match(card, /label=\{groupIcon\(role\)\}/, "the desktop chip");
  assert.match(card, /\$\{groupIcon\(groups\[0\]\.role\)\}/, "and the mobile line");
});

test("the water-parade role the droplet depends on is still assigned", () => {
  // The icon is only as good as the role. If GROUP_COLUMNS stops labelling
  // water_parade_outbound_group_id, every WBGT group silently reverts to a
  // speech bubble and nothing else fails.
  const groups = deliveryGroups("wbgt", {
    whatsapp_group_id: "1201@g.us, 1202@g.us",
    water_parade_outbound_group_id: "1202@g.us",
  });

  assert.equal(groups.find((g) => g.chatId === "1201@g.us")?.role, undefined, "an ordinary group has no role");
  assert.match(
    groups.find((g) => g.chatId === "1202@g.us")?.role ?? "",
    /water parade/,
    "a group that also receives Water Parade carries the role",
  );
  // One chat serving both purposes is one chip, not two — it would also collide
  // as a React key.
  assert.equal(groups.length, 2);

  // The column can HOLD several ids — TEST and ZRA both do — but the reminder
  // path reads it with String(...).trim() and posts it as one chatId, with no
  // comma split. So only the first id is ever a recipient, and the rest must be
  // marked as ignored rather than presented as extra delivery.
  const many = deliveryGroups("wbgt", {
    whatsapp_group_id: "1201@g.us, 1202@g.us",
    water_parade_outbound_group_id: "1201@g.us,1202@g.us",
  });
  assert.equal(many.length, 2);
  assert.match(many[0].role ?? "", /water parade/);
  assert.doesNotMatch(many[0].role ?? "", /ignored/, "the first id is the real recipient");
  assert.match(many[1].role ?? "", /ignored/, "and the second is not sent to at all");
});

test("a second water-parade group is flagged, not drawn as extra delivery", () => {
  // Silent in the service: the column is non-empty, so it never reports missing
  // delivery config — it just posts a chatId with a comma in it.
  const two = pillsFor("wbgt", {
    water_parade_enabled: true,
    water_parade_outbound_group_id: "1201@g.us,1202@g.us",
  });
  const warning = two.find((p) => /water parade groups/.test(p.label));
  assert.ok(warning?.on, "a project with two ids must say so");
  assert.equal(warning?.tone, "warn", "and loudly, since nothing else reports it");

  const one = pillsFor("wbgt", { water_parade_enabled: true, water_parade_outbound_group_id: "1201@g.us" });
  assert.ok(!one.some((p) => /water parade groups/.test(p.label)), "no warning on a correct row");
});

test("the Water Parade pills are one blue family, and an off one still reads as off", async () => {
  // Tone says what a pill is ABOUT; `on` says whether it is in force. Before
  // this, the tone branch ignored `on`, so an off toned pill rendered exactly
  // like an on one — which would have made MBS look like it excludes Woh Hup
  // when it is the one project that does not.
  for (const file of ["components/ProjectCard.tsx", "components/ProjectSheet.tsx"]) {
    const source_ = await source(file);
    // Anchored FORWARD from the tone branch: `bg-muted` also appears earlier, in
    // the Chip component, and slicing to its first occurrence produced an empty
    // string that matched nothing.
    const start = source_.indexOf('pill.tone === "info"');
    const toned = source_.slice(start, source_.indexOf("bg-muted", start));
    assert.ok(toned.length > 0, `${file}: could not find the toned-pill branch`);
    assert.match(toned, /pill\.on/, `${file}: a toned pill must still branch on \`on\``);
    assert.match(toned, /text-primary\/60 line-through/, `${file}: an off info pill is struck through`);
    assert.match(toned, /text-warn\/60 line-through/, `${file}: and so is an off warn pill`);
  }

  // All three Water Parade pills carry the blue tone, and the two switchable
  // ones report their real state.
  const { pillsFor } = await import("../lib/card-summary");
  const on_ = pillsFor("wbgt", {
    water_parade_enabled: true,
    water_parade_cooldown_enabled: true,
    exclude_wohhup_from_manpower: true,
  });
  for (const label of ["💧 Water Parade", "cooldown 2h", "excl. Woh Hup"]) {
    const pill = on_.find((p) => p.label === label);
    assert.equal(pill?.tone, "info", `${label} should be blue`);
    assert.equal(pill?.on, true, label);
  }

  const off = pillsFor("wbgt", { water_parade_enabled: true, exclude_wohhup_from_manpower: false });
  assert.equal(off.find((p) => p.label === "cooldown 2h")?.on, false);
  assert.equal(off.find((p) => p.label === "cooldown 2h")?.tone, "info", "still blue when off");
  assert.equal(off.find((p) => p.label === "excl. Woh Hup")?.on, false);
  assert.equal(off.find((p) => p.label === "excl. Woh Hup")?.tone, "info");
});

test("the coordinate picker is offered wherever coordinates are, and only there", async () => {
  const dialog = await source("components/OnboardDialog.tsx");
  // Gated on the same condition as the address lookup, so the two always appear
  // together — the lookup answers "where is 068914", the map answers "the site
  // entrance is round the back".
  assert.match(dialog, /wantsCoordinates \? \(\s*<div className="mt-2">\s*<CoordinatePicker/);
  // Both fields are marked edited, or haze's nea_region autofill would not
  // recompute from a dragged point.
  assert.match(dialog, /add\("latitude"\)\.add\("longitude"\)/);

  const picker = await source("components/CoordinatePicker.tsx");
  // No mapping library: the arithmetic lives in the tested module, not here.
  assert.doesNotMatch(picker, /from "leaflet"|from "mapbox|google\.maps/);
  assert.match(picker, /from "@\/lib\/slippy-map"/);
  // A drag must be anchored on where it started. Panning from the rendered
  // centre loses every move that arrives before React re-renders, and the map
  // then travels about half as far as the pointer.
  assert.match(picker, /origin: centre/);
  assert.match(picker, /panCentre\(state\.origin/);
  assert.doesNotMatch(picker, /panCentre\(centre, \{ dx: -state/);
  // Attribution is a condition of using OneMap's tiles.
  assert.match(picker, /TILE_ATTRIBUTION/);
  // The crosshair must never eat the drag underneath it.
  assert.match(picker, /pointer-events-none absolute left-1\/2 top-1\/2/);
});
