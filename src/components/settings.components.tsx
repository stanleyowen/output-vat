import React, { useState } from "react";
import { Info, LoadingAnimate, OpenExternal } from "../lib/icons.lib";

const { ipcRenderer } = window.require("electron");

const Settings = () => {
  const [isLoading, setLoading] = useState<boolean>(false);

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
      console.log(res);
      setLoading(false);
    });
  };

  return (
    <div className="p-2">
      <h1 className="font-medium text-white text-lg mb-2">Settings</h1>

      <div
        className="flex p-4 text-sm text-gray-700 bg-gray-100 rounded-lg dark:bg-gray-700 dark:text-gray-300 mb-3"
        role="alert"
      >
        <Info className="inline flex-shrink-0 mr-3 w-5 h-5" />
        <div>
          <span className="font-medium">Sucess!</span> File uploaded
          sucessfully.
        </div>
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
