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
            className="block w-full file:mr-4 file:py-1 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-slate-400/10 hover:file:bg-slate-400/20 file:text-white hover:file:bg-blue-500"
          />
        </label>
        <button
          disabled={isLoading}
          onClick={() => UploadFile()}
          className="block border-0 w-1/4 bg-slate-400/10 disabled:inline-flex disabled:items-center hover:bg-slate-400/20 text-white px-4 py-1 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <svg
              role="status"
              className="inline w-4 h-4 mr-3 text-white animate-spin"
              viewBox="0 0 100 101"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                fill="#E5E7EB"
              />
              <path
                d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                fill="currentColor"
              />
            </svg>
          ) : null}
          Upload
        </button>
      </div>
    </div>
  );
};

export default Home;