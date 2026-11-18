import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Dropzone } from "../components/Dropzone";
import { ResultView } from "../components/ResultView";
import { Alert, PageHeader, Spinner, Toggle } from "../components/ui";
import { api, ApiError, type Conversion, type Template } from "../lib/api";

type Phase = "idle" | "uploading" | "processing";

export function Convert() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [useRef_, setUseRef] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ conversion: Conversion; preview: string } | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([api.templates(), api.settings()])
      .then(([t, s]) => {
        setTemplates(t.templates);
        setTemplateId(t.templates.find((x) => x.isDefault)?.id ?? t.templates[0]?.id ?? "");
        setUseRef(s.useReferenceNumber);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load settings."));
  }, []);

  const toggleRef = async (v: boolean) => {
    setUseRef(v);
    try {
      await api.saveSettings({ useReferenceNumber: v });
    } catch {
      setUseRef(!v);
    }
  };

  const run = async () => {
    if (!file || !templateId) return;
    setError(null);
    setResult(null);
    setPhase("uploading");
    // The request is a single round-trip; switch the label once the upload has had time to finish.
    const t = setTimeout(() => setPhase("processing"), Math.min(4000, 400 + file.size / 2000));
    try {
      const r = await api.convert(file, templateId, useRef_);
      setResult(r);
      setFile(null);
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Conversion failed.");
    } finally {
      clearTimeout(t);
      setPhase("idle");
    }
  };

  const busy = phase !== "idle";
  const noTemplates = templates !== null && templates.length === 0;

  return (
    <div>
      <PageHeader title="Convert" subtitle="Turn the monthly sales export into an e-Faktur CSV ready for upload." />

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="card space-y-5 p-5 lg:col-span-3">
          <div>
            <div className="label">Sales export</div>
            <Dropzone file={file} onFile={setFile} disabled={busy} hint="e.g. KK PPN 2610(CT).xlsx — the active sheet is used" />
          </div>

          {error && <Alert kind="error">{error}</Alert>}

          <button type="button" className="btn-primary w-full py-2.5" disabled={!file || !templateId || busy} onClick={() => void run()}>
            {busy ? (
              <>
                <Spinner /> {phase === "uploading" ? "Uploading…" : "Calculating…"}
              </>
            ) : (
              "Convert to CSV"
            )}
          </button>
        </section>

        <aside className="card space-y-5 p-5 lg:col-span-2">
          <div>
            <label htmlFor="template" className="label">
              Template
            </label>
            {templates === null ? (
              <div className="input muted flex items-center gap-2">
                <Spinner /> Loading…
              </div>
            ) : noTemplates ? (
              <Alert kind="info">
                No templates yet.{" "}
                <Link to="/templates" className="font-medium text-teal-700 underline dark:text-teal-400">
                  Upload one
                </Link>{" "}
                to get started.
              </Alert>
            ) : (
              <select id="template" className="input" value={templateId} disabled={busy} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
          <Toggle
            label="Use reference number"
            description="Adds the invoice number to the REFERENSI column."
            checked={useRef_}
            onChange={(v) => void toggleRef(v)}
            disabled={busy}
          />
        </aside>
      </div>

      {result && (
        <section ref={resultRef} className="card mt-6 scroll-mt-20 p-5">
          <ResultView conversion={result.conversion} preview={result.preview} />
        </section>
      )}
    </div>
  );
}
