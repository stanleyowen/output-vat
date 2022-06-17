import React from "react";

const Settings = () => {
  return (
    <div className="p-2">
      <h1 className="font-medium text-white text-lg mb-2">Settings</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <p className="my-auto">Excel template</p>
        <label className="block">
          <span className="sr-only">Choose Excel Template</span>
          <input
            type="file"
            className="block w-full file:mr-4 file:py-1 file:px-4
            file:rounded-md file:border-0
            file:text-sm file:font-semibold
            file:bg-slate-400/10 hover:file:bg-slate-400/20 file:text-white
            hover:file:bg-blue-500"
          />
        </label>
      </div>
    </div>
  );
};

export default Settings;
