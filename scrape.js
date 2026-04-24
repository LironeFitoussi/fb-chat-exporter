// fb-chat-exporter / scrape.js
// STEP 4 — Hybrid: user calibrates, script automates.
//
// Workflow:
//   1. fbExport()            — arms everything, prints instructions.
//   2. User scrolls the chat ONCE (any direction) — script listens and
//      captures which element fired the real `scroll` event. That's the
//      scroller, identified from a trusted user gesture rather than a
//      synthetic wheel event (more reliable, no guessing).
//   3. Script auto-scrolls DOWN to the bottom → ensures newest messages
//      are mounted and captured by the observer.
//   4. Script auto-scrolls UP to the top → triggers FB to lazy-load batches.
//      MutationObserver harvests every [aria-roledescription="message"] as
//      it mounts. Stops when scrollHeight stops growing.
//   5. Returns { conversation, messageCount, messages, unparsed }, copies
//      JSON to clipboard.
//
// Stable ARIA anchors (a11y-critical, so FB won't change them):
//   [role="log"][aria-label^="Messages in conversation with "]
//   [aria-roledescription="message"]  (on each message div)

(() => {
  const STATE = (window.__fbScrape ??= {
    running: false,
    aborted: false,
    phase: "idle",
    batch: 0,
  });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function setCaptureContext(phase, batch = 0) {
    STATE.phase = phase;
    STATE.batch = batch;
  }

  // ---------- ARIA anchors ----------

  function findLog() {
    const log = document.querySelector('[role="log"][aria-label^="Messages in conversation with"]')
      ?? document.querySelector('[role="log"]');
    if (!log) throw new Error("Couldn't find [role='log']. Open a Messenger conversation first.");
    return log;
  }

  function conversationName() {
    const log = document.querySelector('[role="log"][aria-label^="Messages in conversation with"]');
    const label = log?.getAttribute("aria-label") || "";
    return label.replace(/^Messages in conversation with /, "").trim() || null;
  }

  // ---------- scroller identification via real user scroll ----------

  function waitForUserScroll(log, { timeoutMs = 60_000 } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const handler = (e) => {
        const t = e.target === document ? document.scrollingElement : e.target;
        if (!t || !(t instanceof Element)) return;
        if (!log.contains(t)) return;
        if (settled) return;
        settled = true;
        document.removeEventListener("scroll", handler, true);
        resolve(t);
      };
      document.addEventListener("scroll", handler, true);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        document.removeEventListener("scroll", handler, true);
        reject(new Error("Timed out waiting for user scroll. Scroll the chat manually."));
      }, timeoutMs);
      // Clean up timeout on resolve
      const origResolve = resolve;
      resolve = (v) => { clearTimeout(timer); origResolve(v); };
    });
  }

  // ---------- message parsing ----------

  const LABEL_RE = /^At (.+?), ([^:]+): ([\s\S]+)$/;
  const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const DAY_INDEX = Object.fromEntries(DAYS.map((d, i) => [d, i]));

  // FB's time format is e.g. "Wednesday 7:15pm" or "Thursday 10:06pm".
  // We convert it to a rough comparable number so we can sort chronologically
  // within a week. For messages spanning multiple weeks we rely on the
  // relative order they were captured (sort is stable) as a tiebreaker.
  function timeKey(timeStr) {
    // "Wednesday 7:15pm" -> day=Wed, hh=7, mm=15, ampm=pm
    const m = /^(\w+)\s+(\d{1,2}):(\d{2})(am|pm)$/i.exec(timeStr.trim());
    if (!m) return null;
    const day = DAY_INDEX[m[1]];
    if (day === undefined) return null;
    let hour = parseInt(m[2], 10) % 12;
    if (m[4].toLowerCase() === "pm") hour += 12;
    const minute = parseInt(m[3], 10);
    return day * 1440 + hour * 60 + minute;
  }

  function parseLabel(label) {
    const m = LABEL_RE.exec(label);
    if (!m) return null;
    return { time: m[1].trim(), sender: m[2].trim(), body: m[3] };
  }

  function captureMessage(el, store) {
    const label = el.getAttribute("aria-label");
    if (!label) return;
    if (store.messages.has(label)) return;   // dedup on label
    const parsed = parseLabel(label);
    const seq = store.order.length;
    const record = parsed
      ? {
        seq,
        phase: STATE.phase,
        batch: STATE.batch,
        time: parsed.time,
        sender: parsed.sender,
        body: parsed.body,
      }
      : {
        seq,
        phase: STATE.phase,
        batch: STATE.batch,
        raw: label,
        unparsed: true,
      };
    store.messages.set(label, record);
    store.order.push(label);
  }

  function scanDom(store, label = "scan") {
    const found = document.querySelectorAll('[aria-roledescription="message"]');
    const before = store.messages.size;
    for (const el of found) {
      captureMessage(el, store);
    }
    const added = store.messages.size - before;
    console.log(`[fb-harvest] ${label}: ${found.length} in DOM, ${added} new → total ${store.messages.size}`);
    if (found.length > 0) {
      console.log(`[fb-harvest]   DOM first: "${found[0].getAttribute('aria-label')?.slice(0, 80)}"`);
      console.log(`[fb-harvest]   DOM last:  "${found[found.length - 1].getAttribute('aria-label')?.slice(0, 80)}"`);
    }
  }

  function startHarvester(log, { logEvery = 10 } = {}) {
    const store = {
      messages: new Map(),
      order: [],
      startedAt: Date.now(),
      conversation: conversationName(),
      lastLoggedCount: 0,
    };

    // Also observe aria-label attribute changes — if FB "virtualizes" by
    // reusing a div and just swapping its aria-label, we'd miss messages
    // without this.
    const observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        if (mut.type === "attributes" && mut.target instanceof Element) {
          if (mut.target.matches?.('[aria-roledescription="message"]')) {
            captureMessage(mut.target, store);
          }
        }
        for (const node of mut.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches?.('[aria-roledescription="message"]')) {
            captureMessage(node, store);
          }
          const nested = node.querySelectorAll?.('[aria-roledescription="message"]');
          if (nested) for (const el of nested) captureMessage(el, store);
        }
      }
      const n = store.messages.size;
      if (n - store.lastLoggedCount >= logEvery) {
        console.log(`%c[fb-harvest] captured: ${n}`, "color:#0070f6");
        store.lastLoggedCount = n;
      }
    });
    observer.observe(log, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label"],
    });

    setCaptureContext("initial", 0);
    scanDom(store, "initial");   // pick up anything already in DOM
    return { observer, store };
  }

  function orderMessages(store) {
    const all = [...store.messages.values()];
    const parsed = all.filter(m => !m.unparsed);
    const unparsed = all.filter(m => m.unparsed);

    const history = parsed
      .filter(m => m.phase === "top" || m.phase === "top-settle")
      .sort((a, b) => {
        if (a.batch !== b.batch) return b.batch - a.batch;
        const ka = timeKey(a.time);
        const kb = timeKey(b.time);
        if (ka != null && kb != null && ka !== kb) return ka - kb;
        return a.seq - b.seq;
      });

    const recent = parsed
      .filter(m => m.phase !== "top" && m.phase !== "top-settle")
      .sort((a, b) => {
        if (a.batch !== b.batch) return a.batch - b.batch;
        const ka = timeKey(a.time);
        const kb = timeKey(b.time);
        if (ka != null && kb != null && ka !== kb) return ka - kb;
        return a.seq - b.seq;
      });

    return {
      parsed: [...history, ...recent],
      unparsed,
    };
  }

  // ---------- auto-scroll (now on a known scroller) ----------

  async function scrollToBottom(scroller, store, { settlePause = 800, settleChecks = 4, maxSteps = 500, wiggles = 3 } = {}) {
    console.log("[fb-scrape] scrolling to bottom to capture newest messages...");
    // Stop when BOTH scrollHeight stops growing AND no new messages are
    // captured for N consecutive steps. This handles FB loading new messages
    // lazily as we approach the end of currently-rendered content.
    let lastHeight = scroller.scrollHeight;
    let lastCount = store.messages.size;
    let stable = 0;
    let step = 0;
    while (step < maxSteps) {
      if (STATE.aborted) break;
      setCaptureContext("bottom", step);
      scroller.scrollTop = scroller.scrollHeight + 10000;
      await sleep(settlePause);
      const h = scroller.scrollHeight;
      const c = store.messages.size;
      const grew = h > lastHeight;
      const captured = c > lastCount;
      console.log(`[fb-scrape] bottom step=${step} scrollH=${h} top=${scroller.scrollTop} captured=${c}` +
        (grew || captured ? " (progress)" : ` (stable ${stable + 1}/${settleChecks})`));
      if (grew || captured) {
        stable = 0;
        lastHeight = h;
        lastCount = c;
      } else {
        stable++;
        if (stable >= settleChecks) {
          console.log("[fb-scrape] bottom reached");
          break;
        }
      }
      step++;
    }

    // Wiggle: scroll up a chunk, then back to bottom. This forces FB to
    // re-mount messages in the "just above the bottom" region. Some messages
    // live in a narrow render window near the anchor and only mount when
    // the viewport passes over them.
    for (let w = 0; w < wiggles; w++) {
      if (STATE.aborted) break;
      setCaptureContext("bottom", maxSteps + w);
      const before = store.messages.size;
      scroller.scrollTop = Math.max(0, scroller.scrollTop - 600);
      await sleep(500);
      scroller.scrollTop = scroller.scrollHeight + 10000;
      await sleep(700);
      const after = store.messages.size;
      console.log(`[fb-scrape] bottom wiggle ${w}: captured ${after - before} new (total=${after})`);
    }
    await sleep(500);
  }

  async function scrollToTop(scroller, store, { stepPause = 700, settle = 4, maxSteps = 2000 } = {}) {
    console.log("[fb-scrape] scrolling to top to harvest full history...");
    // Same dual signal as scrollToBottom: stop only when BOTH scrollHeight
    // and captured-message-count are stable. This prevents stopping early
    // when FB is slow to prepend a new batch.
    let lastHeight = scroller.scrollHeight;
    let lastCount = store.messages.size;
    let stableCount = 0;
    let step = 0;
    while (step < maxSteps) {
      if (STATE.aborted) { console.log("[fb-scrape] aborted"); break; }
      setCaptureContext("top", step);
      scroller.scrollTop = 0;
      await sleep(stepPause);
      const h = scroller.scrollHeight;
      const c = store.messages.size;
      const grew = h > lastHeight;
      const captured = c > lastCount;
      console.log(`[fb-scrape] top step=${step} scrollH=${h} captured=${c}` +
        (grew ? ` (+${h - lastHeight})` : "") +
        (captured ? ` (+${c - lastCount} msgs)` : "") +
        (!grew && !captured ? ` (stable ${stableCount + 1}/${settle})` : ""));
      if (grew || captured) {
        stableCount = 0;
        lastHeight = h;
        lastCount = c;
      } else {
        stableCount++;
        if (stableCount >= settle) {
          console.log(`[fb-scrape] top reached — scrollH stable at ${h}, captured=${c}`);
          break;
        }
      }
      step++;
    }
  }

  // ---------- main flow ----------

  async function fbExport(options = {}) {
    const {
      bottomOptions = {},
      topOptions = {},
      calibrationTimeoutMs = 60_000,
      copyToClipboard = true,
    } = options;

    if (STATE.running) { console.warn("[fb-scrape] already running. Call fbStop() first."); return; }
    STATE.running = true;
    STATE.aborted = false;

    let harvest;
    try {
      const log = findLog();

      // Phase 0 — user manually goes to the bottom of the chat. Critical:
      // FB only loads the full newest batch when the user actually scrolls
      // to the end (or clicks the "jump to bottom" chevron that FB shows).
      // Programmatic scrolling doesn't always trigger this same "I'm at
      // the end" logic reliably.
      console.log(
        "%c[fb-scrape] Phase 0: scroll MANUALLY to the bottom of the chat (so the newest message is visible),\n" +
        "then scroll the chat once more in ANY direction (even a tiny wiggle) to let me identify the scroll container.",
        "color:#0070f6;font-weight:bold;font-size:13px"
      );
      const scroller = await waitForUserScroll(log, { timeoutMs: calibrationTimeoutMs });
      console.log("[fb-scrape] scroller identified:", scroller,
        `scrollTop=${scroller.scrollTop} scrollH=${scroller.scrollHeight} clientH=${scroller.clientHeight}`);

      // Phase 1 — start harvesting with the newest messages already visible.
      harvest = startHarvester(log);
      STATE.harvest = harvest;
      console.log(`[fb-harvest] armed with initial scan.`);

      // Phase 2 — try to nudge bottom further in case user didn't reach it.
      await scrollToBottom(scroller, harvest.store, bottomOptions);
      await sleep(500);
      setCaptureContext("bottom", Number.MAX_SAFE_INTEGER);
      scanDom(harvest.store, "after-bottom");

      // Phase 3 — scroll to top to load all history.
      await scrollToTop(scroller, harvest.store, topOptions);

      // Final settles: scan at top (oldest messages still mounted), then
      // give FB a moment to finish any pending mutations and scan again.
      await sleep(700);
      setCaptureContext("top-settle", Number.MAX_SAFE_INTEGER - 1);
      scanDom(harvest.store, "at-top");
      await sleep(700);
      setCaptureContext("top-settle", Number.MAX_SAFE_INTEGER);
      scanDom(harvest.store, "final");
    } catch (err) {
      STATE.running = false;
      if (harvest) { harvest.observer.disconnect(); STATE.harvest = null; }
      throw err;
    }

    harvest.observer.disconnect();
    STATE.harvest = null;
    STATE.running = false;

    const store = harvest.store;
    const ordered = orderMessages(store);
    const textMessages = ordered.parsed
      .map(({ time, sender, body }) => ({ time, sender, body }));
    const unparsed = ordered.unparsed
      .map(({ raw }) => ({ raw }));

    const result = {
      conversation: store.conversation,
      capturedAt: new Date().toISOString(),
      durationMs: Date.now() - store.startedAt,
      messageCount: textMessages.length,
      unparsedCount: unparsed.length,
      messages: textMessages,
      unparsed,
    };

    if (copyToClipboard) {
      try {
        await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
        console.log(
          `%c[fb-scrape] done. ${result.messageCount} messages copied to clipboard (+${result.unparsedCount} unparsed).`,
          "color:#0070f6;font-weight:bold;font-size:13px"
        );
      } catch (err) {
        console.warn("[fb-scrape] clipboard write failed:", err.message,
          "— use the returned value.");
      }
    }
    return result;
  }

  function fbStop() {
    STATE.aborted = true;
    if (STATE.harvest) {
      STATE.harvest.observer.disconnect();
      STATE.harvest = null;
    }
  }

  window.fbExport = fbExport;
  window.fbStop = fbStop;

  console.log(
    "%c[fb-scrape] loaded. Run: const data = await fbExport()",
    "color:#0070f6;font-weight:bold"
  );
})();
