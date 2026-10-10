const loginScreen = document.getElementById("login-screen");
const editorScreen = document.getElementById("editor-screen");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const pageSelect = document.getElementById("page-select");
const pageSelectLabel = document.querySelector(".page-select-label");
const preview = document.getElementById("page-preview");
const saveButton = document.getElementById("save-page");
const replaceButton = document.getElementById("replace-image");
const imageInput = document.getElementById("image-input");
const logoutButton = document.getElementById("logout");
const status = document.getElementById("editor-status");

let pages = [];
let dirty = false;
let selectedImage = false;
let selectionId = null;
let savedSource = "";

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
  selectedImage = false;
  selectionId = null;
  saveButton.disabled = true;
  replaceButton.disabled = true;
  showStatus("");
  savedSource = `${page.path}?editor=1`;
  preview.src = savedSource;
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
  pageSelectLabel.title = "Click text in the preview to edit it. Select an image to replace it.";
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
    pageSelect.value = pages.find((page) => `${page.path}?editor=1` === savedSource)?.path || pageSelect.value;
    return;
  }
  loadSelectedPage();
});

preview.addEventListener("load", () => {
  selectedImage = false;
  selectionId = null;
  replaceButton.disabled = true;
  if (dirty) markDirty();
});

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin || event.source !== preview.contentWindow) return;
  if (event.data?.type === "dashboard-selection") {
    selectedImage = event.data.kind === "image";
    selectionId = event.data.id;
    replaceButton.disabled = !selectedImage;
    showStatus(selectedImage ? "Image selected" : "Text selected");
    return;
  }
  if (event.data?.type === "dashboard-change") markDirty();
});

replaceButton.addEventListener("click", () => imageInput.click());

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  imageInput.value = "";
  if (!file || !selectedImage || selectionId === null) return;
  replaceButton.disabled = true;
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
    markDirty("Image replaced. Save to publish.");
  } catch (error) {
    showStatus(error.message, true);
    replaceButton.disabled = false;
  }
});

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
    documentCopy.querySelector("[data-dashboard-editor]")?.remove();
    const html = `<!DOCTYPE html>\n${documentCopy.outerHTML}`;
    await request("/api/dashboard/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pageSelect.value, html }),
    });
    dirty = false;
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
