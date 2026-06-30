import { SlotWiseWidget } from './widget';
import type { SlotWiseWidgetConfig } from './widget';

// ─── Auto-init from the embedding <script> tag ────────────────────────────────
//
// Usage on a client site:
//
//   <script
//     src="https://cdn.slotwise.app/slotwise-widget.js"
//     data-business="salon-eleni"
//     data-accent="#ec4899"
//     defer
//   ></script>
//
// `data-api-base` is optional and defaults to the production API — only
// needed for local development against a non-default API host.

function findOwnScriptTag(): HTMLScriptElement | null {
  // currentScript works for classic (non-module) scripts, which this is
  // (built as an IIFE) — this is the reliable case.
  if (document.currentScript instanceof HTMLScriptElement) {
    return document.currentScript;
  }
  // Fallback: look for any script tag carrying our config attribute.
  return document.querySelector('script[data-business]');
}

function autoInit(): void {
  const scriptTag = findOwnScriptTag();
  if (!scriptTag) return;

  const businessSlug = scriptTag.dataset.business;
  if (!businessSlug) return; // no config present — assume manual init will be used instead

  const config: SlotWiseWidgetConfig = {
    businessSlug,
    accentColor: scriptTag.dataset.accent,
    apiBaseUrl: scriptTag.dataset.apiBase,
  };

  const start = () => new SlotWiseWidget(config);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}

autoInit();

// ─── Manual init API ───────────────────────────────────────────────────────
// For sites that prefer JS control over a markup-only script tag:
//
//   <script src="https://cdn.slotwise.app/slotwise-widget.js"></script>
//   <script>
//     SlotWiseWidget.init({ businessSlug: 'salon-eleni', accentColor: '#ec4899' });
//   </script>

const SlotWiseWidgetGlobal = {
  init: (config: SlotWiseWidgetConfig) => new SlotWiseWidget(config),
};

declare global {
  interface Window {
    SlotWiseWidget: typeof SlotWiseWidgetGlobal;
  }
}

window.SlotWiseWidget = SlotWiseWidgetGlobal;
