import React, { useState } from "react";

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

export default Settings;
