import React, { useState } from "react";
import { Info, LoadingAnimate, OpenExternal } from "../lib/icons.lib";
import { createFolder, openFilePath } from "../lib/file-operation.lib";

const { ipcRenderer } = window.require("electron");
const excelJs = window.require("exceljs");

const Home = () => {
  const [path, setPath] = useState<string>("");
  const [isLoading, setLoading] = useState<boolean>(false);
  const [useReferenceNumber, setUseReferenceNumber] = useState<boolean>(
    JSON.parse(
      localStorage.getItem("use-reference-number") === "true" ? "true" : "false"
    )
  );

  function parseExcelTemplate(filePath: string, callback: any) {
    const fileWorkbook = new excelJs.Workbook();
    const templateWorkbook = new excelJs.Workbook();
    const templatePath = String(localStorage.getItem("excel-template"));

    fileWorkbook.xlsx.readFile(filePath).then(() => {
      templateWorkbook.xlsx.readFile(templatePath).then(() => {
        const fileData =
          fileWorkbook.worksheets[fileWorkbook.views[0].activeTab];
        const templateData = templateWorkbook.getWorksheet("Data");
        const templateDB = templateWorkbook.getWorksheet("DB");

        const dir = templatePath.substring(0, templatePath.lastIndexOf("\\"));
        let rowIndexFile = 3,
          rowIndexTemplate = 3;
        let invoices: any[] = [],
          invoiceIndex = 3,
          invoicesLength = 0;

        // Count the unique Invoice Number
        while (
          fileData.getCell(`K${invoiceIndex}`).value != "" &&
          fileData.getCell(`K${invoiceIndex}`).value != null
        ) {
          invoices.push(fileData.getCell(`K${invoiceIndex}`).value);
          invoiceIndex++;
          invoicesLength++;
        }

        // remove duplicate invoice number
        invoices = invoices.filter(
          (item, index) => invoices.indexOf(item) === index
        );
        invoicesLength += invoices.length;

        while (
          fileData.getCell(`A${rowIndexFile}`).value != "" &&
          fileData.getCell(`A${rowIndexFile}`).value != null
        ) {
          [
            ["A", "E"],
            ["B", "F"],
            ["C", "G"],
            ["D", "H"],
            ["E", "I"],
            ["F", "J"],
            ["G", "K"],
            ["H", "L"],
            ["I", "M"],
            ["J", "N"],
            ["K", "O"],
            ["L", "P"],
            ["M", "Q"],
            ["N", "R"],
            ["O", "S"],
            ["P", "T"],
            ["Q", "U"],
            ["R", "V"],
            ["S", "W"],
            ["T", "X"],
            ["U", "Y"],
            ["V", "Z"],
          ].forEach(([colTemplate, col]) => {
            templateData.getCell(`${colTemplate}${rowIndexTemplate}`).value =
              fileData.getCell(`${col}${rowIndexFile}`).value;
          });

          if (fileData.getCell(`C${rowIndexFile + 1}`).value == "1")
            rowIndexTemplate++;

          rowIndexFile++;
          rowIndexTemplate++;
        }

        // Delete the remaining unused rows in the template
        rowIndexFile = 4;
        while (rowIndexFile <= 2500) {
          // Add Reference Number if useReferenceNumber is true
          if (
            rowIndexFile < invoicesLength + 4 &&
            rowIndexFile > 4 &&
            useReferenceNumber
          )
            templateDB.getCell(`S${rowIndexFile}`).value = {
              formula: `TRIM(Data!G${rowIndexFile - 2})`,
            };

          if (rowIndexFile >= invoicesLength + 4)
            [
              "A",
              "B",
              "C",
              "D",
              "E",
              "F",
              "G",
              "H",
              "I",
              "J",
              "K",
              "L",
              "M",
              "N",
              "O",
              "P",
              "Q",
              "R",
            ].forEach((col) => {
              templateDB.getCell(`${col}${rowIndexFile}`).value = null;
            });
          rowIndexFile++;
        }

        // Hide the first and the third sheets
        templateWorkbook.worksheets[0].state = "hidden";
        templateWorkbook.worksheets[2].state = "hidden";

        createFolder(dir, "\\tmp\\", () => {
          templateWorkbook.xlsx
            .writeFile(dir + "\\tmp\\" + filePath.replace(/^.*[\\\/]/, ""))
            .then(() => {
              callback(dir + "\\tmp\\" + filePath.replace(/^.*[\\\/]/, ""));
            })
            .catch((err: any) => {
              callback("error");
              throw err;
            });
        });
      });
    });
  }

  const UploadFile = () => {
    setLoading(true);

    const excelFileTemplate = document.getElementById(
      "excel-file-template"
    ) as any;

    parseExcelTemplate(excelFileTemplate.files[0].path, (path: string) => {
      setPath(path);
      setLoading(false);
    });
  };

  const SetReference = () => {
    setLoading(true);

    ipcRenderer.send(
      "store-data",
      JSON.stringify({
        id: "use-reference-number",
        value: !useReferenceNumber,
      })
    );

    ipcRenderer.once("store-data-status", (_: any, res: any) => {
      setUseReferenceNumber(!useReferenceNumber);
      setLoading(false);
    });
  };

  const OpenOutputPath = () => openFilePath(path);

  return (
    <div className="p-2">
      <h1 className="font-medium text-white text-lg mb-2">Home</h1>

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
          <span className="sr-only">Choose Excel File</span>
          <input
            type="file"
            id="excel-file-template"
            className="block w-full
            file:mr-4 file:py-1 file:px-4 file:rounded-md file:border-0
            file:text-sm file:font-semibold file:bg-slate-400/10 file:text-white
            hover:file:bg-slate-400/20"
          />
        </label>
      </div>

      <div>
        <p className="mt-10 mb-2">Settings</p>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={useReferenceNumber}
            onChange={() => SetReference()}
            className="sr-only peer"
          />
          <div className="relative w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
          <span className="ms-3 text-sm font-medium text-gray-900 dark:text-gray-300">
            Use Reference Number
          </span>
        </label>
      </div>

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
  );
};

export default Home;
