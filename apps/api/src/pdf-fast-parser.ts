import {
  extractedDocumentSchema,
  type ExtractedDocument,
  type TaxBasis
} from "@quote-intelligence/domain";

export function parsePdfQuoteBufferFast(contents: Uint8Array): ExtractedDocument | null {
  try {
    const rawText = new TextDecoder("latin1").decode(contents);
    const textFragments: string[] = [];

    // Extract text in parentheses: (...) Tj or (...) TJ
    const tjRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*T[jJ]/g;
    let match: RegExpExecArray | null;

    while ((match = tjRegex.exec(rawText)) !== null) {
      const unescaped = match[1]
        .replace(/\\\( /g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\")
        .trim();
      if (unescaped) textFragments.push(unescaped);
    }

    if (textFragments.length < 3) {
      // Try fallback regex for array TJ streams: [(...)] TJ
      const arrayTjRegex = /\[\s*(?:\(([^()\\]*(?:\\.[^()\\]*)*)\)|[^\s\]]+)*\s*\]\s*TJ/g;
      let arrayMatch: RegExpExecArray | null;
      while ((arrayMatch = arrayTjRegex.exec(rawText)) !== null) {
        const itemRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
        let item: RegExpExecArray | null;
        while ((item = itemRegex.exec(arrayMatch[0])) !== null) {
          const unescaped = item[1]
            .replace(/\\\(/g, "(")
            .replace(/\\\)/g, ")")
            .replace(/\\\\/g, "\\")
            .trim();
          if (unescaped) textFragments.push(unescaped);
        }
      }
    }

    if (textFragments.length < 3) return null;

    const fullText = textFragments.join("\n");
    const lines = textFragments.map((l) => l.trim()).filter(Boolean);

    // Extract Supplier Name
    let supplierName = lines[0] || "Unknown Supplier";
    if (/tax invoice|quotation|quote/i.test(supplierName) && lines[1]) {
      supplierName = lines[1];
    }

    // Extract Quote Number
    const quoteNoMatch =
      fullText.match(/Quote\s*(?:No|Number|#)?[:\s]*([A-Z0-9-]+)/i) ||
      fullText.match(/\b([A-Z]{2,4}-Q-[0-9]{4}-[0-9]+)\b/);
    const quoteNumber = quoteNoMatch ? quoteNoMatch[1].trim() : "Q-001";

    // Extract Date
    const dateMatch =
      fullText.match(/Date[:\s]*([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})/i) ||
      fullText.match(/Date[:\s]*([0-9]{4}-[0-9]{2}-[0-9]{2})/i) ||
      fullText.match(/Date[:\s]*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i);
    const dateText = dateMatch ? dateMatch[1].trim() : new Date().toISOString().slice(0, 10);

    // Extract VAT Number
    const vatMatch = fullText.match(/VAT\s*(?:No|Number|#)?[:\s]*([0-9]{10})/i);
    const vatNumber = vatMatch ? vatMatch[1] : undefined;

    // Extract Currency
    const currencyMatch = fullText.match(/Currency[:\s]*([A-Z]{3})/i);
    const currency = currencyMatch ? currencyMatch[1].toUpperCase() : "ZAR";

    // Extract Line Items
    const lineItems: ExtractedDocument["lineItems"] = [];
    const lineRegex = /^(.*?)\s+([0-9]+(?:\.[0-9]+)?)\s+([a-zA-Z0-9-]+)\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)$/;

    for (const line of lines) {
      if (
        /description/i.test(line) ||
        /quote number/i.test(line) ||
        /tax invoice/i.test(line) ||
        /subtotal/i.test(line) ||
        /vat \(15%\)/i.test(line) ||
        /total \(incl/i.test(line) ||
        /----/.test(line)
      ) {
        continue;
      }

      const matchLine = line.match(lineRegex);
      if (matchLine) {
        const [, description, qtyStr, unit, rateStr, totalStr] = matchLine;
        const quantity = parseFloat(qtyStr);
        const unitRate = parseFloat(rateStr);
        const lineTotal = parseFloat(totalStr);

        if (!isNaN(quantity) && !isNaN(unitRate) && !isNaN(lineTotal)) {
          lineItems.push({
            sourceRow: line,
            description: description.trim(),
            quantity,
            unit: unit.trim(),
            unitRate,
            lineTotal
          });
        }
      }
    }

    if (lineItems.length === 0) return null;

    // Extract Subtotal, VAT, Total
    const subtotalMatch = fullText.match(/Subtotal[^\d]*([\d.,]+)/i);
    const vatMatchAmt = fullText.match(/VAT\s*\(15%\)[^\d]*([\d.,]+)/i);
    const totalMatch = fullText.match(/Total\s*\(Incl[^\d]*([\d.,]+)/i) || fullText.match(/Total[^\d]*([\d.,]+)/i);

    const subtotal = subtotalMatch ? parseFloat(subtotalMatch[1].replace(/,/g, "")) : undefined;
    const vatAmount = vatMatchAmt ? parseFloat(vatMatchAmt[1].replace(/,/g, "")) : undefined;
    const total = totalMatch ? parseFloat(totalMatch[1].replace(/,/g, "")) : undefined;

    const document: ExtractedDocument = {
      supplier: {
        name: supplierName,
        ...(vatNumber ? { vatNumber } : {})
      },
      quote: {
        quoteNumber,
        dateText,
        currency,
        vatRate: 0.15,
        taxBasis: "inclusive" as TaxBasis,
        ...(subtotal !== undefined ? { subtotal } : {}),
        ...(vatAmount !== undefined ? { vatAmount } : {}),
        ...(total !== undefined ? { total } : {})
      },
      lineItems,
      notes: []
    };

    return extractedDocumentSchema.parse(document);
  } catch {
    return null;
  }
}
