import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ResultView } from "../components/ResultView";
import { Alert, Icon, PageHeader, Spinner } from "../components/ui";
import { api, ApiError, downloadUrl, type Conversion } from "../lib/api";
import { number, relative, rupiah, when } from "../lib/format";

export function History() {
  const [rows, setRows] = useState<Conversion[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = async (before?: number) => {
    try {
      const r = await api.conversions(before);
      setRows((prev) => (before && prev ? [...prev, ...r.conversions] : r.conversions));
      setMore(r.conversions.length === 50);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load history.");
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const remove = async (c: Conversion) => {
    if (!confirm(`Delete "${c.outputName}" and its files? This cannot be undone.`)) return;
    try {
      await api.deleteConversion(c.id);
      setRows((r) => r?.filter((x) => x.id !== c.id) ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed.");
    }
  };

  const filtered = rows?.filter((r) => !q || r.inputName.toLowerCase().includes(q.toLowerCase())) ?? null;

  return (
    <div>
      <PageHeader
        title="History"
        subtitle="Every conversion is kept (encrypted) so you can download it again."
        action={<input className="input w-56" placeholder="Search file name…" value={q} onChange={(e) => setQ(e.target.value)} />}
      />
      {error && <Alert kind="error">{error}</Alert>}
      {filtered === null ? (
        <div className="grid place-items-center py-16">
          <Spinner className="h-6 w-6 text-slate-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card muted p-10 text-center text-sm">{q ? "No matches." : "No conversions yet."}</div>
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                <Link to={`/history/${c.id}`} className="min-w-0 flex-1 basis-60">
                  <div className="truncate font-medium">{c.outputName}</div>
                  <div className="muted text-xs" title={when(c.createdAt)}>
                    {relative(c.createdAt)} · {c.templateName}
                  </div>
                </Link>
                <div className="grid grid-cols-3 gap-4 text-right text-sm tabular-nums">
                  <div>
                    <div className="muted text-[11px] uppercase">Invoices</div>
                    {number(c.invoices)}
                  </div>
                  <div>
                    <div className="muted text-[11px] uppercase">DPP</div>
                    {rupiah(c.totalDpp)}
                  </div>
                  <div>
                    <div className="muted text-[11px] uppercase">PPN</div>
                    {rupiah(c.totalPpn)}
                  </div>
                </div>
                <div className="flex gap-1">
                  <a className="btn-secondary px-3 py-1.5" href={downloadUrl(c.id, "csv")} download title="Download CSV">
                    <Icon.download className="h-4 w-4" /> CSV
                  </a>
                  <button type="button" className="btn-danger" onClick={() => void remove(c)} aria-label={`Delete ${c.outputName}`}>
                    <Icon.trash className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {more && !q && (
            <button
              type="button"
              className="w-full border-t border-slate-200 py-2.5 text-sm font-medium text-teal-700 hover:bg-slate-50 dark:border-slate-800 dark:text-teal-400 dark:hover:bg-slate-800/40"
              onClick={() => void load(rows![rows!.length - 1].createdAt)}
            >
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function HistoryDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<{ conversion: Conversion; preview: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) api.conversion(id).then(setData, (e) => setError(e instanceof ApiError ? e.message : "Not found."));
  }, [id]);

  return (
    <div>
      <button type="button" className="btn-ghost -ml-2 mb-4" onClick={() => nav("/history")}>
        ← History
      </button>
      {error && <Alert kind="error">{error}</Alert>}
      {!data && !error && <Spinner className="h-6 w-6 text-slate-400" />}
      {data && (
        <div className="card space-y-4 p-5">
          <ResultView conversion={data.conversion} preview={data.preview} />
          <div className="muted flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-4 text-xs dark:border-slate-800">
            <span>Source: {data.conversion.inputName}</span>
            <a className="underline" href={downloadUrl(data.conversion.id, "input")} download>
              Download original export
            </a>
            <span>{number(data.conversion.rowsCopied)} rows read</span>
          </div>
        </div>
      )}
    </div>
  );
}
