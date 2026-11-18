import { useEffect, useState } from "react";
import { Dropzone } from "../components/Dropzone";
import { Alert, Icon, PageHeader, Spinner } from "../components/ui";
import { api, ApiError, templateDownloadUrl, type Template } from "../lib/api";
import { bytes, day, number } from "../lib/format";

export function Templates() {
  const [list, setList] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.templates().then(
      (r) => setList(r.templates),
      (e) => setError(e instanceof ApiError ? e.message : "Failed to load templates."),
    );
  useEffect(() => {
    void load();
  }, []);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      await load();
      if (ok) setNotice(ok);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    }
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    await act(async () => {
      await api.uploadTemplate(file, name.trim() || file.name.replace(/\.xlsx$/i, ""));
      setFile(null);
      setName("");
    }, "Template uploaded and verified.");
    setBusy(false);
  };

  return (
    <div>
      <PageHeader title="Templates" subtitle="The Excel template the export is poured into. The default one is preselected on Convert." />
      <div className="space-y-3">
        {error && <Alert kind="error">{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-5">
        <section className="space-y-3 lg:col-span-3">
          {list === null ? (
            <Spinner className="h-6 w-6 text-slate-400" />
          ) : list.length === 0 ? (
            <div className="card muted p-10 text-center text-sm">No templates yet — upload one to start converting.</div>
          ) : (
            list.map((t) => (
              <article key={t.id} className="card p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-medium">{t.name}</h3>
                      {t.isDefault && (
                        <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-800 dark:bg-teal-900/50 dark:text-teal-300">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="muted mt-0.5 truncate text-xs">
                      {t.fileName} · {bytes(t.size)} · {number(t.formulas)} formulas · added {day(t.createdAt)}
                    </p>
                    <p className="muted mt-1 text-[11px]">Functions: {t.functions.join(", ") || "—"}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {!t.isDefault && (
                      <button type="button" className="btn-secondary px-3 py-1.5" onClick={() => void act(() => api.updateTemplate(t.id, { isDefault: true }))}>
                        Make default
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        const n = prompt("Template name", t.name)?.trim();
                        if (n && n !== t.name) void act(() => api.updateTemplate(t.id, { name: n }));
                      }}
                    >
                      Rename
                    </button>
                    <a className="btn-ghost" href={templateDownloadUrl(t.id)} download aria-label={`Download ${t.name}`}>
                      <Icon.download className="h-4 w-4" />
                    </a>
                    <button
                      type="button"
                      className="btn-danger"
                      aria-label={`Delete ${t.name}`}
                      onClick={() => {
                        if (confirm(`Delete template "${t.name}"? Past conversions are kept.`)) void act(() => api.deleteTemplate(t.id));
                      }}
                    >
                      <Icon.trash className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </section>

        <aside className="card h-fit space-y-4 p-5 lg:col-span-2">
          <h2 className="font-medium">Upload a template</h2>
          <p className="muted text-xs">
            Needs sheets <code>Server</code>, <code>DB</code> (2nd sheet — the CSV comes from it) and <code>Data</code>. Every formula is
            checked on upload; templates using functions the server can't reproduce exactly are rejected.
          </p>
          <Dropzone file={file} onFile={setFile} disabled={busy} hint="Excel Template.xlsx" />
          <div>
            <label htmlFor="tname" className="label">
              Name
            </label>
            <input id="tname" className="input" placeholder={file?.name.replace(/\.xlsx$/i, "") ?? "e.g. Template 2026"} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <button type="button" className="btn-primary w-full" disabled={!file || busy} onClick={() => void upload()}>
            {busy && <Spinner />} {busy ? "Verifying…" : "Upload"}
          </button>
        </aside>
      </div>
    </div>
  );
}
