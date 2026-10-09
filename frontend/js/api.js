const FICA = {
  SUPABASE_URL: "https://gxozeepbzvyneaacibfu.supabase.co",
  SUPABASE_KEY: "sb_publishable__sTa9YTfukZUx0xCTmNk-Q_yAHePe5D", // publishable key: safe in the browser
  API_URL: "http://127.0.0.1:8001",
  LOGIN_PAGE: "../login/login.html",
  HOME_PAGE: "../dashboard/dashboard.html",
};

const fica = window.supabase.createClient(FICA.SUPABASE_URL, FICA.SUPABASE_KEY);

async function requireLogin() {
  const { data } = await fica.auth.getSession();
  if (!data.session) {
    window.location.href = FICA.LOGIN_PAGE;
    return null;
  }
  return data.session;
}

async function signIn(email, password) {
  const { data, error } = await fica.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw new Error(error.message);
  return data.session;
}

async function signOut() {
  await fica.auth.signOut();
  window.location.href = FICA.LOGIN_PAGE;
}

// Call once at the top of every page except login: guards the page and wires the header Logout button.
async function initPage() {
  const session = await requireLogin();
  if (!session) return null;
  document.querySelectorAll(".logout-btn").forEach((btn) => {
    if (btn.hasAttribute("onclick")) return; // the logout page has its own popup
    btn.addEventListener("click", () => {
      window.location.href = "../logout/logout.html";
    });
  });
  return session;
}

function errorText(body, status) {
  const d = body && body.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d
      .map((e) => (e.loc ? e.loc.slice(1).join(".") + ": " : "") + e.msg)
      .join("; ");
  }
  return "Request failed (" + status + ")";
}

// api("/students?page=1") or api("/requests", { method: "POST", body: {...} })
async function api(path, options = {}) {
  const { data } = await fica.auth.getSession();
  if (!data.session) {
    window.location.href = FICA.LOGIN_PAGE;
    throw new Error("Not signed in");
  }
  const headers = { Authorization: "Bearer " + data.session.access_token };
  if (options.body) headers["Content-Type"] = "application/json";
  const res = await fetch(FICA.API_URL + path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    /* empty or non-JSON response */
  }
  if (res.status === 401) {
    window.location.href = FICA.LOGIN_PAGE;
    throw new Error("Session expired. Please log in again.");
  }
  if (!res.ok) throw new Error(errorText(body, res.status));
  return body;
}

// Use when putting database text into innerHTML, so names like <b> can't break the page.
function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
