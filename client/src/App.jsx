import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import RLGL from './pages/RLGL';
import Admin from './pages/Admin';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<RLGL />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </Router>
  );
}

export default App;