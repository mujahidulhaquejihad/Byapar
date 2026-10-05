import { Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "./api.js";
import Shell from "./Shell.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import RoleHome from "./pages/RoleHome.jsx";
import Accounts from "./pages/Accounts.jsx";
import Journals from "./pages/Journals.jsx";
import TrialBalance from "./pages/TrialBalance.jsx";
import AP from "./pages/AP.jsx";
import AR from "./pages/AR.jsx";
import Assets from "./pages/Assets.jsx";
import Partners from "./pages/Partners.jsx";
import Materials from "./pages/Materials.jsx";
import PurchaseOrders from "./pages/PurchaseOrders.jsx";
import Inventory from "./pages/Inventory.jsx";
import Movements from "./pages/Movements.jsx";
import SalesOrders from "./pages/SalesOrders.jsx";
import Deliveries from "./pages/Deliveries.jsx";
import Boms from "./pages/Boms.jsx";
import Production from "./pages/Production.jsx";
import WorkCenters from "./pages/WorkCenters.jsx";
import Reports from "./pages/Reports.jsx";
import VatReturn from "./pages/VatReturn.jsx";
import Aging from "./pages/Aging.jsx";
import Cashbook from "./pages/Cashbook.jsx";
import Periods from "./pages/Periods.jsx";
import Approvals from "./pages/Approvals.jsx";
import Reorder from "./pages/Reorder.jsx";
import Mrp from "./pages/Mrp.jsx";
import Lots from "./pages/Lots.jsx";
import GatePasses from "./pages/GatePasses.jsx";
import ImportBackup from "./pages/ImportBackup.jsx";
import ShopFloor from "./pages/ShopFloor.jsx";
import Ledgers from "./pages/Ledgers.jsx";
import PrintDoc from "./pages/PrintDoc.jsx";
import Users from "./pages/Users.jsx";
import Audit from "./pages/Audit.jsx";
import Help from "./pages/Help.jsx";
import BankRec from "./pages/BankRec.jsx";
import Quotations from "./pages/Quotations.jsx";
import StockValuation from "./pages/StockValuation.jsx";
import Lcs from "./pages/Lcs.jsx";
import Payroll from "./pages/Payroll.jsx";
import Account from "./pages/Account.jsx";

function Private({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/print/:kind/:id" element={<Private><PrintDoc /></Private>} />
      <Route
        path="/"
        element={
          <Private>
            <Shell />
          </Private>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="desk" element={<RoleHome />} />
        <Route path="reports" element={<Reports />} />
        <Route path="vat-return" element={<VatReturn />} />
        <Route path="aging" element={<Aging />} />
        <Route path="ledgers" element={<Ledgers />} />
        <Route path="cashbook" element={<Cashbook />} />
        <Route path="periods" element={<Periods />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="journals" element={<Journals />} />
        <Route path="trial-balance" element={<TrialBalance />} />
        <Route path="ap" element={<AP />} />
        <Route path="ar" element={<AR />} />
        <Route path="assets" element={<Assets />} />
        <Route path="partners" element={<Partners />} />
        <Route path="materials" element={<Materials />} />
        <Route path="purchase-orders" element={<PurchaseOrders />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="reorder" element={<Reorder />} />
        <Route path="movements" element={<Movements />} />
        <Route path="lots" element={<Lots />} />
        <Route path="shop-floor" element={<ShopFloor />} />
        <Route path="sales-orders" element={<SalesOrders />} />
        <Route path="deliveries" element={<Deliveries />} />
        <Route path="gate-passes" element={<GatePasses />} />
        <Route path="boms" element={<Boms />} />
        <Route path="production" element={<Production />} />
        <Route path="work-centers" element={<WorkCenters />} />
        <Route path="mrp" element={<Mrp />} />
        <Route path="users" element={<Users />} />
        <Route path="audit" element={<Audit />} />
        <Route path="import-backup" element={<ImportBackup />} />
        <Route path="help" element={<Help />} />
        <Route path="bank-rec" element={<BankRec />} />
        <Route path="quotations" element={<Quotations />} />
        <Route path="stock-valuation" element={<StockValuation />} />
        <Route path="lcs" element={<Lcs />} />
        <Route path="payroll" element={<Payroll />} />
        <Route path="account" element={<Account />} />
      </Route>
    </Routes>
  );
}
