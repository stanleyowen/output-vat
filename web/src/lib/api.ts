export interface Template {
  id: string;
  name: string;
  fileName: string;
  size: number;
  formulas: number;
  functions: string[];
  isDefault: boolean;
  createdAt: number;
}

export interface Conversion {
  id: string;
  inputName: string;
  outputName: string;
  templateId: string | null;
  templateName: string;
  useReferenceNumber: boolean;
  rowsCopied: number;
  invoices: number;
  lineItems: number;
  totalDpp: number;
  totalPpn: number;
  csvRows: number;
  durationMs: number;
  createdAt: number;
}

export interface Me {
  user: { email: string };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: { accept: "application/json" } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(path, { ...init, redirect: "manual" });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  // Cloudflare Access answers an expired session with a redirect to its login page,
  // which fetch can't follow; reload so the browser goes through the Access login.
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    window.location.reload();
    throw new ApiError(0, "Your session expired. Reloading…");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const d = data as { error?: string; code?: string } | null;
    const msg =
      d?.error ??
      (res.status === 403 || res.status === 404
        ? "Access denied. Your Cloudflare sign-in may have expired — reload the page."
        : `Request failed (${res.status}).`);
    throw new ApiError(res.status, msg, d?.code);
  }
  return data as T;
}

export const api = {
  me: () => request<Me>("GET", "/api/auth/me"),

  settings: () => request<{ useReferenceNumber: boolean }>("GET", "/api/settings"),
  saveSettings: (s: { useReferenceNumber: boolean }) => request<{ useReferenceNumber: boolean }>("PUT", "/api/settings", s),

  templates: () => request<{ templates: Template[] }>("GET", "/api/templates"),
  uploadTemplate: (file: File, name: string) => {
    const fd = new FormData();
    fd.append("name", name);
    fd.append("file", file);
    return request<{ template: Template }>("POST", "/api/templates", fd);
  },
  updateTemplate: (id: string, patch: { name?: string; isDefault?: true }) =>
    request<{ template: Template }>("PATCH", `/api/templates/${id}`, patch),
  deleteTemplate: (id: string) => request<{ ok: true }>("DELETE", `/api/templates/${id}`),

  conversions: (before?: number) =>
    request<{ conversions: Conversion[] }>("GET", `/api/conversions?limit=50${before ? `&before=${before}` : ""}`),
  conversion: (id: string) => request<{ conversion: Conversion; preview: string }>("GET", `/api/conversions/${id}`),
  convert: (file: File, templateId: string, useReferenceNumber: boolean) => {
    // Order matters: fields before the file so the server sees them while streaming.
    const fd = new FormData();
    fd.append("templateId", templateId);
    fd.append("useReferenceNumber", String(useReferenceNumber));
    fd.append("file", file);
    return request<{ conversion: Conversion; preview: string }>("POST", "/api/conversions", fd);
  },
  deleteConversion: (id: string) => request<{ ok: true }>("DELETE", `/api/conversions/${id}`),
};

export const downloadUrl = (id: string, part: "csv" | "xlsx" | "input") => `/api/conversions/${id}/${part}`;
export const templateDownloadUrl = (id: string) => `/api/templates/${id}/download`;
