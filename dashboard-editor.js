(function () {
  if (window.parent === window) return;

  const textSelector = "h1,h2,h3,h4,h5,h6,p,li,a,button,label,strong,em,small,b,figcaption,blockquote";
  const selectedClass = "dashboard-edit-selected";
  const editorStyle = document.createElement("style");
  editorStyle.id = "dashboard-edit-style";
  editorStyle.textContent = [
    `body.dashboard-edit-mode .${selectedClass}{outline:3px solid #f4bc39!important;outline-offset:3px}`,
  ].join("");
  document.head.appendChild(editorStyle);
  document.body.classList.add("dashboard-edit-mode");

  let selectedElement = null;
  let selectedKind = "";
  let nextSelectionId = 0;
  const selectionIds = new WeakMap();
  const editControls = [];

  function getSelectionId(element) {
    if (!selectionIds.has(element)) selectionIds.set(element, ++nextSelectionId);
    return selectionIds.get(element);
  }

  function backgroundUrl(element) {
    const match = getComputedStyle(element).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
    if (!match) return "";
    try {
      return new URL(match[1], window.location.href).href;
    } catch {
      return "";
    }
  }

  function reportSelection(element, kind) {
    if (selectedElement) selectedElement.classList.remove(selectedClass);
    selectedElement = element;
    selectedKind = kind;
    element.classList.add(selectedClass);
    window.parent.postMessage({
      type: "dashboard-selection",
      id: getSelectionId(element),
      kind,
      text: kind === "text" ? element.innerText.trim() : "",
      url: kind === "image"
        ? (element instanceof HTMLImageElement ? element.currentSrc || element.src : backgroundUrl(element))
        : "",
    }, window.location.origin);
  }

  function makeEditControl(element, kind) {
    const control = document.createElement("button");
    control.type = "button";
    control.setAttribute("data-dashboard-editor", "");
    control.setAttribute("aria-label", kind === "image" ? "Edit image" : `Edit text: ${element.innerText.trim().slice(0, 80)}`);
    control.title = kind === "image" ? "Edit image" : "Edit text";
    control.style.setProperty("position", "fixed", "important");
    control.style.setProperty("z-index", "2147483647", "important");
    control.style.setProperty("display", "none", "important");
    control.style.setProperty("width", "32px", "important");
    control.style.setProperty("height", "32px", "important");
    control.style.setProperty("min-width", "32px", "important");
    control.style.setProperty("min-height", "32px", "important");
    control.style.setProperty("padding", "0", "important");
    control.style.setProperty("border", "0", "important");
    control.style.setProperty("border-radius", "50%", "important");
    control.style.setProperty("background", "#e8202e", "important");
    control.style.setProperty("box-shadow", "0 2px 8px #0008", "important");
    control.style.setProperty("cursor", "pointer", "important");
    control.style.setProperty("pointer-events", "auto", "important");
    control.style.setProperty("align-items", "center", "important");
    control.style.setProperty("justify-items", "center", "important");
    control.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:16px;height:16px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>';
    control.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      reportSelection(element, kind);
    });
    document.documentElement.appendChild(control);
    editControls.push({ element, control });
  }

  function updateControlPositions() {
    for (const { element, control } of editControls) {
      const rect = element.getBoundingClientRect();
      const visible = rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.right > 0
        && rect.top < window.innerHeight
        && rect.left < window.innerWidth;
      if (!visible) {
        control.style.setProperty("display", "none", "important");
        continue;
      }
      const left = Math.max(4, Math.min(window.innerWidth - 36, rect.right - 18));
      const top = Math.max(4, Math.min(window.innerHeight - 36, rect.top - 16));
      control.style.setProperty("left", `${left}px`, "important");
      control.style.setProperty("top", `${top}px`, "important");
      control.style.setProperty("display", "grid", "important");
    }
  }

  const textElements = [...document.querySelectorAll(textSelector)].filter((element) => (
    element.innerText.trim() && !element.closest("[data-dashboard-editor]")
  ));
  const imageElements = [...document.querySelectorAll("img")];
  const backgroundElements = [...document.querySelectorAll("body *")].filter((element) => (
    !(element instanceof HTMLImageElement)
    && getComputedStyle(element).backgroundImage.includes("url(")
  ));

  textElements.forEach((element) => makeEditControl(element, "text"));
  [...new Set([...imageElements, ...backgroundElements])].forEach((element) => makeEditControl(element, "image"));

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest("[data-dashboard-editor]")) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  window.addEventListener("scroll", updateControlPositions, true);
  window.addEventListener("resize", updateControlPositions);
  window.addEventListener("load", updateControlPositions);
  updateControlPositions();
  requestAnimationFrame(updateControlPositions);
  window.setTimeout(updateControlPositions, 1500);

  function replaceText(element, value) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    if (nodes.length < 2) {
      if (nodes.length === 1) nodes[0].nodeValue = value;
      else element.textContent = value;
      return;
    }

    const weights = nodes.map((node) => node.nodeValue.length);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let consumedWeight = 0;
    let textStart = 0;
    nodes.forEach((node, index) => {
      consumedWeight += weights[index];
      if (index === nodes.length - 1) {
        node.nodeValue = value.slice(textStart);
        return;
      }
      const target = Math.round(value.length * consumedWeight / totalWeight);
      const before = value.lastIndexOf(" ", target);
      const after = value.indexOf(" ", target);
      const boundary = before <= textStart
        ? (after < 0 ? target : after)
        : after < 0 || target - before <= after - target
          ? before + 1
          : after + 1;
      node.nodeValue = value.slice(textStart, boundary);
      textStart = boundary;
    });
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    const message = event.data;
    if (!selectedElement || message.id !== getSelectionId(selectedElement)) return;

    if (message.type === "dashboard-update-text" && selectedKind === "text" && typeof message.text === "string") {
      replaceText(selectedElement, message.text);
      window.parent.postMessage({ type: "dashboard-change" }, window.location.origin);
      updateControlPositions();
      return;
    }

    if (message.type !== "dashboard-replace-image" || selectedKind !== "image" || typeof message.url !== "string") return;
    if (selectedElement instanceof HTMLImageElement) {
      selectedElement.src = message.url;
    } else {
      const previousBackground = getComputedStyle(selectedElement).backgroundImage;
      selectedElement.style.backgroundImage = `url("${message.url}"), ${previousBackground}`;
    }
    window.parent.postMessage({ type: "dashboard-change" }, window.location.origin);
    updateControlPositions();
  });
})();
