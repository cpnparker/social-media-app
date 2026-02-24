"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: string;
}

interface WorkspaceContextValue {
  workspaces: Workspace[];
  selectedWorkspace: Workspace | null;
  loading: boolean;
  setSelectedWorkspace: (id: string) => void;
  refreshWorkspaces: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return ctx;
}

// Safe hook that doesn't throw if outside provider
export function useWorkspaceSafe() {
  return useContext(WorkspaceContext);
}

const STORAGE_KEY = "selected-workspace-id";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState(0);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const res = await fetch("/api/me/workspaces");
      if (!res.ok) return;
      const data = await res.json();
      const workspaceList: Workspace[] = data.workspaces || [];

      setWorkspaces(workspaceList);

      // Restore from localStorage
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && workspaceList.some((w) => w.id === stored)) {
        setSelectedWorkspaceId(stored);
      } else if (workspaceList.length > 0) {
        // Default to first workspace
        setSelectedWorkspaceId(workspaceList[0].id);
      }
    } catch {
      // fail silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces, key]);

  const setSelectedWorkspace = useCallback((id: string) => {
    setSelectedWorkspaceId(id);
    localStorage.setItem(STORAGE_KEY, id);
    // Trigger re-fetch via key increment
    setKey((prev) => prev + 1);
  }, []);

  const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId) || null;

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        selectedWorkspace,
        loading,
        setSelectedWorkspace,
        refreshWorkspaces: fetchWorkspaces,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
