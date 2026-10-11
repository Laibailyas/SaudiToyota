const loginScreen = document.getElementById("login-screen");
const editorScreen = document.getElementById("editor-screen");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const pageSelect = document.getElementById("page-select");
const preview = document.getElementById("page-preview");
const saveButton = document.getElementById("save-page");
const selectionEmpty = document.getElementById("selection-empty");
const sectionEditor = document.getElementById("section-editor");
const sectionTitle = document.getElementById("section-title");
const sectionFields = document.getElementById("section-fields");
const logoutButton = document.getElementById("logout");
const status = document.getElementById("editor-status");

let pages = [];
let dirty = false;
let selectionIds = new Set();
let savedPagePath = "";

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
  });
  const data = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : null;
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}).`);
  return data;
}

function showStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function showLogin(error = "") {
  loginScreen.hidden = false;
  editorScreen.hidden = true;
  loginError.textContent = error;
}

function showEditor() {
  loginScreen.hidden = true;
  editorScreen.hidden = false;
}

function markDirty(message = "Unsaved changes") {
  dirty = true;
  saveButton.disabled = false;
  showStatus(message);
}

function loadSelectedPage() {
  const page = pages.find((item) => item.path === pageSelect.value);
  if (!page) return;
  dirty = false;
  selectionIds.clear();
  saveButton.disabled = true;
  savedPagePath = page.path;
  sectionFields.replaceChildren();
  sectionEditor.hidden = true;
  selectionEmpty.hidden = false;
  showStatus("Select an item to start editing.");
  preview.src = `/api/dashboard/preview?path=${encodeURIComponent(page.path)}`;
}

async function loadDashboard() {
  const session = await request("/api/dashboard/session");
  if (!session.authenticated) {
    showLogin();
    return;
  }
  const result = await request("/api/dashboard/pages");
  pages = result.pages;
  pageSelect.replaceChildren(...pages.map((page) => {
    const option = document.createElement("option");
    option.value = page.path;
    option.textContent = page.title;
    return option;
  }));
  showEditor();
  loadSelectedPage();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const form = new FormData(loginForm);
  try {
    await request("/api/dashboard/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
      }),
    });
    loginForm.reset();
    await loadDashboard();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

pageSelect.addEventListener("change", () => {
  if (dirty && !window.confirm("Discard unsaved changes and open another page?")) {
    pageSelect.value = savedPagePath;
    return;
  }
  loadSelectedPage();
});

preview.addEventListener("load", () => {
  selectionIds.clear();
  sectionEditor.hidden = true;
  sectionFields.replaceChildren();
  selectionEmpty.hidden = false;
  if (dirty) markDirty();
});

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin || event.source !== preview.contentWindow) return;
  if (event.data?.type === "dashboard-section-selection" && Array.isArray(event.data.items)) {
    selectionIds = new Set(event.data.items.map((item) => item.id));
    sectionTitle.textContent = event.data.title || "Section content";
    sectionFields.replaceChildren(...event.data.items.map((item, index) => {
      const field = document.createElement("div");
      field.className = "section-field";
      const label = document.createElement("label");
      label.textContent = item.label || `${item.kind === "image" ? "Image" : "Text"} ${index + 1}`;
      field.append(label);
      if (item.kind === "image") {
        const image = document.createElement("img");
        image.className = "image-preview";
        image.alt = "Selected image preview";
        image.hidden = !item.url;
        if (item.url) image.src = item.url;
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,image/jpeg,image/webp,image/gif";
        input.addEventListener("change", () => uploadImage(input, item.id, image));
        field.append(image, input);
        const hint = document.createElement("p");
        hint.className = "field-hint";
        hint.textContent = "PNG, JPEG, WebP, or GIF; up to 4 MB.";
        field.append(hint);
      } else {
        const textarea = document.createElement("textarea");
        textarea.rows = 4;
        textarea.value = item.text || "";
        textarea.addEventListener("input", () => {
          preview.contentWindow.postMessage({
            type: "dashboard-update-text",
            id: item.id,
            text: textarea.value,
          }, window.location.origin);
          markDirty();
        });
        field.append(textarea);
      }
      return field;
    }));
    selectionEmpty.hidden = true;
    sectionEditor.hidden = false;
    showStatus("Edit this section's text and images, then save the page.");
    return;
  }
  if (event.data?.type === "dashboard-change") markDirty();
});

async function uploadImage(input, selectionId, imagePreview) {
  const file = input.files?.[0];
  input.value = "";
  if (!file || !selectionIds.has(selectionId)) return;
  showStatus("Uploading image...");
  try {
    const result = await request("/api/dashboard/upload", {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    preview.contentWindow.postMessage({
      type: "dashboard-replace-image",
      id: selectionId,
      url: result.url,
    }, window.location.origin);
    imagePreview.src = result.url;
    imagePreview.hidden = false;
    markDirty("Image replaced. Save to publish.");
  } catch (error) {
    showStatus(error.message, true);
  }
}

saveButton.addEventListener("click", async () => {
  saveButton.disabled = true;
  showStatus("Saving changes...");
  try {
    const documentCopy = preview.contentDocument.documentElement.cloneNode(true);
    documentCopy.querySelectorAll("[contenteditable]").forEach((element) => {
      element.removeAttribute("contenteditable");
    });
    documentCopy.querySelectorAll(".dashboard-edit-selected").forEach((element) => {
      element.classList.remove("dashboard-edit-selected");
    });
    documentCopy.querySelector("body")?.classList.remove("dashboard-edit-mode");
    documentCopy.querySelector("#dashboard-edit-style")?.remove();
    documentCopy.querySelectorAll("[data-dashboard-editor]").forEach((element) => element.remove());
    documentCopy.querySelectorAll("[data-dashboard-editor-base]").forEach((element) => element.remove());
    const html = `<!DOCTYPE html>\n${documentCopy.outerHTML}`;
    await request("/api/dashboard/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pageSelect.value, html }),
    });
    dirty = false;
    saveButton.disabled = true;
    showStatus("Saved and published.");
  } catch (error) {
    saveButton.disabled = false;
    showStatus(error.message, true);
  }
});

logoutButton.addEventListener("click", async () => {
  if (dirty && !window.confirm("Log out and discard unsaved changes?")) return;
  try {
    await request("/api/dashboard/logout", { method: "POST" });
    preview.src = "about:blank";
    showLogin();
  } catch (error) {
    showStatus(error.message, true);
  }
});

loadDashboard().catch((error) => showLogin(error.message));
