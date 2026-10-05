import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { api, money } from "../api.js";
import { Button, Page } from "../ui.jsx";

export default function PrintDoc() {
  const { kind, id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const { search } = useLocation();
  useEffect(() => {
    const path = kind === "payslip" ? `/hr/payslips/${id}` : `/ops/print/${kind}/${id}${search}`;
    api(path)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [kind, id, search]);

  if (error) return <div className="err">{error}</div>;
  if (!data) return <p className="muted">Loading document…</p>;

  const c = data.company || {};

  return (
    <div className="print-wrap">
      <div className="no-print page-h">
        <div>
          <h1>{data.title}</h1>
          <p>Print or save as PDF from the browser.</p>
        </div>
        <Button onClick={() => window.print()}>Print</Button>
      </div>
      <div className="print-sheet">
        <div className="print-head">
          <div>
            <strong>{c.legal_name || c.name}</strong>
            <div className="muted">{c.address}</div>
            <div className="mono">
              BIN {c.bin_no || "—"} · TIN {c.tin_no || "—"}
            </div>
          </div>
          <div className="print-badge">{data.title}</div>
        </div>

        {data.invoice ? (
          <>
            <div className="print-meta">
              <div>
                <b>Bill to</b>
                <div>{data.invoice.customer_name}</div>
                <div className="mono">BIN {data.invoice.customer_bin || "—"}</div>
              </div>
              <div>
                <div>
                  Invoice: <b className="mono">{data.invoice.invoice_no}</b>
                </div>
                <div>Date: {data.invoice.invoice_date}</div>
                <div>Due: {data.invoice.due_date}</div>
              </div>
            </div>
            <table className="data">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="num">Net</th>
                  <th className="num">VAT 15%</th>
                  <th className="num">Gross</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{data.invoice.description}</td>
                  <td className="num">{money(data.invoice.net)}</td>
                  <td className="num">{money(data.invoice.tax)}</td>
                  <td className="num">{money(data.invoice.amount)}</td>
                </tr>
              </tbody>
            </table>
            <p className="muted" style={{ marginTop: 16 }}>
              Amount in words: Taka {Math.round(data.invoice.amount).toLocaleString("en-BD")} only.
            </p>
          </>
        ) : null}

        {data.delivery ? (
          <>
            <div className="print-meta">
              <div>
                <b>Deliver to</b>
                <div>{data.delivery.customer_name}</div>
              </div>
              <div>
                <div>
                  Challan: <b className="mono">{data.delivery.delivery_no}</b>
                </div>
                <div>SO: {data.delivery.so_number}</div>
                <div>Date: {data.delivery.delivery_date}</div>
              </div>
            </div>
            <table className="data">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Material</th>
                  <th className="num">Qty</th>
                </tr>
              </thead>
              <tbody>
                {(data.lines || []).map((l) => (
                  <tr key={l.id}>
                    <td className="mono">{l.sku}</td>
                    <td>{l.material_name}</td>
                    <td className="num">
                      {l.qty} {l.uom}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        {data.receipt ? (
          <>
            <div className="print-meta">
              <div>
                Received from <b>{data.receipt.customer_name}</b>
              </div>
              <div>
                Receipt <b className="mono">{data.receipt.receipt_no}</b> · {data.receipt.receipt_date}
              </div>
            </div>
            <p style={{ fontSize: 22, fontFamily: "var(--mono)" }}>{money(data.receipt.amount)}</p>
          </>
        ) : null}

        {data.statement ? (
          <>
            <div className="print-meta">
              <div>
                <b>Customer</b>
                <div>{data.statement.customer.name}</div>
                <div className="mono">BIN {data.statement.customer.tax_id || "—"}</div>
              </div>
              <div>
                <div>Period: {data.statement.from || "beginning"} → {data.statement.to}</div>
                <div>Opening balance: {money(data.statement.opening)}</div>
                <div>
                  <b>Balance due: {money(data.statement.closing)}</b>
                </div>
              </div>
            </div>
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Document</th>
                  <th>Details</th>
                  <th className="num">Debit</th>
                  <th className="num">Credit</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.statement.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.date}</td>
                    <td className="mono">{l.doc}</td>
                    <td>{l.text}</td>
                    <td className="num">{l.debit ? money(l.debit) : ""}</td>
                    <td className="num">{l.credit ? money(l.credit) : ""}</td>
                    <td className="num">{money(l.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ marginTop: 16 }}>
              Please pay the balance due to {c.bank_name} A/C {c.bank_account}. Contact us within 7 days if anything above is incorrect.
            </p>
          </>
        ) : null}

        {data.quotation ? (
          <>
            <div className="print-meta">
              <div>
                <b>To</b>
                <div>{data.quotation.customer?.name}</div>
                <div className="muted">{data.quotation.customer?.address}</div>
              </div>
              <div>
                <div>
                  Quotation: <b className="mono">{data.quotation.quote_no}</b>
                </div>
                <div>Date: {data.quotation.quote_date}</div>
                <div>Valid until: {data.quotation.valid_until}</div>
              </div>
            </div>
            <table className="data">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit price</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.quotation.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="mono">{l.sku}</td>
                    <td>{l.material_name}</td>
                    <td className="num">
                      {l.qty} {l.uom}
                    </td>
                    <td className="num">{money(l.unitPrice)}</td>
                    <td className="num">{money(l.lineTotal)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4}>Subtotal</td>
                  <td className="num">{money(data.quotation.total)}</td>
                </tr>
                <tr>
                  <td colSpan={4}>VAT 15%</td>
                  <td className="num">{money(data.quotation.vat)}</td>
                </tr>
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={4}>Total</td>
                  <td className="num">{money(data.quotation.grand)}</td>
                </tr>
              </tbody>
            </table>
            {data.quotation.notes ? <p className="muted">{data.quotation.notes}</p> : null}
          </>
        ) : null}

        {data.payslip ? (
          <>
            <div className="print-meta">
              <div>
                <b>{data.payslip.name}</b>
                <div>
                  {data.payslip.code} · {data.payslip.designation} {data.payslip.department ? `· ${data.payslip.department}` : ""}
                </div>
                <div className="mono">{data.payslip.pay_account}</div>
              </div>
              <div>
                <div>
                  {data.payslip.kind === "bonus" ? `Festival bonus — ${data.payslip.title}` : `Salary for ${data.payslip.period}`}
                </div>
                <div>Paid on {data.payslip.pay_date}</div>
                <div className="mono">{data.payslip.run_no}</div>
              </div>
            </div>
            <table className="data">
              <tbody>
                {[
                  ["Basic", data.payslip.basic],
                  ["House rent", data.payslip.house_rent],
                  ["Medical", data.payslip.medical],
                  ["Conveyance", data.payslip.conveyance],
                  ["Festival bonus", data.payslip.bonus],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td className="num">{money(v)}</td>
                    </tr>
                  ))}
                <tr style={{ fontWeight: 700 }}>
                  <td>Gross pay</td>
                  <td className="num">{money(data.payslip.gross)}</td>
                </tr>
                {data.payslip.pf_employee ? (
                  <tr>
                    <td>Less: provident fund (company adds {money(data.payslip.pf_employer)})</td>
                    <td className="num">−{money(data.payslip.pf_employee)}</td>
                  </tr>
                ) : null}
                {data.payslip.tax ? (
                  <tr>
                    <td>Less: income tax deducted</td>
                    <td className="num">−{money(data.payslip.tax)}</td>
                  </tr>
                ) : null}
                <tr style={{ fontWeight: 700, fontSize: 16 }}>
                  <td>Net pay</td>
                  <td className="num">{money(data.payslip.net)}</td>
                </tr>
              </tbody>
            </table>
          </>
        ) : null}

        <div className="print-sign">
          <div>Prepared by</div>
          <div>Authorized signatory</div>
        </div>
      </div>
    </div>
  );
}
