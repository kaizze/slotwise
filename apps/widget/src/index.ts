import { SlotWiseWidget } from './widget';
import type { SlotWiseWidgetConfig } from './widget';
import { SlotWiseChatWidget } from './chat-widget';
import type { SlotWiseChatConfig } from './chat-widget';

// ─── Auto-init from the embedding <script> tag ────────────────────────────────
//
// Booking widget (default / data-mode="booking"):
//   <script src="...slotwise-widget.js"
//           data-business="salon-eleni"
//           data-accent="#ec4899">
//   </script>
//
// Conversational chat widget (data-mode="chat"):
//   <script src="...slotwise-widget.js"
//           data-business="salon-eleni"
//           data-mode="chat"
//           data-lang="el"
//           data-target="my-chat-div">
//   </script>
//   <div id="my-chat-div"></div>
//
// `data-api-base` is optional on both — defaults to https://app.coloredkidz.gr

function findOwnScriptTag(): HTMLScriptElement | null {
  if (document.currentScript instanceof HTMLScriptElement) {
    return document.currentScript;
  }
  return document.querySelector('script[data-business]');
}

function autoInit(): void {
  const scriptTag = findOwnScriptTag();
  if (!scriptTag) return;

  const businessSlug = scriptTag.dataset.business;
  if (!businessSlug) return;

  const mode      = scriptTag.dataset.mode ?? 'booking';
  const apiBaseUrl  = scriptTag.dataset.apiBase;
  const accentColor = scriptTag.dataset.accent;

  const start = () => {
    if (mode === 'chat') {
      const chatConfig: SlotWiseChatConfig = {
        businessSlug,
        apiBaseUrl,
        accentColor,
        lang: (scriptTag.dataset.lang as 'el' | 'en') ?? 'el',
        targetId: scriptTag.dataset.target,
      };
      new SlotWiseChatWidget(chatConfig);
    } else {
      const bookingConfig: SlotWiseWidgetConfig = {
        businessSlug,
        apiBaseUrl,
        accentColor,
      };
      new SlotWiseWidget(bookingConfig);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}

autoInit();

// ─── Manual init API ───────────────────────────────────────────────────────────

const SlotWiseWidgetGlobal = {
  init: (config: SlotWiseWidgetConfig) => new SlotWiseWidget(config),
  initChat: (config: SlotWiseChatConfig) => new SlotWiseChatWidget(config),
};

declare global {
  interface Window {
    SlotWiseWidget: typeof SlotWiseWidgetGlobal;
  }
}

window.SlotWiseWidget = SlotWiseWidgetGlobal;

