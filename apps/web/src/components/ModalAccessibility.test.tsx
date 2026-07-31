import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { CreateCatalogItemModal } from "./CreateCatalogItemModal";
import { CreateSupplierModal } from "./CreateSupplierModal";
import { DocumentPreviewModal } from "./DocumentPreviewModal";
import { ReassignModal } from "./ReassignModal";
import { SupplierDetailModal } from "./SupplierDetailModal";
import { UploadQuoteModal } from "./UploadQuoteModal";

const supplier = {
  supplierId: "11111111-1111-4111-8111-111111111111",
  supplierName: "Accessible Supplier",
  email: null,
  phone: null,
  quoteCount: 0,
  lineItemCount: 0,
  averageRate: null,
  variancePercent: null,
  firstQuoteDate: null,
  lastQuoteDate: null
};

const documentAudit = {
  id: "22222222-2222-4222-8222-222222222222",
  filename: "quote.xlsx",
  fileType: "xlsx",
  sha256: "a".repeat(64),
  status: "parsed",
  warnings: [],
  createdAt: "2026-07-31T12:00:00.000Z"
};

type ModalFactory = (onClose: () => void) => ReactElement;

const modalFactories: Array<[string, ModalFactory]> = [
  ["upload", (onClose) => (
    <QueryClientProvider client={new QueryClient()}>
      <UploadQuoteModal onClose={onClose} />
    </QueryClientProvider>
  )],
  ["create supplier", (onClose) => (
    <CreateSupplierModal onClose={onClose} onSaved={vi.fn()} />
  )],
  ["create catalog item", (onClose) => (
    <CreateCatalogItemModal onClose={onClose} onSaved={vi.fn()} />
  )],
  ["supplier detail", (onClose) => (
    <SupplierDetailModal supplier={supplier} onClose={onClose} onDelete={vi.fn()} />
  )],
  ["document preview", (onClose) => (
    <DocumentPreviewModal document={documentAudit} runId="run-1234" onClose={onClose} />
  )],
  ["reassignment", (onClose) => (
    <ReassignModal
      lineItem={{
        id: "33333333-3333-4333-8333-333333333333",
        description: "Waiter",
        supplierName: "Accessible Supplier",
        quoteNumber: "AS-1"
      }}
      catalogItems={[]}
      onClose={onClose}
      onSaved={vi.fn()}
    />
  )]
];

describe("modal accessibility", () => {
  it.each(modalFactories)("closes the %s modal with Escape", (_name, createModal) => {
    const onClose = vi.fn();
    render(createModal(onClose));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("traps focus, locks background scrolling, and restores both on cleanup", () => {
    const launcher = document.createElement("button");
    document.body.append(launcher);
    launcher.focus();
    const originalOverflow = document.body.style.overflow;
    const view = render(<CreateSupplierModal onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByLabelText(/supplier \/ company name/i)).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");

    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(cancel).toHaveFocus();

    view.unmount();
    expect(document.body.style.overflow).toBe(originalOverflow);
    expect(launcher).toHaveFocus();
    launcher.remove();
  });
});
