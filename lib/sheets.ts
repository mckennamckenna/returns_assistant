// Google Sheets integration for the alpha weekly URL-review flow. The
// Sheet is the owner's review surface (queue + edit + approve/reject) —
// see BUILD.md's "Alpha weekly search-and-verify" section for the
// column-by-column contract. Assumes the target spreadsheet's first tab
// is named "Sheet1" (the default Google Sheets tab name) — rename the tab
// back to that, or change SHEET_TAB_NAME below, if it's ever renamed.
import { google } from "googleapis";

const SHEET_TAB_NAME = "Sheet1";

export const SHEET_HEADERS = [
  "Order ID",
  "Raw retailer",
  "Approved retailer",
  "Retailer notes",
  "Query used",
  "Current returnPortalUrl",
  "Candidate URL",
  "Alternative 1",
  "Alternative 2",
  "Status",
  "URL notes",
  "Queued at",
] as const;

export interface ReviewRowInput {
  orderId: string;
  rawRetailer: string;
  approvedRetailerPrefill: string;
  queryUsed: string;
  currentReturnPortalUrl: string;
  candidateUrl: string;
  alternative1: string;
  alternative2: string;
  queuedAt: string;
  urlNotesPrefill?: string; // e.g. "all candidates scored negatively, likely no good page exists"
}

export interface ReviewRow {
  rowNumber: number; // 1-indexed sheet row, including the header row
  orderId: string;
  rawRetailer: string;
  approvedRetailer: string;
  queryUsed: string;
  currentReturnPortalUrl: string;
  candidateUrl: string;
  status: string; // raw cell value: "pending" | "approved" | "rejected" (owner-typed, case-insensitive on read)
}

function getSheetId(): string {
  const sheetId = process.env.RETURN_URL_REVIEW_SHEET_ID;
  if (!sheetId) {
    throw new Error("RETURN_URL_REVIEW_SHEET_ID not configured");
  }
  return sheetId;
}

async function getSheetsClient() {
  const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rawCredentials) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not configured");
  }

  const credentials = JSON.parse(rawCredentials);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

// Writes the header row if the sheet is currently empty. Safe to call on
// every job run — a non-empty A1 is left untouched.
export async function ensureSheetHeaders(): Promise<void> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSheetId();

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_TAB_NAME}!A1:A1`,
  });

  if (existing.data.values && existing.data.values.length > 0) {
    return;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_TAB_NAME}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [[...SHEET_HEADERS]] },
  });
}

// Appends one review row and returns the 1-indexed sheet row number it
// landed on, parsed from the API's updatedRange (e.g. "Sheet1!A5:L5" ->
// 5) — stored as ReturnUrlReview.sheetRowId for round-trip lookup.
export async function appendReviewRow(row: ReviewRowInput): Promise<string> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSheetId();

  const values = [
    [
      row.orderId,
      row.rawRetailer,
      row.approvedRetailerPrefill,
      "", // Retailer notes — owner scratch column, starts empty
      row.queryUsed,
      row.currentReturnPortalUrl,
      row.candidateUrl,
      row.alternative1,
      row.alternative2,
      "pending",
      row.urlNotesPrefill ?? "", // URL notes — owner scratch column, empty unless auto-flagged
      row.queuedAt,
    ],
  ];

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_TAB_NAME}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });

  const updatedRange = response.data.updates?.updatedRange ?? "";
  const rowMatch = updatedRange.match(/![A-Z]+(\d+):/);
  if (!rowMatch) {
    throw new Error(`Could not parse row number from Sheets append response range "${updatedRange}"`);
  }
  return rowMatch[1];
}

// Reads every data row (header excluded) currently in the sheet, in
// column order matching SHEET_HEADERS.
export async function readReviewRows(): Promise<ReviewRow[]> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_TAB_NAME}!A2:L`,
  });

  const rows = response.data.values ?? [];

  return rows.map((cells, index) => ({
    rowNumber: index + 2, // +2: 1-indexed sheet rows, plus the header row
    orderId: cells[0] ?? "",
    rawRetailer: cells[1] ?? "",
    approvedRetailer: cells[2] ?? "",
    queryUsed: cells[4] ?? "",
    currentReturnPortalUrl: cells[5] ?? "",
    candidateUrl: cells[6] ?? "",
    status: (cells[9] ?? "").trim().toLowerCase(),
  }));
}
