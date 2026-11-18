const idr = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("id-ID");
const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

export const rupiah = (n: number) => idr.format(n);
export const number = (n: number) => num.format(n);
export const when = (ms: number) => dateTime.format(new Date(ms));
export const day = (ms: number) => dateOnly.format(new Date(ms));

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function relative(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return day(ms);
}

export interface InvoiceRow {
  nomorFaktur: string;
  tanggal: string;
  npwp: string;
  nama: string;
  dpp: number;
  ppn: number;
  items: number;
}

/** Parse the e-Faktur CSV preview into invoices (FK rows) with their line-item counts. */
export function parseInvoices(csv: string): InvoiceRow[] {
  const out: InvoiceRow[] = [];
  const lines = csv.split("\n");
  for (let i = 3; i < lines.length; i++) {
    const c = lines[i].split(";");
    if (c[0] === "FK") {
      out.push({
        nomorFaktur: c[3] ?? "",
        tanggal: c[6] ?? "",
        npwp: c[7] ?? "",
        nama: (c[8] ?? "").replace(/ #NIK#NAMA#.*/, ""),
        dpp: Number(c[10]) || 0,
        ppn: Number(c[11]) || 0,
        items: 0,
      });
    } else if (c[0] === "OF" && out.length) {
      out[out.length - 1].items++;
    }
  }
  return out;
}
