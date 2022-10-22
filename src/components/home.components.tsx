import React, { useState } from "react";
import { Info, LoadingAnimate, OpenExternal } from "../lib/icons.lib";
import { createFolder, openFilePath } from "../lib/file-operation.lib";

const excelJs = window.require("exceljs");

const Home = () => {
  const [path, setPath] = useState<string>("");
  const [isLoading, setLoading] = useState<boolean>(false);

  function parseExcelTemplate(filePath: string, callback: any) {
    const fileWorkbook = new excelJs.Workbook();
    const templateWorkbook = new excelJs.Workbook();
    const templatePath = String(localStorage.getItem("excel-template"));

    fileWorkbook.xlsx.readFile(filePath).then(() => {
      templateWorkbook.xlsx.readFile(templatePath).then(() => {
        const fileData =
          fileWorkbook.worksheets[fileWorkbook.views[0].activeTab];
        const templateData = templateWorkbook.getWorksheet("Data");
        const dir = templatePath.substring(0, templatePath.lastIndexOf("\\"));
        let rowIndexFile = 3,
          rowIndexTemplate = 3;

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

        createFolder(dir, "\\tmp\\", () => {
          templateWorkbook.xlsx
            .writeFile(dir + "\\tmp\\" + filePath.replace(/^.*[\\\/]/, ""))
            .then(() => {
              // const xlsxTemplate = xlsx.readFile(
              //   dir + "\\tmp\\" + filePath.replace(/^.*[\\\/]/, "")
              // );
              // const data = xlsx.utils.sheet_to_csv(
              //   xlsxTemplate.Sheets[xlsxTemplate.SheetNames[1]]
              // );
              // console.log(data);
              // executePython(
              //   dir + "\\tmp\\" + filePath.replace(/^.*[\\\/]/, ""),
              //   (path: string) => callback(path)
              // );
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
          <span className="font-medium">Error!</span> Error in parsing excel
          files. Please try again.
        </div>
      )}

      {path !== "" && path !== "error" ? (
        <div
          className="flex p-4 text-sm text-gray-700 bg-gray-100 rounded-lg dark:bg-gray-700 dark:text-gray-300 mb-3"
          role="alert"
        >
          <Info className="inline flex-shrink-0 mr-3 w-5 h-5" />
          <span className="font-medium">Success!</span> File parsed sucessfully.
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
        <p className="my-auto">Excel template</p>
        <label className="block">
          <span className="sr-only">Choose Excel Template</span>
          <input
            type="file"
            id="excel-file-template"
            className="block w-full
            file:mr-4 file:py-1 file:px-4 file:rounded-md file:border-0
            file:text-sm file:font-semibold file:bg-slate-400/10 file:text-white
            hover:file:bg-slate-400/20"
          />
        </label>
        <button
          disabled={isLoading}
          onClick={() => UploadFile()}
          className="block border-0 w-1/4 bg-slate-400/10 text-white px-4 py-1 rounded-md
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

export default Home;
