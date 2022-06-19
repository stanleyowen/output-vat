import React, { useState } from "react";
import { readFile, createFolder } from "../lib/file-operation.lib";

const xlsx = window.require("exceljs");

const Home = () => {
  const [isLoading, setLoading] = useState<boolean>(false);

  function parseExcelTemplate(filePath: string, callback: any) {
    const fileWorkbook = new xlsx.Workbook();
    const templateWorkbook = new xlsx.Workbook();
    fileWorkbook.xlsx.readFile(filePath).then(() => {
      templateWorkbook.xlsx
        .readFile(localStorage.getItem("excel-template"))
        .then(() => {
          const fileData = fileWorkbook.getWorksheet("XLSX Data");
          const templateData = templateWorkbook.getWorksheet("Data");
          let rowIndexFile = 3,
            rowIndexTemplate = 3;
          while (
            fileData.getCell(`A${rowIndexFile}`).value != null &&
            fileData.getCell(`A${rowIndexFile}`).value != ""
          ) {
            console.log(
              `C${rowIndexFile}`,
              `C${rowIndexFile + 1}`,
              rowIndexTemplate,
              fileData.getCell(`J${rowIndexTemplate}`).value,
              fileData.getCell(`C${rowIndexFile + 1}`).value,
              fileData.getCell(`C${rowIndexFile + 1}`).value == "1"
            );
            templateData.getCell(`F${rowIndexTemplate}`).value =
              fileData.getCell(`J${rowIndexFile}`).value;
            if (fileData.getCell(`C${rowIndexFile + 1}`).value == "1")
              rowIndexTemplate++;

            rowIndexFile++;
            rowIndexTemplate++;
          }
          const dir = filePath.substring(0, filePath.lastIndexOf("\\"));
          console.log(dir);
          createFolder(dir, "\\tmp\\", () => {
            console.log("hi");
            templateWorkbook.xlsx
              .writeFile(dir + "\\tmp\\" + "data" + ".xlsx")
              .then(() => {
                console.log("done");
              })
              .catch((err: any) => {
                throw err;
              });
          });
          callback("done");
        });
    });
  }

  const UploadFile = () => {
    setLoading(true);
    const excelFileTemplate = document.getElementById(
      "excel-file-template"
    ) as any;

    parseExcelTemplate(excelFileTemplate.files[0].path, () => {
      setLoading(false);
    });
  };

  return (
    <div className="p-2">
      <h1 className="font-medium text-white text-lg mb-2">Home</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <p className="my-auto">Excel template</p>
        <label className="block">
          <span className="sr-only">Choose Excel Template</span>
          <input
            type="file"
            id="excel-file-template"
            className="block w-full file:mr-4 file:py-1 file:px-4
            file:rounded-md file:border-0
            file:text-sm file:font-semibold
            file:bg-slate-400/10 hover:file:bg-slate-400/20 file:text-white
            hover:file:bg-blue-500"
          />
        </label>
        <button
          onClick={() => UploadFile()}
          className="block border-0 w-1/4 bg-slate-400/10 hover:bg-slate-400/20 text-white px-4 py-1 rounded-md"
        >
          Upload
        </button>
      </div>
    </div>
  );
};

export default Home;
