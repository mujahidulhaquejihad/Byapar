import { useState } from "react";
import { api, money } from "../api.js";
import { Button, Field, Modal, Page, Table, useApi } from "../ui.jsx";

export default function Partners() {
  const vendors = useApi(() => api("/fico/vendors"));
  const customers = useApi(() => api("/fico/customers"));
  const [kind, setKind] = useState(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [edit, setEdit] = useState(null);

  async function saveEdit() {
    try {
      await api(`/fico/customers/${edit.id}`, {
        method: "PUT",
        body: {
          creditLimit: Number(edit.creditLimit) || 0,
          paymentTerms: Number(edit.paymentTerms) || 0,
          taxId: edit.taxId,
          phone: edit.phone,
          address: edit.address,
          email: edit.email,
        },
      });
      setEdit(null);
      customers.reload();
    } catch (e) {
      setError(e.message);
    }
  }

  async function create() {
    try {
      const path = kind === "vendor" ? "/fico/vendors" : "/fico/customers";
      await api(path, { method: "POST", body: { name, email } });
      setKind(null);
      setName("");
      vendors.reload();
      customers.reload();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Page
      title="Vendors & customers"
      subtitle="Business partners used by AP, AR, and purchasing."
      actions={
        <>
          <Button kind="ghost" onClick={() => setKind("vendor")}>
            New vendor
          </Button>
          <Button onClick={() => setKind("customer")}>New customer</Button>
        </>
      }
    >
      {error ? <div className="err">{error}</div> : null}
      <div className="grid-2">
        <div>
          <div className="panel-h" style={{ background: "#fff", border: "1px solid var(--line)", borderBottom: 0 }}>Vendors</div>
          <Table
            columns={[
              { key: "code", label: "Code", mono: true },
              { key: "name", label: "Name" },
              { key: "email", label: "Email" },
              { key: "payment_terms", label: "Terms (days)" },
            ]}
            rows={vendors.data?.vendors || []}
          />
        </div>
        <div>
          <div className="panel-h" style={{ background: "#fff", border: "1px solid var(--line)", borderBottom: 0 }}>Customers</div>
          <Table
            columns={[
              { key: "code", label: "Code", mono: true },
              { key: "name", label: "Name" },
              { key: "creditLimit", label: "Credit limit", num: true, render: (c) => (c.creditLimit ? money(c.creditLimit) : "—") },
              {
                key: "exposure",
                label: "Owed + on order",
                num: true,
                render: (c) => <span style={c.creditLimit && c.exposure > c.creditLimit ? { color: "var(--danger)", fontWeight: 700 } : undefined}>{money(c.exposure)}</span>,
              },
              {
                key: "act",
                label: "",
                render: (c) => (
                  <Button
                    kind="ghost"
                    onClick={() =>
                      setEdit({ id: c.id, name: c.name, creditLimit: c.creditLimit, paymentTerms: c.payment_terms, taxId: c.tax_id || "", phone: c.phone || "", address: c.address || "", email: c.email || "" })
                    }
                  >
                    Edit
                  </Button>
                ),
              },
            ]}
            rows={customers.data?.customers || []}
          />
        </div>
      </div>
      {edit ? (
        <Modal
          title={`Edit ${edit.name}`}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setEdit(null)}>
                Cancel
              </Button>
              <Button onClick={saveEdit}>Save</Button>
            </>
          }
        >
          <div className="form two">
            <Field label="Credit limit (৳, 0 = no limit)">
              <input type="number" value={edit.creditLimit} onChange={(e) => setEdit({ ...edit, creditLimit: e.target.value })} />
            </Field>
            <Field label="Payment terms (days)">
              <input type="number" value={edit.paymentTerms} onChange={(e) => setEdit({ ...edit, paymentTerms: e.target.value })} />
            </Field>
            <Field label="BIN">
              <input value={edit.taxId} onChange={(e) => setEdit({ ...edit, taxId: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
            </Field>
            <Field label="Address" full>
              <input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
            </Field>
          </div>
          <p className="muted">Sales orders that would push this customer over the limit wait in Approvals.</p>
        </Modal>
      ) : null}
      {kind ? (
        <Modal
          title={kind === "vendor" ? "New vendor" : "New customer"}
          onClose={() => setKind(null)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setKind(null)}>
                Cancel
              </Button>
              <Button onClick={create}>Save</Button>
            </>
          }
        >
          <div className="form">
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Email">
              <input value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}
