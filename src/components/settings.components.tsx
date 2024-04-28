import React, { useState } from "react";
import { openFilePath } from "../lib/file-operation.lib";
import { Info, LoadingAnimate, OpenExternal } from "../lib/icons.lib";

const { ipcRenderer } = window.require("electron");

const Settings = () => {
  const [path, setPath] = useState<string>("");
  const [isLoading, setLoading] = useState<boolean>(false);

  const OpenOutputPath = () => openFilePath(path);

  const UploadFile = () => {
    setLoading(true);

    const excelFileTemplate = document.getElementById(
      "excel-file-template"
    ) as any;

    ipcRenderer.send(
      "store-data",
      JSON.stringify({
        id: "excel-template",
        value: excelFileTemplate.files[0].path,
      })
    );

    ipcRenderer.once("store-data-status", (_: any, res: any) => {
      setPath(excelFileTemplate.files[0].path);
      setLoading(false);
    });
  };

  return (
    <div className="p-2">
      <h1 className="font-medium text-white text-lg mb-2">Settings</h1>

      {path === "error" && (
        <div
          className="flex p-4 text-sm text-gray-700 bg-gray-100 rounded-lg dark:bg-gray-700 dark:text-gray-300 mb-3"
          role="alert"
        >
          <Info className="inline flex-shrink-0 mr-3 w-5 h-5" />
          <span className="font-medium mr-1">Error!</span> Error in uploading
          excel template. Please try again.
        </div>
      )}

      {path !== "" && path !== "error" ? (
        <div
          className="flex p-4 text-sm text-gray-700 bg-gray-100 rounded-lg dark:bg-gray-700 dark:text-gray-300 mb-3"
          role="alert"
        >
          <Info className="inline flex-shrink-0 mr-3 w-5 h-5" />
          <span className="font-medium mr-1">Success!</span> Excel template
          uploaded successfully.
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
        <p className="my-auto">Excel template (*.xlsx)</p>
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

export default Settings;
