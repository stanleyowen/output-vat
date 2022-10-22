import React, { useState } from "react";
import axios from "axios";
import { Info, LoadingAnimate, OpenExternal } from "../lib/icons.lib";
import { createFolder, openFilePath } from "../lib/file-operation.lib";

const Home = () => {
  const [path, setPath] = useState<string>("");
  const [isLoading, setLoading] = useState<boolean>(false);

  function getConversionStatus(id: string, cb?: any) {
    axios.get(`https://api.convertio.co/convert/${id}/status`).then((res) => {
      if (res.data.status == "ok") {
        if (res.data.data.step == "finish") cb(res.data.data.output.url);
        else setTimeout(() => getConversionStatus(id), 2000);
        console.log(res.data, "function");
      }
    });
  }

  const UploadFile = () => {
    setLoading(true);

    const file = document.getElementById("excel-file") as any;
    console.log(file.files[0]);
    axios
      .post("https://api.convertio.co/convert", {
        apikey: process.env.REACT_APP_API_KEY,
        input: "upload",
        file: "hi",
        filename: file.files[0].name,
        outputformat: "csv",
      })
      .then((res) => {
        if (res.data.status == "ok") {
          // upload file using multipart-formdata
          axios
            .put(
              `https://api.convertio.co/convert/${res.data.data.id}/${file.files[0].name}`,
              (document.getElementById("excel-file") as any).files[0],
              {
                headers: {
                  "Content-Type":
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                },
              }
            )
            .then((res) => {
              // get status conversion and loop when status is pending
              getConversionStatus(res.data.data.id, (url: any) => {
                setPath(url);
                console.log(url);
              });
            });
        }
      })
      .catch((err: any) => {
        setPath("error");
        throw err;
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
