import { Routes, Route, Navigate } from "react-router-dom";

import RapidScanCamera from "./components/scanner/RapidScanCamera";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RapidScanCamera />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
