const loginScreen = document.getElementById("login-screen");
const editorScreen = document.getElementById("editor-screen");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const pageSelect = document.getElementById("page-select");
const preview = document.getElementById("page-preview");
const saveButton = document.getElementById("save-page");
const imageInput = document.getElementById("image-input");
const imagePreview = document.getElementById("image-preview");
const selectionEmpty = document.getElementById("selection-empty");
const textEditor = document.getElementById("text-editor");
const textValue = document.getElementById("text-value");
const imageEditor = document.getElementById("image-editor");
const logoutButton = document.getElementById("logout");
const status = document.getElementById("editor-status");

let pages = [];
let dirty = false;
let selectedImage = false;
let selectionId = null;
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
  selectedImage = false;
  selectionId = null;
  saveButton.disabled = true;
  savedPagePath = page.path;
  textValue.value = "";
  imageInput.value = "";
  imagePreview.removeAttribute("src");
  imagePreview.hidden = true;
  textEditor.hidden = true;
  imageEditor.hidden = true;
  selectionEmpty.hidden = false;
  showStatus("Select an item to start editing.");
  preview.src = `/${page.path}?editor=1`;
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
  selectedImage = false;
  selectionId = null;
  textEditor.hidden = true;
  imageEditor.hidden = true;
  selectionEmpty.hidden = false;
  imagePreview.hidden = true;
  if (dirty) markDirty();
});

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin || event.source !== preview.contentWindow) return;
  if (event.data?.type === "dashboard-selection") {
    selectedImage = event.data.kind === "image";
    selectionId = event.data.id;
    selectionEmpty.hidden = true;
    textEditor.hidden = selectedImage;
    imageEditor.hidden = !selectedImage;
    if (selectedImage) {
      imagePreview.hidden = !event.data.url;
      if (event.data.url) imagePreview.src = event.data.url;
      showStatus("Choose a replacement image, then save the page.");
    } else {
      textValue.value = event.data.text || "";
      showStatus("Edit the text here. The preview updates as you type.");
      textValue.focus();
    }
    return;
  }
  if (event.data?.type === "dashboard-change") markDirty();
});

textValue.addEventListener("input", () => {
  if (selectedImage || selectionId === null) return;
  preview.contentWindow.postMessage({
    type: "dashboard-update-text",
    id: selectionId,
    text: textValue.value,
  }, window.location.origin);
  markDirty();
});

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  imageInput.value = "";
  if (!file || !selectedImage || selectionId === null) return;
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
    documentCopy.querySelectorAll("[data-dashboard-editor]").forEach((element) => element.remove());
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
