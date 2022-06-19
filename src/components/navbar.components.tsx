import React from "react";
import AppIcon from "../logo.svg";

const NavBar = () => {
  return (
    <nav className="border-gray-200 px-2 sm:px-4 py-2.5 rounded bg-gray-800">
      <div className="container flex flex-wrap justify-between items-center mx-auto">
        <a
          className="flex items-center cursor-pointer"
          onClick={() => (window.location.hash = "/")}
        >
          <img src={AppIcon} className="mr-3 h-6 sm:h-9" alt="React Logo" />
          <span className="self-center text-xl font-semibold whitespace-nowrap text-white">
            Output VAT
          </span>
        </a>
        <div className="hidden w-full md:block md:w-auto" id="mobile-menu">
          <ul className="flex flex-col mt-4 md:flex-row md:space-x-8 md:mt-0 md:text-sm md:font-medium">
            <li>
              <a
                aria-current="page"
                onClick={() => (window.location.hash = "/")}
                className="block py-2 pr-4 pl-3 text-gray-400 border-b border-gray-700 cursor-pointer
                hover:bg-gray-700 hover:text-white
                md:hover:bg-transparent md:border-0 md:hover:text-white-700 md:p-0"
              >
                Home
              </a>
            </li>
            <li>
              <a
                onClick={() => (window.location.hash = "/settings")}
                className="block py-2 pr-4 pl-3 text-gray-400 border-b border-gray-700 cursor-pointer
                hover:bg-gray-700 hover:text-white
                md:hover:bg-transparent md:border-0 md:hover:text-white-700 md:p-0"
              >
                Settings
              </a>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  );
};

export default NavBar;
