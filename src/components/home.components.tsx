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
            templateData.getCell(`A${rowIndexTemplate}`).value =
              fileData.getCell(`E${rowIndexFile}`).value;
            templateData.getCell(`B${rowIndexTemplate}`).value =
              fileData.getCell(`F${rowIndexFile}`).value;
            templateData.getCell(`C${rowIndexTemplate}`).value =
              fileData.getCell(`G${rowIndexFile}`).value;
            templateData.getCell(`D${rowIndexTemplate}`).value =
              fileData.getCell(`H${rowIndexFile}`).value;
            templateData.getCell(`E${rowIndexTemplate}`).value =
              fileData.getCell(`I${rowIndexFile}`).value;
            templateData.getCell(`F${rowIndexTemplate}`).value =
              fileData.getCell(`J${rowIndexFile}`).value;
            templateData.getCell(`G${rowIndexTemplate}`).value =
              fileData.getCell(`K${rowIndexFile}`).value;
            templateData.getCell(`H${rowIndexTemplate}`).value =
              fileData.getCell(`L${rowIndexFile}`).value;
            templateData.getCell(`I${rowIndexTemplate}`).value =
              fileData.getCell(`M${rowIndexFile}`).value;
            templateData.getCell(`J${rowIndexTemplate}`).value =
              fileData.getCell(`N${rowIndexFile}`).value;
            templateData.getCell(`K${rowIndexTemplate}`).value =
              fileData.getCell(`O${rowIndexFile}`).value;
            templateData.getCell(`L${rowIndexTemplate}`).value =
              fileData.getCell(`P${rowIndexFile}`).value;
            templateData.getCell(`M${rowIndexTemplate}`).value =
              fileData.getCell(`Q${rowIndexFile}`).value;
            templateData.getCell(`N${rowIndexTemplate}`).value =
              fileData.getCell(`R${rowIndexFile}`).value;
            templateData.getCell(`O${rowIndexTemplate}`).value =
              fileData.getCell(`S${rowIndexFile}`).value;
            templateData.getCell(`P${rowIndexTemplate}`).value =
              fileData.getCell(`T${rowIndexFile}`).value;
            templateData.getCell(`Q${rowIndexTemplate}`).value =
              fileData.getCell(`U${rowIndexFile}`).value;
            templateData.getCell(`R${rowIndexTemplate}`).value =
              fileData.getCell(`V${rowIndexFile}`).value;
            templateData.getCell(`S${rowIndexTemplate}`).value =
              fileData.getCell(`W${rowIndexFile}`).value;
            templateData.getCell(`T${rowIndexTemplate}`).value =
              fileData.getCell(`X${rowIndexFile}`).value;
            templateData.getCell(`U${rowIndexTemplate}`).value =
              fileData.getCell(`Y${rowIndexFile}`).value;
            templateData.getCell(`V${rowIndexTemplate}`).value =
              fileData.getCell(`Z${rowIndexFile}`).value;

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
