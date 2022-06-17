import React from "react";

const Settings = () => {
  return (
    <div className="p-2">
      {/* grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <p>Excel template</p>
        <button
          type="button"
          className="inline-block px-6 py-2.5 bg-blue-700  font-medium text-xs leading-tight uppercase rounded-md shadow-md hover:bg-blue-700 hover:shadow-lg focus:bg-blue-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-blue-800 active:shadow-lg transition duration-150 ease-in-out"
        >
          Upload
        </button>
      </div>
    </div>
  );
};

export default Settings;
