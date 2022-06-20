import React, { useState } from "react";
import { createFolder } from "../lib/file-operation.lib";
import { OpenExternal } from "../lib/icons.lib";

const excelJs = window.require("exceljs");

const Home = () => {
  const [isLoading, setLoading] = useState<boolean>(false);

  function parseExcelTemplate(filePath: string, callback: any) {
    const fileWorkbook = new excelJs.Workbook();
    const templateWorkbook = new excelJs.Workbook();
    const templatePath = String(localStorage.getItem("excel-template"));

    fileWorkbook.xlsx.readFile(filePath).then(() => {
      templateWorkbook.xlsx.readFile(templatePath).then(() => {
        const fileData = fileWorkbook.getWorksheet("XLSX Data");
        const templateData = templateWorkbook.getWorksheet("Data");
        const dir = templatePath.substring(0, templatePath.lastIndexOf("\\"));
        let rowIndexFile = 3,
          rowIndexTemplate = 3;

        while (
          fileData.getCell(`A${rowIndexFile}`).value != null &&
          fileData.getCell(`A${rowIndexFile}`).value != ""
        ) {
          templateData.getCell(`A${rowIndexTemplate}`).value = fileData.getCell(
            `E${rowIndexFile}`
          ).value;
          templateData.getCell(`B${rowIndexTemplate}`).value = fileData.getCell(
            `F${rowIndexFile}`
          ).value;
          templateData.getCell(`C${rowIndexTemplate}`).value = fileData.getCell(
            `G${rowIndexFile}`
          ).value;
          templateData.getCell(`D${rowIndexTemplate}`).value = fileData.getCell(
            `H${rowIndexFile}`
          ).value;
          templateData.getCell(`E${rowIndexTemplate}`).value = fileData.getCell(
            `I${rowIndexFile}`
          ).value;
          templateData.getCell(`F${rowIndexTemplate}`).value = fileData.getCell(
            `J${rowIndexFile}`
          ).value;
          templateData.getCell(`G${rowIndexTemplate}`).value = fileData.getCell(
            `K${rowIndexFile}`
          ).value;
          templateData.getCell(`H${rowIndexTemplate}`).value = fileData.getCell(
            `L${rowIndexFile}`
          ).value;
          templateData.getCell(`I${rowIndexTemplate}`).value = fileData.getCell(
            `M${rowIndexFile}`
          ).value;
          templateData.getCell(`J${rowIndexTemplate}`).value = fileData.getCell(
            `N${rowIndexFile}`
          ).value;
          templateData.getCell(`K${rowIndexTemplate}`).value = fileData.getCell(
            `O${rowIndexFile}`
          ).value;
          templateData.getCell(`L${rowIndexTemplate}`).value = fileData.getCell(
            `P${rowIndexFile}`
          ).value;
          templateData.getCell(`M${rowIndexTemplate}`).value = fileData.getCell(
            `Q${rowIndexFile}`
          ).value;
          templateData.getCell(`N${rowIndexTemplate}`).value = fileData.getCell(
            `R${rowIndexFile}`
          ).value;
          templateData.getCell(`O${rowIndexTemplate}`).value = fileData.getCell(
            `S${rowIndexFile}`
          ).value;
          templateData.getCell(`P${rowIndexTemplate}`).value = fileData.getCell(
            `T${rowIndexFile}`
          ).value;
          templateData.getCell(`Q${rowIndexTemplate}`).value = fileData.getCell(
            `U${rowIndexFile}`
          ).value;
          templateData.getCell(`R${rowIndexTemplate}`).value = fileData.getCell(
            `V${rowIndexFile}`
          ).value;
          templateData.getCell(`S${rowIndexTemplate}`).value = fileData.getCell(
            `W${rowIndexFile}`
          ).value;
          templateData.getCell(`T${rowIndexTemplate}`).value = fileData.getCell(
            `X${rowIndexFile}`
          ).value;
          templateData.getCell(`U${rowIndexTemplate}`).value = fileData.getCell(
            `Y${rowIndexFile}`
          ).value;
          templateData.getCell(`V${rowIndexTemplate}`).value = fileData.getCell(
            `Z${rowIndexFile}`
          ).value;

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
              callback("Write operation success");
              // executePython(
              //   dir + "\\tmp\\" + filePath.replace(/^.*[\\\/]/, ""),
              //   (path: string) => callback(path)
              // );
            })
            .catch((err: any) => {
              callback(err);
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
      setLoading(false);
      console.log(path);
    });
  };

  return (
    <div className="p-2">
      <h1 className="font-medium text-white text-lg mb-2">Home</h1>

      <div
        className="flex p-4 text-sm text-gray-700 bg-gray-100 rounded-lg dark:bg-gray-700 dark:text-gray-300 mb-3"
        role="alert"
      >
        <svg
          className="inline flex-shrink-0 mr-3 w-5 h-5"
          fill="currentColor"
          viewBox="0 0 20 20"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill-rule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
            clip-rule="evenodd"
          ></path>
        </svg>
        <div>
          <span className="font-medium">Error!</span> Error in parsing excel
          files. Please try again.
        </div>
        <button
          type="button"
          className="ml-auto -mx-1.5 -my-1.5 bg-gray-100 text-gray-500 rounded-lg focus:ring-2 focus:ring-gray-400 p-1.5 hover:bg-gray-200 inline-flex h-8 w-8 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
          data-dismiss-target="#alert-border-5"
          aria-label="Close"
        >
          <span className="sr-only">Open in File Explorer</span>
          <OpenExternal className="w-5 h-5" />
        </button>
      </div>

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
