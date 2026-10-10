(function () {
  if (window.parent === window) return;

  const textSelector = "h1,h2,h3,h4,h5,h6,p,li,a,button,label,strong,em,small,b,figcaption,blockquote";
  const editorStyle = document.createElement("style");
  editorStyle.id = "dashboard-edit-style";
  editorStyle.textContent = [
    "body.dashboard-edit-mode [contenteditable=true]{outline:2px dashed #ef4652!important;outline-offset:3px;cursor:text!important}",
    "body.dashboard-edit-mode .dashboard-edit-selected{outline:3px solid #f4bc39!important;outline-offset:3px;cursor:pointer!important}",
    "body.dashboard-edit-mode img,body.dashboard-edit-mode [style*='background-image']{cursor:pointer}",
  ].join("");
  document.head.appendChild(editorStyle);
  document.body.classList.add("dashboard-edit-mode");

  let selectedElement = null;
  let selectedKind = "";
  let nextSelectionId = 0;
  const selectionIds = new WeakMap();

  function getSelectionId(element) {
    if (!selectionIds.has(element)) selectionIds.set(element, ++nextSelectionId);
    return selectionIds.get(element);
  }

  function reportSelection(element, kind) {
    if (selectedElement) selectedElement.classList.remove("dashboard-edit-selected");
    selectedElement = element;
    selectedKind = kind;
    element.classList.add("dashboard-edit-selected");
    window.parent.postMessage({
      type: "dashboard-selection",
      id: getSelectionId(element),
      kind,
    }, window.location.origin);
  }

  function textAtPoint(x, y) {
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y);
      return range && range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : null;
    }
    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(x, y);
      return position && position.offsetNode.nodeType === Node.TEXT_NODE
        ? position.offsetNode.parentElement
        : null;
    }
    return null;
  }

  function backgroundAt(target) {
    for (let element = target; element && element !== document.body; element = element.parentElement) {
      if (getComputedStyle(element).backgroundImage.includes("url(")) return element;
    }
    return null;
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest("[data-dashboard-editor]")) return;

    const image = target.closest("img");
    if (image) {
      event.preventDefault();
      event.stopPropagation();
      reportSelection(image, "image");
      return;
    }

    const background = backgroundAt(target);
    if (background) {
      event.preventDefault();
      event.stopPropagation();
      reportSelection(background, "image");
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const textElement = target.closest(textSelector) || textAtPoint(event.clientX, event.clientY);
    if (!textElement || !document.body.contains(textElement)) return;
    reportSelection(textElement, "text");
    textElement.contentEditable = "true";
    textElement.focus();
    const range = document.createRange();
    range.selectNodeContents(textElement);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, true);

  document.addEventListener("input", (event) => {
    if (event.target instanceof Element && event.target.isContentEditable) {
      window.parent.postMessage({ type: "dashboard-change" }, window.location.origin);
    }
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    const message = event.data;
    if (message?.type !== "dashboard-replace-image" || !selectedElement || selectedKind !== "image") return;
    if (message.id !== getSelectionId(selectedElement) || typeof message.url !== "string") return;
    if (selectedElement instanceof HTMLImageElement) {
      selectedElement.src = message.url;
    } else {
      const previousBackground = getComputedStyle(selectedElement).backgroundImage;
      selectedElement.style.backgroundImage = `url("${message.url}"), ${previousBackground}`;
    }
    window.parent.postMessage({ type: "dashboard-change" }, window.location.origin);
  });
})();
