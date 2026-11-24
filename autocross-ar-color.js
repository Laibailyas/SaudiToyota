/* Arabic Autocross text-only color treatment. No translations or assets changed. */
(function () {
  'use strict';
  const GREEN = '#00884b';
  const NAME = /(?:الأوتوكروس|اوتوكروس)/g;
  const css = document.createElement('style');
  css.textContent = '.autocross-ar-green{color:' + GREEN + ' !important;}';
  document.head.appendChild(css);
  let running = false;
  let scheduled = false;
  function paint() {
    if (running) return;
    running = true;
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || !NAME.test(node.nodeValue)) { NAME.lastIndex = 0; return NodeFilter.FILTER_REJECT; }
          NAME.lastIndex = 0;
          if (parent.closest('script,style,noscript,textarea,option,svg,.autocross-ar-green,[contenteditable="true"]')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const text = node.nodeValue;
        const fragment = document.createDocumentFragment();
        let previous = 0;
        for (const match of text.matchAll(NAME)) {
          if (match.index > previous) fragment.appendChild(document.createTextNode(text.slice(previous, match.index)));
          const span = document.createElement('span');
          span.className = 'autocross-ar-green';
          span.textContent = match[0];
          fragment.appendChild(span);
          previous = match.index + match[0].length;
        }
        if (previous < text.length) fragment.appendChild(document.createTextNode(text.slice(previous)));
        node.replaceWith(fragment);
      }
    } finally { running = false; }
  }
  function schedule() {
    if (scheduled || running) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; paint(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
  new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
})();
