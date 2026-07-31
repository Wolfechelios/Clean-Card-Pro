import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';

// Configuration
const INPUT_FILE = process.argv[2] || 'pricecharting_export.xlsx';
const OUTPUT_FILE = 'public/data/yugioh-setcode-index.json';

async function parsePriceChartingXlsx() {
  try {
    console.log(`Reading ${INPUT_FILE}...`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(INPUT_FILE);
    const worksheet = workbook.getWorksheet(1);
    
    if (!worksheet) {
      throw new Error('No worksheet found in the provided file.');
    }

    const rows = worksheet.getRow(1).values; // Header row
    const headerMap = {};
    rows.forEach((val, idx) => {
      if (val) headerMap[val.toString().toLowerCase()] = idx;
    });

    console.log('Detected headers:', Object.keys(headerMap));

    const data = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      const getVal = (key) => {
        const idx = headerMap[key.toLowerCase()];
        return idx !== undefined ? row.getCell(idx).value : null;
      };

      // PriceCharting columns are often slightly different depending on export type
      // We try multiple common variations
      const name = getVal('Product Name') || getVal('Card Name') || getVal('Product');
      if (!name) return;

      const set = getVal('Set') || getVal('Set Name');
      const number = getVal('Card Number') || getVal('Number');
      
      // Price mapping
      const rawPrice = parseFloat(String(getVal('Loose Price') || getVal('Market Price') || '0').replace(/[$,]/g, ''));
      const psa9 = parseFloat(String(getVal('PSA 9') || getVal('PSA 9 Price') || '0').replace(/[$,]/g, ''));
      const psa10 = parseFloat(String(getVal('PSA 10') || getVal('PSA 10 Price') || '0').replace(/[$,]/g, ''));
      
      // Construct a basic set code if possible (e.g. LOB-001)
      // In a real scenario, we might need a mapping table, but here we combine Set and Number
      const setCode = (set && number) ? `${set}-${number}` : null;

      data.push({
        cardName: name,
        cardSet: set,
        cardNumber: number,
        setCode: setCode,
        rarity: getVal('Rarity') || null,
        currentPriceRaw: rawPrice > 0 ? rawPrice : null,
        currentPricePsa9: psa9 > 0 ? psa9 : null,
        currentPricePsa10: psa10 > 0 ? psa10 : null,
        suggestedPrice: rawPrice > 0 ? rawPrice : null,
        priceChartingUrl: null, // Would require specific product IDs from PriceCharting
        confidence: 98
      });
    });

    console.log(`Successfully parsed ${data.length} cards.`);
    
    // Ensure directory exists
    const dir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
    console.log(`Saved to ${OUTPUT_FILE}`);

  } catch (error) {
    console.error('Error parsing file:', error);
    process.exit(1);
  }
}

parsePriceChartingXlsx();
