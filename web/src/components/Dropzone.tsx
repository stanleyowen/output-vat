import { useRef, useState, type DragEvent } from "react";
import { bytes } from "../lib/format";
import { Icon } from "./ui";

export function Dropzone({
  file,
  onFile,
  disabled,
  hint = "Excel workbook (.xlsx)",
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = (f: File | undefined) => {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) {
      setError("Please choose an .xlsx file.");
      return;
    }
    setError(null);
    onFile(f);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!disabled) accept(e.dataTransfer.files[0]);
  };

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/50">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          <Icon.file className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{file.name}</div>
          <div className="muted text-xs">{bytes(file.size)}</div>
        </div>
        <button type="button" className="btn-ghost" onClick={() => onFile(null)} disabled={disabled} aria-label="Remove file">
          <Icon.x className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
          over
            ? "border-teal-600 bg-teal-50 dark:bg-teal-950/30"
            : "border-slate-300 hover:border-teal-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/40"
        }`}
      >
        <Icon.upload className="h-8 w-8 text-slate-400" />
        <span className="text-sm">
          <span className="font-semibold text-teal-700 dark:text-teal-400">Choose a file</span> or drag it here
        </span>
        <span className="muted text-xs">{hint}</span>
      </button>
      <input
        ref={input}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          accept(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
