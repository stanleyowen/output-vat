import React from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import "./App.css";

import Home from "./components/home.components";
import NavBar from "./components/navbar.components";
import Settings from "./components/settings.components";

function App() {
  window.addEventListener("keydown", (e) => {
    if (e.keyCode === 116) {
      e.preventDefault();
      window.location.reload();
    }
  });

  return (
    <HashRouter>
      <NavBar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
