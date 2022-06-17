import React from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import "./App.css";

import NavBar from "./components/navbar.components";
function App() {
  return (
    <HashRouter>
      <NavBar />
      <Routes>
        <Route path="/" element={<h1>Home</h1>} />
        <Route path="/settings" element={<h1>Settings</h1>} />
      </Routes>
    </HashRouter>
  );
}

export default App;
