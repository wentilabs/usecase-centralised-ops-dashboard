import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

/**
 * Guards the mobile layer.
 *
 * The dashboard is responsive by a single rule: unprefixed classes describe the
 * phone, `md:` restores the desktop surface that operators already know. These
 * assertions cover the handful of places where breaking that rule is silent —
 * the page renders, and only a phone (or only the desktop) is wrong.
 */

const source = (path: string) => readFile(resolve(path), "utf8");

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
