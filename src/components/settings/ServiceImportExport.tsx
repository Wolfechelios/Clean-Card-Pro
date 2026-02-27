import React from "react";
import ExcelJS from "exceljs";

interface Props {
  data: Record<string, any>[];
  filename?: string;
}

export default function ServiceImportExport({
  data,
  filename = "export",
}: Props) {
  const downloadBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ✅ FIXED CSV ESCAPE FUNCTION
  const esc = (v: any) => {
    const s = String(v ?? "");
    // Escape if contains quote, comma, CR, or LF
    if (/[",\r\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const exportCSV = () => {
    if (!data?.length) return;

    const headers = Object.keys(data[0]);
    const rows = data.map((row) =>
      headers.map((h) => esc(row[h])).join(",")
    );

    const csv = [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, `${filename}.csv`);
  };

  const exportXLSX = async () => {
    if (!data?.length) return;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");

    const headers = Object.keys(data[0]);
    sheet.addRow(headers);

    data.forEach((row) => {
      sheet.addRow(headers.map((h) => row[h] ?? ""));
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    downloadBlob(blob, `${filename}.xlsx`);
  };

  return (
    <div className="flex gap-2">
      <button
        onClick={exportCSV}
        className="px-3 py-2 bg-blue-600 text-white rounded"
      >
        Export CSV
      </button>

      <button
        onClick={exportXLSX}
        className="px-3 py-2 bg-green-600 text-white rounded"
      >
        Export XLSX
      </button>
    </div>
  );
}