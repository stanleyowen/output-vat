/**
 * exceljs 4.4.0 bug: Worksheet.model computes the <dimension> by calling
 * Range.expand(row, min, row, max) for every row, and rows whose cells were all
 * cleared report min=max=0. Range.expand treats 0 as "unset", so a cleared row
 * resets `left`, and the next row (e.g. one that only has column U) then becomes
 * the new left edge -> <dimension ref="U1:U1016"/>.
 *
 * Microsoft Excel used to hide this by rewriting the file. SheetJS (used for the
 * CSV, exactly like the desktop app) trusts <dimension>, so a wrong value drops
 * columns A-T. We skip empty rows, which is what the code intended.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Range = require("exceljs/lib/doc/range.js") as {
  prototype: { expand(top: number, left: number, bottom: number, right: number): void; __ovatPatched?: boolean };
};

if (!Range.prototype.__ovatPatched) {
  const original = Range.prototype.expand;
  Range.prototype.expand = function (top: number, left: number, bottom: number, right: number) {
    if (!top || !left || !bottom || !right) return;
    original.call(this, top, left, bottom, right);
  };
  Range.prototype.__ovatPatched = true;
}

export {};
