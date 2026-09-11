"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
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

export function CustomerProvider({ children }: { children: ReactNode }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  // Initialize from URL param immediately to prevent null→value→null flicker
  const [selectedCustomerId, setSelectedCustomerIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URL(window.location.href).searchParams.get("client");
  });
  const [canViewAll, setCanViewAll] = useState(false);
  const [isSingleCustomer, setIsSingleCustomer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);

  // Capture URL ?client= param ONCE at mount time — don't re-read later
  // (the URL may be modified by other effects before fetchCustomers runs again)
  const initialUrlClientRef = useRef<string | null>(
    typeof window !== "undefined"
      ? new URL(window.location.href).searchParams.get("client")
      : null
  );
  const initialClientConsumedRef = useRef(false);

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

      // Use the URL ?client= param captured at mount time (only on first call)
      const urlClientId = !initialClientConsumedRef.current
        ? initialUrlClientRef.current
        : null;
      const isFirstLoad = !initialClientConsumedRef.current;
      initialClientConsumedRef.current = true;

      // Only set the initial customer selection on first load.
      // On subsequent calls (refreshCustomers), don't change the selection.
      if (isFirstLoad) {
        if (!viewAll && customerList.length === 1) {
          setIsSingleCustomer(true);
          setSelectedCustomerIdState(customerList[0].id);
        } else if (urlClientId && customerList.some((c) => c.id === urlClientId)) {
          setSelectedCustomerIdState(urlClientId);
        } else if (viewAll) {
          setSelectedCustomerIdState(null);
        } else if (customerList.length > 0) {
          setSelectedCustomerIdState(customerList[0].id);
        }
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
