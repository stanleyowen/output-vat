import { useMemo, useState } from "react";
import { downloadUrl, type Conversion } from "../lib/api";
import { number, parseInvoices, rupiah, when } from "../lib/format";
import { Icon, Stat } from "./ui";

export function ResultView({ conversion: c, preview }: { conversion: Conversion; preview: string }) {
  const invoices = useMemo(() => parseInvoices(preview), [preview]);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? invoices : invoices.slice(0, 8);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          <Icon.check className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{c.outputName}</div>
          <div className="muted text-xs">
            {when(c.createdAt)} · {c.templateName}
            {c.useReferenceNumber ? " · with reference number" : ""} · {(c.durationMs / 1000).toFixed(1)} s
          </div>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <a className="btn-primary flex-1 sm:flex-none" href={downloadUrl(c.id, "csv")} download>
            <Icon.download className="h-4 w-4" /> Download CSV
          </a>
          <a className="btn-secondary flex-1 sm:flex-none" href={downloadUrl(c.id, "xlsx")} download>
            Excel
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Invoices (FK)" value={number(c.invoices)} />
        <Stat label="Line items (OF)" value={number(c.lineItems)} />
        <Stat label="Total DPP" value={rupiah(c.totalDpp)} />
        <Stat label="Total PPN" value={rupiah(c.totalPpn)} />
      </div>

      {invoices.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Faktur</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Buyer</th>
                  <th className="px-3 py-2 text-right font-medium">Items</th>
                  <th className="px-3 py-2 text-right font-medium">DPP</th>
                  <th className="px-3 py-2 text-right font-medium">PPN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {shown.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                    <td className="px-3 py-2 font-mono text-xs">{r.nomorFaktur}</td>
                    <td className="whitespace-nowrap px-3 py-2">{r.tanggal}</td>
                    <td className="max-w-[16rem] px-3 py-2">
                      <div className="truncate" title={r.nama}>
                        {r.nama}
                      </div>
                      <div className="muted font-mono text-[11px]">{r.npwp}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.items}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{number(r.dpp)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{number(r.ppn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {invoices.length > 8 && (
            <button
              type="button"
              onClick={() => setShowAll(!showAll)}
              className="w-full border-t border-slate-200 py-2 text-sm font-medium text-teal-700 hover:bg-slate-50 dark:border-slate-800 dark:text-teal-400 dark:hover:bg-slate-800/40"
            >
              {showAll ? "Show fewer" : `Show all ${invoices.length}${c.invoices > invoices.length ? ` of ${c.invoices} (preview)` : ""}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
