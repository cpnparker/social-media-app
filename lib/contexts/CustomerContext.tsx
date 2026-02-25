"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

export interface Customer {
  id: string;
  name: string;
  slug: string;
  status: string;
  industry: string | null;
  logoUrl: string | null;
}

interface CustomerContextValue {
  customers: Customer[];
  selectedCustomerId: string | null;
  selectedCustomer: Customer | null;
  canViewAll: boolean;
  isSingleCustomer: boolean;
  loading: boolean;
  role: string | null;
  setSelectedCustomerId: (id: string | null) => void;
  refreshCustomers: () => Promise<void>;
}

const CustomerContext = createContext<CustomerContextValue | null>(null);

export function useCustomer() {
  const ctx = useContext(CustomerContext);
  if (!ctx) {
    throw new Error("useCustomer must be used within a CustomerProvider");
  }
  return ctx;
}

// Safe hook that doesn't throw if outside provider
export function useCustomerSafe() {
  return useContext(CustomerContext);
}

const STORAGE_KEY = "selected-customer-id";

export function CustomerProvider({ children }: { children: ReactNode }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerIdState] = useState<string | null>(null);
  const [canViewAll, setCanViewAll] = useState(false);
  const [isSingleCustomer, setIsSingleCustomer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch("/api/me/customers");
      if (!res.ok) return;
      const data = await res.json();
      const customerList: Customer[] = data.customers || [];
      const viewAll: boolean = data.canViewAll ?? false;

      setCustomers(customerList);
      setCanViewAll(viewAll);
      setRole(data.role || null);

      // Restore from localStorage
      const stored = localStorage.getItem(STORAGE_KEY);

      if (!viewAll && customerList.length === 1) {
        // Single customer user — auto-select
        setIsSingleCustomer(true);
        setSelectedCustomerIdState(customerList[0].id);
      } else if (stored && customerList.some((c) => c.id === stored)) {
        // Restore previously selected customer
        setSelectedCustomerIdState(stored);
      } else if (viewAll) {
        // Workspace view (All Customers) — default to null
        setSelectedCustomerIdState(null);
      } else if (customerList.length > 0) {
        // Default to first customer
        setSelectedCustomerIdState(customerList[0].id);
      }
    } catch {
      // fail silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const setSelectedCustomerId = useCallback((id: string | null) => {
    setSelectedCustomerIdState(id);
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) || null;

  return (
    <CustomerContext.Provider
      value={{
        customers,
        selectedCustomerId,
        selectedCustomer,
        canViewAll,
        isSingleCustomer,
        loading,
        role,
        setSelectedCustomerId,
        refreshCustomers: fetchCustomers,
      }}
    >
      {children}
    </CustomerContext.Provider>
  );
}
