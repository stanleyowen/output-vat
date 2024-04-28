import React, { useState } from "react";
import { Info, LoadingAnimate, OpenExternal } from "../lib/icons.lib";
import { openFilePath } from "../lib/file-operation.lib";

const fs = window.require("fs");
const xlsx = window.require("node-xlsx");

const Convert = () => {
  const [path, setPath] = useState<string>("");
  const [isLoading, setLoading] = useState<boolean>(false);

  async function parseExcelToCSV(filePath: string, callback: any) {
    let obj = await xlsx.parse(filePath);
    let rows = [];
    let writeStr = "";

    // Looping through DB sheet
    let sheet = obj[1],
      j = 0;
    while (sheet.data[j].length > 0) {
      // push empty string to the array if the length is less than 19
      while (sheet.data[j].length < 21) sheet.data[j].push("");

      rows.push(sheet.data[j]);
      j++;
    }

    for (let i = 0; i < rows.length; i++) {
      writeStr += rows[i].join(";") + "\n";
    }

    await fs.writeFile(
      filePath.replace(".xlsx", ".csv"),
      writeStr,
      (err: any) => {
        if (err) {
          callback("error");
          throw err;
        } else callback(filePath.replace(".xlsx", ".csv"));
      }
    );
  }

  const UploadFile = () => {
    console.clear();
    setLoading(true);

    const XLSXfile = document.getElementById("excel-file") as any;

    parseExcelToCSV(XLSXfile.files[0].path, (path: string) => {
      setPath(path);
      setLoading(false);
    });
  };

  const OpenOutputPath = () => openFilePath(path);

  return (
    <div className="p-2">
      <h1 className="font-medium text-white text-lg mb-2">
        Convert XLSX to CSV
      </h1>

      {path === "error" && (
        <div
          className="flex p-4 text-sm text-gray-700 bg-gray-100 rounded-lg dark:bg-gray-700 dark:text-gray-300 mb-3"
          role="alert"
        >
          <Info className="inline flex-shrink-0 mr-3 w-5 h-5" />
          <span className="font-medium mr-1">Error!</span> Error in parsing
          excel files. Please try again.
        </div>
      )}

      {path !== "" && path !== "error" ? (
        <div
          className="flex p-4 text-sm text-gray-700 bg-gray-100 rounded-lg dark:bg-gray-700 dark:text-gray-300 mb-3"
          role="alert"
        >
          <Info className="inline flex-shrink-0 mr-3 w-5 h-5" />
          <span className="font-medium mr-1">Success!</span> File parsed
          sucessfully.
          <button
            type="button"
            className="ml-auto -mx-1.5 -my-1.5 bg-gray-100 text-gray-500 rounded-lg focus:ring-2 focus:ring-gray-400 p-1.5 hover:bg-gray-200 inline-flex h-8 w-8 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
            data-dismiss-target="#alert-border-5"
            aria-label="Close"
            onClick={() => OpenOutputPath()}
          >
            <span className="sr-only">Open in File Explorer</span>
            <OpenExternal className="w-5 h-5" />
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <p className="my-auto">Excel File (*.xlsx)</p>
        <label className="block">
          <span className="sr-only">Choose XLSX File</span>
          <input
            type="file"
            id="excel-file"
            className="block w-full
            file:mr-4 file:py-1 file:px-4 file:rounded-md file:border-0
            file:text-sm file:font-semibold file:bg-slate-400/10 file:text-white
            hover:file:bg-slate-400/20"
          />
        </label>
        <button
          disabled={isLoading}
          onClick={() => UploadFile()}
          className="mt-10 block border-0 w-1/4 bg-slate-400/10 text-white px-4 py-1 rounded-md
          hover:bg-slate-400/20
          disabled:opacity-50 disabled:cursor-not-allowed disabled:inline-flex disabled:items-center"
        >
          {isLoading && (
            <LoadingAnimate className="inline w-4 h-4 mr-3 text-white animate-spin" />
          )}
          Upload
        </button>
      </div>
    </div>
  );
};

export default Convert;
