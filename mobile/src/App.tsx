import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell, ToastHost } from './components/AppShell';
import { Loading } from './components/ui';
import { useSession, watchConnection } from './store/session';

import { Home } from './screens/Home';
import { Sell } from './screens/Sell';
import { Stock } from './screens/Stock';
import { StockItem } from './screens/StockItem';
import { More } from './screens/More';
import { Login } from './screens/Login';
import { Onboarding } from './screens/Onboarding';
import { Notifications } from './screens/Notifications';
import { GlobalSearch } from './screens/GlobalSearch';
import { PendingQueue } from './screens/PendingQueue';
import { SaleDetail } from './screens/SaleDetail';
import { SalesList } from './screens/SalesList';

import { ProductList } from './screens/products/ProductList';
import { ProductForm } from './screens/products/ProductForm';
import { ProductDetail } from './screens/products/ProductDetail';

import { PurchaseList } from './screens/purchases/PurchaseList';
import { PurchaseForm } from './screens/purchases/PurchaseForm';
import { PurchaseDetail } from './screens/purchases/PurchaseDetail';

import { CustomerList } from './screens/parties/CustomerList';
import { CustomerDetail } from './screens/parties/CustomerDetail';
import { PartyForm } from './screens/parties/PartyForm';
import { SupplierList } from './screens/parties/SupplierList';
import { SupplierDetail } from './screens/parties/SupplierDetail';

import { Payments } from './screens/Payments';
import { Expenses } from './screens/Expenses';
import { Returns } from './screens/returns/Returns';
import { SalesReturnForm } from './screens/returns/SalesReturnForm';
import { PurchaseReturnForm } from './screens/returns/PurchaseReturnForm';
import { DailyClosing } from './screens/DailyClosing';

import { Reports } from './screens/reports/Reports';
import { ReportView } from './screens/reports/ReportView';

import { Scanner } from './screens/scanner/Scanner';
import { ScanReview } from './screens/scanner/ScanReview';
import { ScanHistory } from './screens/scanner/ScanHistory';

import { Settings } from './screens/settings/Settings';
import { BusinessProfile } from './screens/settings/BusinessProfile';
import { TaxSettings } from './screens/settings/TaxSettings';
import { StaffSettings } from './screens/settings/StaffSettings';

export function App() {
  const status = useSession((state) => state.status);
  const restore = useSession((state) => state.restore);
  const location = useLocation();

  useEffect(() => {
    void restore();
    return watchConnection();
  }, [restore]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  if (status === 'LOADING') {
    return (
      <div className="app-shell">
        <Loading label="Opening your shop…" />
      </div>
    );
  }

  if (status === 'SIGNED_OUT') {
    return (
      <>
        <Routes>
          <Route path="/welcome" element={<Onboarding />} />
          <Route path="*" element={<Login />} />
        </Routes>
        <ToastHost />
      </>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Home />} />
        <Route path="/sell" element={<Sell />} />
        <Route path="/stock" element={<Stock />} />
        <Route path="/stock/:variantId" element={<StockItem />} />
        <Route path="/more" element={<More />} />

        <Route path="/notifications" element={<Notifications />} />
        <Route path="/search" element={<GlobalSearch />} />
        <Route path="/pending" element={<PendingQueue />} />

        <Route path="/sales" element={<SalesList />} />
        <Route path="/sales/:id" element={<SaleDetail />} />

        <Route path="/products" element={<ProductList />} />
        <Route path="/products/new" element={<ProductForm />} />
        <Route path="/products/:id" element={<ProductDetail />} />
        <Route path="/products/:id/edit" element={<ProductForm />} />

        <Route path="/purchases" element={<PurchaseList />} />
        <Route path="/purchases/new" element={<PurchaseForm />} />
        <Route path="/purchases/:id" element={<PurchaseDetail />} />

        <Route path="/customers" element={<CustomerList />} />
        <Route path="/customers/new" element={<PartyForm kind="CUSTOMER" />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />

        <Route path="/suppliers" element={<SupplierList />} />
        <Route path="/suppliers/new" element={<PartyForm kind="SUPPLIER" />} />
        <Route path="/suppliers/:id" element={<SupplierDetail />} />

        <Route path="/payments" element={<Payments />} />
        <Route path="/expenses" element={<Expenses />} />

        <Route path="/returns" element={<Returns />} />
        <Route path="/returns/sales/new" element={<SalesReturnForm />} />
        <Route path="/returns/purchases/new" element={<PurchaseReturnForm />} />

        <Route path="/closing" element={<DailyClosing />} />

        <Route path="/reports" element={<Reports />} />
        <Route path="/reports/:key" element={<ReportView />} />

        <Route path="/scanner" element={<Scanner />} />
        <Route path="/scanner/history" element={<ScanHistory />} />
        <Route path="/scanner/:id" element={<ScanReview />} />

        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/business" element={<BusinessProfile />} />
        <Route path="/settings/tax" element={<TaxSettings />} />
        <Route path="/settings/staff" element={<StaffSettings />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
