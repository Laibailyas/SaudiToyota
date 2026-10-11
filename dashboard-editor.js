(function () {
  if (window.parent === window) return;

  const textSelector = "h1,h2,h3,h4,h5,h6,p,li,a,button,label,strong,em,small,b,figcaption,blockquote,.sched .row .ev,.sched .row .dt,.sched .row .ty";
  const selectedClass = "dashboard-edit-selected";
  const editorStyle = document.createElement("style");
  editorStyle.id = "dashboard-edit-style";
  editorStyle.textContent = [
    `body.dashboard-edit-mode .${selectedClass}{outline:3px solid #f4bc39!important;outline-offset:3px}`,
  ].join("");
  document.head.appendChild(editorStyle);
  document.body.classList.add("dashboard-edit-mode");

  let selectedGroup = null;
  let nextSelectionId = 0;
  const editControls = [];
  const elementIds = new Map();

  function getElementId(element) {
    if (!elementIds.has(element)) elementIds.set(element, ++nextSelectionId);
    return elementIds.get(element);
  }

  function backgroundUrl(element) {
    const match = getComputedStyle(element).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
    if (!match) return "";
    try {
      return new URL(match[1], document.baseURI).href;
    } catch {
      return "";
    }
  }

  function textElementsIn(container) {
    return [...container.querySelectorAll(textSelector)].filter((element) => (
      element.innerText.trim()
      && !element.closest("[data-dashboard-editor],nav,header,footer")
      && !element.parentElement?.closest(textSelector)
    ));
  }

  function imageElementsIn(container) {
    const images = [...container.querySelectorAll("img")].filter((element) => (
      !element.closest("nav,header,footer") || element.matches("nav img.logo")
    ));
    const backgrounds = [container, ...container.querySelectorAll("*")].filter((element) => (
      !(element instanceof HTMLImageElement)
      && !element.closest("nav,header,footer")
      && getComputedStyle(element).backgroundImage.includes("url(")
    ));
    return [...new Set([...images, ...backgrounds])];
  }

  function reportSelection(group) {
    if (selectedGroup) selectedGroup.container.classList.remove(selectedClass);
    selectedGroup = group;
    group.container.classList.add(selectedClass);
    window.parent.postMessage({
      type: "dashboard-section-selection",
      title: group.title,
      items: group.items.map(({ element, kind }) => ({
        id: getElementId(element),
        kind,
        text: kind === "text" ? element.innerText.trim() : "",
        url: kind === "image"
          ? (element instanceof HTMLImageElement ? element.currentSrc || element.src : backgroundUrl(element))
          : "",
        label: kind === "text"
          ? `${element.tagName.toLowerCase()}: ${element.innerText.trim().replace(/\s+/g, " ").slice(0, 48)}`
          : `${element instanceof HTMLImageElement ? "Image" : "Background image"}: ${
            element instanceof HTMLImageElement
              ? element.alt || element.title || element.className || "Page image"
              : element.getAttribute("aria-label") || element.title || element.className || "Page background"
          }`,
      })),
    }, window.location.origin);
  }

  function makeEditControl(group) {
    const control = document.createElement("button");
    control.type = "button";
    control.setAttribute("data-dashboard-editor", "");
    control.setAttribute("aria-label", `Edit ${group.title}`);
    control.title = `Edit ${group.title}`;
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
    control.style.setProperty("cursor", "default", "important");
    control.style.setProperty("pointer-events", "auto", "important");
    control.style.setProperty("align-items", "center", "important");
    control.style.setProperty("justify-items", "center", "important");
    control.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:16px;height:16px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>';
    control.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      reportSelection(group);
    });
    document.documentElement.appendChild(control);
    editControls.push({ element: group.container, control });
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

  const groupSelector = "section,[role='region'],article";
  let containers = [...document.querySelectorAll(groupSelector)].filter((element) => (
    !element.parentElement?.closest(groupSelector)
    && !element.closest("[data-dashboard-editor]")
  ));
  if (containers.length === 0) {
    const main = document.querySelector("main");
    containers = main
      ? [main]
      : [...document.body.children].filter((element) => !element.matches("script,style,noscript"));
  }

  const groups = containers.map((container, index) => {
    const textItems = textElementsIn(container).map((element) => ({ element, kind: "text" }));
    const imageItems = imageElementsIn(container).map((element) => ({ element, kind: "image" }));
    return {
      container,
      title: container.getAttribute("aria-label")
        || container.querySelector("h1,h2,h3,h4")?.innerText.trim()
        || `${container.tagName.toLowerCase()} ${index + 1}`,
      items: [...textItems, ...imageItems],
    };
  }).filter((group) => group.items.length > 0);

  groups.forEach(makeEditControl);

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
    const selectedItem = selectedGroup?.items.find(({ element }) => getElementId(element) === message.id);
    if (!selectedItem) return;

    if (message.type === "dashboard-update-text" && selectedItem.kind === "text" && typeof message.text === "string") {
      replaceText(selectedItem.element, message.text);
      window.parent.postMessage({ type: "dashboard-change" }, window.location.origin);
      updateControlPositions();
      return;
    }

    if (message.type !== "dashboard-replace-image" || selectedItem.kind !== "image" || typeof message.url !== "string") return;
    if (selectedItem.element instanceof HTMLImageElement) {
      selectedItem.element.src = message.url;
    } else {
      const previousBackground = getComputedStyle(selectedItem.element).backgroundImage;
      selectedItem.element.style.backgroundImage = `url("${message.url}"), ${previousBackground}`;
    }
    window.parent.postMessage({ type: "dashboard-change" }, window.location.origin);
    updateControlPositions();
  });
})();
