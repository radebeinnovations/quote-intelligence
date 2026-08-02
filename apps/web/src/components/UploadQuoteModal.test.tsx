import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { UploadQuoteModal } from "./UploadQuoteModal";

function renderModal(onUploaded = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <UploadQuoteModal onClose={vi.fn()} onUploaded={onUploaded} />
    </QueryClientProvider>
  );
  return onUploaded;
}

describe("batch quote upload", () => {
  it("serializes multiple PDF/XLSX files and reports the batch result", async () => {
    const upload = vi.spyOn(api, "uploadQuotes").mockResolvedValue({
      runId: "11111111-1111-4111-8111-111111111111",
      accepted: 2,
      documents: [
        { filename: "quote.pdf", status: "parsed", warningCount: 0, error: null },
        { filename: "rates.xlsx", status: "parsed", warningCount: 1, error: null }
      ]
    });
    const onUploaded = renderModal();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    const pdf = new File(["%PDF-1.7"], "quote.pdf", { type: "application/pdf" });
    const xlsx = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "rates.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    fireEvent.change(input!, { target: { files: [pdf, xlsx] } });
    fireEvent.click(await screen.findByRole("button", { name: "Process 2 quotes" }));

    expect(await screen.findByText("2 document(s) processed")).toBeVisible();
    await waitFor(() => expect(onUploaded).toHaveBeenCalledOnce());
    expect(upload).toHaveBeenCalledOnce();
    const request = upload.mock.calls[0]?.[0];
    expect(request?.files.map(({ filename, mimeType }) => ({ filename, mimeType }))).toEqual([
      { filename: "quote.pdf", mimeType: "application/pdf" },
      {
        filename: "rates.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      }
    ]);
  });

  it("accepts Windows files with an empty MIME type when the extension is supported", async () => {
    vi.spyOn(api, "uploadQuotes").mockResolvedValue({
      runId: "11111111-1111-4111-8111-111111111111",
      accepted: 1,
      documents: [{ filename: "quote.pdf", status: "parsed", warningCount: 0, error: null }]
    });
    renderModal();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: { files: [new File(["%PDF-1.7"], "quote.pdf", { type: "" })] }
    });
    expect(await screen.findByText("quote.pdf")).toBeVisible();
  });
});
