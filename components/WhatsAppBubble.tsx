import type { ReactNode } from "react";

import type { PreviewBubble } from "@/lib/message-previews";

/** WhatsApp renders `*bold*` and `_italic_`; these services use both and nothing else. */
const WA_MARKUP = /(\*[^*\n]+\*|_[^_\n]+_)/g;

function renderWhatsApp(text: string): ReactNode[] {
  return text.split(WA_MARKUP).map((part, index) => {
    if (/^\*[^*\n]+\*$/.test(part)) {
      return <strong key={index}>{part.slice(1, -1)}</strong>;
    }
    if (/^_[^_\n]+_$/.test(part)) {
      return (
        <em key={index} className="text-[#8696a0]">
          {part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
}

/**
 * One received message.
 *
 * WhatsApp's own dark palette, hard-coded rather than themed: the point is that
 * this looks like WhatsApp and not like the rest of the dashboard, so a reader
 * knows at a glance they are looking at the message and not at more config.
 */
export function WhatsAppBubble({ bubble }: { bubble: PreviewBubble }) {
  return (
    <div>
      {bubble.caption ? (
        <div className="mb-1 text-[10px] uppercase tracking-wider text-[#8696a0]">{bubble.caption}</div>
      ) : null}
      <div className="max-w-[85%] rounded-lg rounded-tl-none bg-[#202c33] px-2.5 py-2 shadow-sm">
        <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-[1.45] text-[#e9edef]">
          {renderWhatsApp(bubble.text)}
        </pre>
      </div>
    </div>
  );
}
