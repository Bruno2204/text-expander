/**
 * Text Expander — Content Script
 * 
 * Injected into every page. Detects when the user types a shortcut
 * followed by a trigger key (Space/Tab) and replaces the shortcut
 * with its expanded text.
 * 
 * Supports:
 *  - Standard <input> and <textarea> elements
 *  - contenteditable elements (used by Respond, WhatsApp Web, etc.)
 *  - Dynamically loaded elements (SPA / MutationObserver)
 *  - Multi-line expansions with proper line breaks
 */

(function () {
  'use strict';

  // ─── State ─────────────────────────────────────────────────────
  let shortcuts = {};

  // ─── Load Shortcuts ────────────────────────────────────────────
  function loadShortcuts() {
    try {
      chrome.storage.local.get('shortcuts', (data) => {
        if (chrome.runtime.lastError) {
          console.warn('[Text Expander] Storage read error:', chrome.runtime.lastError);
          return;
        }
        if (data.shortcuts) {
          shortcuts = data.shortcuts;
        }
      });
    } catch (e) {
      // Extension context may be invalidated on update
      console.warn('[Text Expander] Could not load shortcuts:', e);
    }
  }

  // Initial load
  loadShortcuts();

  // Keep shortcuts in sync when they change (from popup edits)
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.shortcuts) {
        shortcuts = changes.shortcuts.newValue || {};
      }
    });
  } catch (e) {
    // Ignore if context is invalidated
  }

  // ─── Input / Textarea helpers ──────────────────────────────────

  /**
   * Extract the word immediately before the cursor in an input/textarea.
   */
  function getWordBeforeCursorInput(el) {
    const pos = el.selectionStart;
    const text = el.value.substring(0, pos);
    const match = text.match(/(\S+)$/);
    if (!match) return null;
    return {
      word: match[1],
      start: pos - match[1].length,
      end: pos,
    };
  }

  /**
   * Replace the shortcut text in an input/textarea and fire
   * synthetic events so frameworks (React, Vue, etc.) pick it up.
   */
  function replaceInInput(el, wordInfo, expansion) {
    const before = el.value.substring(0, wordInfo.start);
    const after = el.value.substring(wordInfo.end);
    
    // Use native input setter to bypass React's synthetic value tracking
    let nativeInputValueSetter;
    if (el.tagName === 'TEXTAREA') {
      nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    } else {
      nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    }

    const newValue = before + expansion + after;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, newValue);
    } else {
      el.value = newValue;
    }

    // Position cursor at the end of the expansion
    const newPos = wordInfo.start + expansion.length;
    el.selectionStart = newPos;
    el.selectionEnd = newPos;

    // Dispatch events for framework compatibility
    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  }

  // ─── ContentEditable helpers ───────────────────────────────────

  /**
   * Extract the word immediately before the cursor in a
   * contenteditable element. Walks through text nodes.
   */
  function getWordBeforeCursorCE() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;

    const range = sel.getRangeAt(0);
    if (!range.collapsed) return null;

    let node = range.startContainer;
    let offset = range.startOffset;

    // If we're inside an element node (not a text node), try to
    // find the preceding text node.
    if (node.nodeType !== Node.TEXT_NODE) {
      if (offset > 0 && node.childNodes[offset - 1]) {
        node = node.childNodes[offset - 1];
        // Walk to the deepest last child text node
        while (node.lastChild) node = node.lastChild;
        if (node.nodeType === Node.TEXT_NODE) {
          offset = node.textContent.length;
        } else {
          return null;
        }
      } else {
        return null;
      }
    }

    const text = node.textContent.substring(0, offset);
    const match = text.match(/(\S+)$/);
    if (!match) return null;

    return {
      word: match[1],
      node,
      start: offset - match[1].length,
      end: offset,
    };
  }

  /**
   * Replace the shortcut text inside a contenteditable element.
   * Uses document.execCommand for maximum framework compatibility
   * (React, Vue, Angular all react to execCommand edits).
   */
  function replaceInContentEditable(editableEl, wordInfo, expansion) {
    const sel = window.getSelection();
    if (!sel) return;

    // 1. Select the shortcut text
    const range = document.createRange();
    range.setStart(wordInfo.node, wordInfo.start);
    range.setEnd(wordInfo.node, wordInfo.end);
    sel.removeAllRanges();
    sel.addRange(range);

    // 2. Insert the expansion (handles React/framework state sync)
    if (expansion.includes('\n')) {
      const lines = expansion.split('\n');
      lines.forEach((line, index) => {
        if (index > 0) {
          // Simulate Shift+Enter for newlines
          document.execCommand('insertLineBreak');
        }
        if (line) {
          document.execCommand('insertText', false, line);
        }
      });
    } else {
      document.execCommand('insertText', false, expansion);
    }

    // 3. Dispatch additional events for frameworks that don't
    //    listen to execCommand natively
    editableEl.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: false,
      inputType: 'insertText',
      data: expansion,
    }));
  }

  // ─── Visual Feedback ──────────────────────────────────────────

  /**
   * Brief purple glow on the element to confirm expansion.
   */
  function flashFeedback(el) {
    const prev = {
      outline: el.style.outline,
      transition: el.style.transition,
    };
    el.style.transition = 'outline-color 0.3s ease';
    el.style.outline = '2px solid rgba(124, 77, 255, 0.6)';

    setTimeout(() => {
      el.style.outline = '2px solid transparent';
      setTimeout(() => {
        el.style.outline = prev.outline;
        el.style.transition = prev.transition;
      }, 300);
    }, 400);
  }

  // ─── Resolve the editable ancestor ────────────────────────────

  function getEditableAncestor(el) {
    if (!el) return null;
    if (el.isContentEditable) return el;
    const parent = el.closest?.('[contenteditable="true"]');
    return parent || null;
  }

  // ─── Main Key Handler ─────────────────────────────────────────

  function handleInput(event) {
    if (!event.isTrusted) return; // Ignore synthetic events to prevent infinite loops

    // Skip if no shortcuts loaded
    if (!Object.keys(shortcuts).length) return;

    const active = document.activeElement;
    if (!active) return;

    let wordInfo = null;
    let isContentEditable = false;
    let targetEl = null;

    // ── Standard inputs ──
    if (active.tagName === 'INPUT' && active.type !== 'password' || active.tagName === 'TEXTAREA') {
      wordInfo = getWordBeforeCursorInput(active);
      targetEl = active;
    }
    // ── ContentEditable (Respond, WhatsApp Web, etc.) ──
    else {
      const editable = getEditableAncestor(active);
      if (editable) {
        wordInfo = getWordBeforeCursorCE();
        isContentEditable = true;
        targetEl = editable;
      }
    }

    if (!wordInfo) return;

    // Look up the expansion
    const expansion = shortcuts[wordInfo.word];
    if (!expansion) return;

    // ── Expand! ──────────────────────────────────────────────────
    if (isContentEditable) {
      replaceInContentEditable(targetEl, wordInfo, expansion);
    } else {
      replaceInInput(targetEl, wordInfo, expansion);
    }

    flashFeedback(targetEl);
  }

  // ─── Attach Listener ──────────────────────────────────────────

  // Use capture phase so we fire before the page's own handlers
  document.addEventListener('input', handleInput, true);

  // ─── MutationObserver for dynamic content (SPA) ───────────────

  // Watch for new iframes being added (e.g., embedded chat widgets)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.tagName === 'IFRAME') {
          try {
            const doc = node.contentDocument;
            if (doc) {
              doc.addEventListener('input', handleInput, true);
            }
          } catch (_) {
            // Cross-origin — content script handles via all_frames: true
          }
        }
      }
    }
  });

  const root = document.body || document.documentElement;
  if (root) {
    observer.observe(root, { childList: true, subtree: true });
  }

})();
